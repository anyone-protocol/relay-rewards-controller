import { Injectable, Logger } from '@nestjs/common'
import { ethers, Wallet } from 'ethers'
import _ from 'lodash'
import { EthereumSigner } from '@dha-team/arbundles'
import {
  AoClient,
  AoContractError,
  createAoClient,
  nodeUrlFromEnv
} from '@anyone-protocol/ao-client'
import { ConfigService } from '@nestjs/config'
import { AddScoresData } from 'src/distribution/dto/add-scores'
import RoundSnapshot from 'src/distribution/dto/round-snapshot'
import { hodlerABI } from './abi/hodler'

@Injectable()
export class RelayRewardsService {
  private readonly logger = new Logger(RelayRewardsService.name)

  private isLive?: string

  private readonly relayRewardsProcessId: string
  private readonly relayRewardsControllerKey: string
  private readonly hodlerContract: ethers.Contract
  private readonly hbUrl: string

  private ao!: AoClient

  private readonly useHodler: boolean

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      RELAY_REWARDS_PROCESS_ID: string
      RELAY_REWARDS_CONTROLLER_KEY: string
      HODLER_CONTRACT_ADDRESS: string
      JSON_RPC: string
      USE_HODLER: string
      HB_URL: string
    }>
  ) {
    this.isLive = config.get<string>('IS_LIVE', { infer: true })
    
    this.useHodler = this.config.get<string>('USE_HODLER', { infer: true }) === 'true'

    this.logger.log(`Initializing relay rewards service (IS_LIVE: ${this.isLive}, USE_HODLER: ${this.useHodler})`)

    if (this.useHodler) {
      const jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
      if (!jsonRpc) {
        this.logger.error('Missing JSON RPC URL')
        throw new Error('Missing JSON RPC URL')
      }
      const provider = new ethers.JsonRpcProvider(jsonRpc)
      
      const hodlerAddress = this.config.get<string>('HODLER_CONTRACT_ADDRESS', { infer: true })
      this.hodlerContract =  new ethers.Contract(
          hodlerAddress,
          hodlerABI,
          provider
        )
      
      if (!this.hodlerContract) {
        this.logger.error('Failed to initialize HODLER contract')
      } else this.logger.log(`HODLER contract initialized at address: ${hodlerAddress}`)
    }

    const relayRewardsPid = this.config.get<string>('RELAY_REWARDS_PROCESS_ID', {
      infer: true,
    })
    if (relayRewardsPid != undefined) {
      this.relayRewardsProcessId = relayRewardsPid
    } else this.logger.error('Missing relay rewards process id')

    const relayRewardsKey = this.config.get<string>('RELAY_REWARDS_CONTROLLER_KEY', {
      infer: true,
    })

    if (relayRewardsKey != undefined) {
      this.relayRewardsControllerKey = relayRewardsKey
    } else this.logger.error('Missing relay rewards controller key')

    // Fail closed, no default. Replaces CU_URL.
    this.hbUrl = nodeUrlFromEnv({
      HB_URL: this.config.get<string>('HB_URL', { infer: true })
    })
  }

  async onApplicationBootstrap(): Promise<void> {
    this.ao = createAoClient({
      url: this.hbUrl,
      signer: new EthereumSigner(this.relayRewardsControllerKey),
      logger: {
        debug: (m, ...meta) => this.logger.debug(m, ...meta),
        warn: (m, ...meta) => this.logger.warn(m, ...meta),
        error: (m, ...meta) => this.logger.error(m, ...meta)
      }
    })
    const wallet = new Wallet(this.relayRewardsControllerKey)
    const address = await wallet.getAddress()
    this.logger.log(`Bootstrapped with signer address ${address} against node ${this.hbUrl}`)

    // Surface an unreachable node at boot rather than mid-round. Warn, do not throw: a blip
    // during a rolling deploy should not crash-loop the service.
    try {
      this.logger.log(`Node operator address: ${await this.ao.fetchNodeAddress()}`)
    } catch (error) {
      this.logger.warn(
        `Could not reach the HyperBEAM node at ${this.hbUrl} during bootstrap`,
        error.stack
      )
    }
  }

  public async getHodlerData(): Promise<{
    locksData: { [key: string]: string[] },
    stakingData: { [key: string]: { [key: string]: number }}
  }> {
    const locksData = {}
    const stakingData = {}

    if (!this.useHodler) {
      this.logger.warn('HODLER data fetching is disabled')
      return { locksData, stakingData }
    }

    const keys = await this.hodlerContract.getHodlerKeys()
    for (const key of keys) {
      const hodlerAddress = ethers.getAddress(key)

      const locks: { fingerprint: string, operator: string, amount: string }[] = await this.hodlerContract.getLocks(hodlerAddress)
      locks.forEach((lock) => {
        if (!locksData[lock.fingerprint]) {
          locksData[lock.fingerprint] = []
        }
        const operatorAddress = ethers.getAddress(lock.operator)
        if (!locksData[lock.fingerprint].includes(operatorAddress)) {
          locksData[lock.fingerprint].push(operatorAddress)
        }
      })

      const stakes: { operator: string, amount: string }[] = await this.hodlerContract.getStakes(hodlerAddress)
      stakes.forEach((stake) => {
        const operatorAddress = ethers.getAddress(stake.operator)
        if (operatorAddress && operatorAddress.length > 0) {
          if (!stakingData[operatorAddress]) {
            stakingData[operatorAddress] = {}
          }
          stakingData[operatorAddress][hodlerAddress] = stake.amount
        }
      })
      this.logger.log(`Fetched staking data [${stakes.length}] for hodler ${hodlerAddress}`)
    }
    this.logger.log(`Fetched staking data for ${Object.keys(stakingData).length} operators`)

    return { stakingData, locksData }
  }

  /**
   * The completed round's full snapshot — Timestamp, Period, Summary, Configuration and the
   * per-fingerprint `Details`.
   *
   * This was a `Last-Snapshot` dryrun. That action does not exist on the native contract, and
   * it could not: `Details` are deliberately NEVER persisted to state (they would add ~3.6MB
   * per round to a state tree that is re-read constantly). They exist only as the OUTPUT of
   * the `Complete-Round` message, so this reads that message's own slot.
   *
   * The slot therefore has to travel from whoever sent Complete-Round. It is threaded through
   * the BullMQ parent/child return value rather than the payload itself, precisely because the
   * payload is large and Redis is a poor place to put it.
   */
  public async getLastSnapshot(slot: string): Promise<RoundSnapshot | undefined> {
    try {
      const output = await this.ao.readSlotOutput(this.relayRewardsProcessId, slot)

      return JSON.parse(output) as RoundSnapshot
    } catch (error) {
      this.logger.error(
        `Exception reading the round snapshot from slot ${slot}: ${error.message}`,
        error.stack
      )
    }
  }

  public async addScores(stamp: number, scores: AddScoresData): Promise<boolean> {
    if (this.isLive !== 'true') {
      this.logger.warn(`NOT LIVE: Not adding ${scores.length} scores to distribution contract `)

      return false
    }

    try {
      const { id } = await this.ao.sendMessage({
        processId: this.relayRewardsProcessId,
        action: 'Add-Scores',
        // Tag names must be lowercase for the ans104 signature round-trip; the node
        // presents them title-cased to the contract (`ctx.tags['Round-Timestamp']`).
        tags: [{ name: 'round-timestamp', value: stamp.toString() }],
        data: JSON.stringify({ Scores: scores })
      })

      this.logger.log(`[${stamp}] Add-Scores ${Object.keys(scores).length}: ${id}`)

      return true
    } catch (error) {
      if (error instanceof AoContractError) {
        this.logger.error(
          `Failed storing ${Object.keys(scores).length} scores for ${stamp}: ${error.reason}`
        )
      } else {
        this.logger.error(`Exception in addScores: ${error.message}`, error.stack)
      }
    }

    return false
  }

  /**
   * Settle the round. Returns the SLOT of the Complete-Round message, which is where the full
   * snapshot (incl. Details) lives — see getLastSnapshot. `undefined` means the round did not
   * settle.
   */
  public async completeRound(stamp: number): Promise<string | undefined> {
    if (this.isLive !== 'true') {
      this.logger.warn(`NOT LIVE: Not sending the Complete-Round message`)

      return undefined
    }

    try {
      const { id, slot } = await this.ao.sendMessage({
        processId: this.relayRewardsProcessId,
        action: 'Complete-Round',
        tags: [{ name: 'round-timestamp', value: stamp.toString() }]
      })

      if (slot === null) {
        // The contract accepted it (sendMessage would have thrown otherwise), but without a
        // slot we cannot retrieve Details later. Report the round as not settled rather than
        // let persistence silently archive nothing.
        this.logger.error(`[${stamp}] Complete-Round returned no slot; cannot persist the round`)

        return undefined
      }

      this.logger.log(`[${stamp}] Complete-Round: ${id} (slot ${slot})`)

      return slot
    } catch (error) {
      if (error instanceof AoContractError) {
        this.logger.error(`Failed Complete-Round for ${stamp}: ${error.reason}`)
      } else {
        this.logger.error(`Exception in completeRound: ${error.message}`, error.stack)
      }
    }

    return undefined
  }
}
