import { Inject, Injectable, Logger, LoggerService, } from '@nestjs/common'
import { AosSigningFunction, sendAosMessage } from '../util/send-aos-message'
import { createEthereumDataItemSigner } from '../util/create-ethereum-data-item-signer'
import { Wallet } from 'ethers'
import _ from 'lodash'
import { EthereumSigner } from '../util/arbundles-lite'
import { ConfigService } from '@nestjs/config'
import { AddScoresData } from 'src/distribution/dto/add-scores'
import RoundSnapshot from 'src/distribution/dto/round-snapshot'

@Injectable()
export class RelayRewardsService {
  private readonly logger = new Logger(RelayRewardsService.name)

  private isLive?: string

  private readonly relayRewardsProcessId: string
  private readonly relayRewardsControllerKey: string

  private signer!: AosSigningFunction

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      RELAY_REWARDS_PROCESS_ID: string
      RELAY_REWARDS_CONTROLLER_KEY: string
    }>
  ) {
    this.isLive = config.get<string>('IS_LIVE', { infer: true })

    this.logger.log(`Initializing relay rewards service (IS_LIVE: ${this.isLive})`)

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
  }

  async onApplicationBootstrap(): Promise<void> {
    this.signer = await createEthereumDataItemSigner(new EthereumSigner(this.relayRewardsControllerKey))
    const wallet = new Wallet(this.relayRewardsControllerKey)
    const address = await wallet.getAddress()
    this.logger.log(`Bootstrapped with signer address ${address}`)
  }

  public async getLastSnapshot(): Promise<RoundSnapshot | undefined> {
    try {
      const { result } = await sendAosMessage({
        processId: this.relayRewardsProcessId,
        signer: this.signer as any, // NB: types, lol
        tags: [
          { name: 'Action', value: 'Last-Snapshot' },
          { name: 'Timestamp', value: Date.now().toString() },
        ],
      })

      if (!result.Error) {
        const data: RoundSnapshot = JSON.parse(result.Messages[0].Data)

        return data
      } else {
        this.logger.error(`Failed fetching Last-Snapshot: ${result.Error}`)
      }
    } catch (error) {
      this.logger.error(`Exception in getLastSnapshot: ${error.message}`, error.stack)
    }
  }

  public async addScores(stamp: number, scores: AddScoresData): Promise<boolean> {
    if (this.isLive === 'true') {
      try {
        const { messageId, result } = await sendAosMessage({
          processId: this.relayRewardsProcessId,
          signer: this.signer as any, // NB: types, lol
          tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Timestamp', value: stamp.toString() },
          ],
          data: JSON.stringify({
            Scores: scores,
          }),
        })

        if (!result.Error) {
          this.logger.log(`[${stamp}] Add-Scores ${Object.keys(scores).length}: ${messageId ?? 'no-message-id'}`)

          return true
        } else {
          this.logger.error(`Failed storing ${Object.keys(scores).length} scores for ${stamp}: ${result.Error}`)
        }
      } catch (error) {
        this.logger.error(`Exception in addScores: ${error.message}`, error.stack)
      }
    } else {
      this.logger.warn(`NOT LIVE: Not adding ${scores.length} scores to distribution contract `)
    }

    return false
  }

  public async completeRound(stamp: number): Promise<boolean> {
    if (this.isLive !== 'true') {
      this.logger.warn(`NOT LIVE: Not sending the Complete-Round message`)

      return false
    }

    try {
      const { messageId, result } = await sendAosMessage({
        processId: this.relayRewardsProcessId,
        signer: this.signer as any, // NB: types, lol
        tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: stamp.toString() },
        ],
      })

      if (!result.Error) {
        this.logger.log(`[${stamp}] Complete-Round: ${messageId ?? 'no-message-id'}`)

        return true
      } else {
        this.logger.error(`Failed Complete-Round for ${stamp}: ${result.Error}`)
      }
    } catch (error) {
      this.logger.error('Exception in distribute: ${error.message}', error.stack)
    }
    return false
  }
}
