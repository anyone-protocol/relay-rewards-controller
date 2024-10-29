import { Injectable, Logger } from '@nestjs/common'
import { ScoreData } from './schemas/score-data'
import { ConfigService } from '@nestjs/config'
import Bundlr from '@bundlr-network/client'
import { HttpService } from '@nestjs/axios'

import {
    AosSigningFunction,
    sendAosDryRun,
    sendAosMessage
  } from '../util/send-aos-message'
  import { createEthereumDataItemSigner } from '../util/create-ethereum-data-item-signer'
  import { EthereumSigner } from '../util/arbundles-lite'
import { Wallet } from 'ethers'
import _ from 'lodash'
import RoundMetadata from './dto/round-metadata'
import RoundData from './dto/round-data'

@Injectable()
export class DistributionService {
    private readonly logger = new Logger(DistributionService.name)

    private isLive?: string

    private static readonly scoresPerBatch = 420

    private readonly relayRewardsProcessId: string
    private readonly relayRewardsControllerKey: string
      
    private signer!: AosSigningFunction
    
    private bundler

    constructor(
        private readonly config: ConfigService<{
            IS_LIVE: string
            RELAY_REWARDS_PROCESS_ID: string
            RELAY_REWARDS_CONTROLLER_KEY: string
            BUNDLER_NODE: string
            BUNDLER_NETWORK: string
            BUNDLER_CONTROLLER_KEY: string
        }>,
        private readonly httpService: HttpService,
    ) {
        this.isLive = config.get<string>('IS_LIVE', { infer: true })

        this.logger.log(
            `Initializing distribution service (IS_LIVE: ${this.isLive})`,
        )

        const controllerKey = this.config.get<string>(
            'RELAY_REWARDS_CONTROLLER_KEY',
            {
                infer: true,
            },
        )
        if (controllerKey !== undefined) {
            this.relayRewardsControllerKey = controllerKey
        }
        
        const bundlerKey = this.config.get<string>(
            'BUNDLER_CONTROLLER_KEY',
            {
                infer: true,
            },
        )
        if (bundlerKey !== undefined) {            
            this.bundler = (() => {
                const node = config.get<string>('BUNDLER_NODE', {
                    infer: true,
                })
                const network = config.get<string>('BUNDLER_NETWORK', {
                    infer: true,
                })
                if (node !== undefined && network !== undefined) {
                    return new Bundlr(node, network, bundlerKey)
                } else {
                    return undefined
                }
            })()

            if (this.bundler !== undefined) {
                this.logger.log(
                    `Initialized bundler for address: ${this.bundler.address}`,
                )
            } else {
                this.logger.error('Failed to initialize bundler!')
            }
        } else this.logger.error('Missing key of the bundler\'s controller.')

        const relayRewardsPid = this.config.get<string>(
            'RELAY_REWARDS_PROCESS_ID',
            {
                infer: true,
            },
        )
        if (relayRewardsPid != undefined) {
            this.relayRewardsProcessId = relayRewardsPid
        } else this.logger.error('Missing relay rewards process id')

        const relayRewardsKey = this.config.get<string>(
            'RELAY_REWARDS_CONTROLLER_KEY',
            {
                infer: true,
            },
        )

        if (relayRewardsKey != undefined) {
            this.relayRewardsControllerKey = relayRewardsKey
        } else this.logger.error('Missing relay rewards controller key')
    }

    async onApplicationBootstrap(): Promise<void> {
        this.signer = await createEthereumDataItemSigner(
            new EthereumSigner(this.relayRewardsControllerKey)
            )
        const wallet = new Wallet(this.relayRewardsControllerKey)
        const address = await wallet.getAddress()
        this.logger.log(`Bootstrapped with signer address ${address}`)
    }

    public groupScoreJobs(data: ScoreData[]): ScoreData[][] {
        const result = data.reduce<ScoreData[][]>(
            (curr, score): ScoreData[][] => {
                if (curr.length == 0) {
                    curr.push([score])
                } else {
                    if (
                        curr[curr.length - 1].length <
                        DistributionService.scoresPerBatch
                    ) {
                        const last = curr.pop()
                        if (last != undefined) {
                            last.push(score)
                            curr.push(last)
                        } else {
                            this.logger.error('Last element not found, this should not happen')
                        }
                    } else {
                        curr.push([score])
                    }
                }
                return curr
            },
            [],
        )

        this.logger.debug(
            `Created ${result.length} groups out of ${data.length}`,
        )

        return result
    }

    public async addScores(stamp: number, scores: ScoreData[]): Promise<boolean> {
        const scoresForLua: {
            [key: string]: Omit<ScoreData, 'Fingerprint'>
        } = {}
        scores.forEach((score) => scoresForLua[score.Fingerprint] = score)

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
                        Scores: scoresForLua
                    })
                })
        
                if (!result.Error) {
                    this.logger.log(
                        `[${stamp}] Add-Scores ${scores.length}: ${messageId ?? 'no-message-id'}`
                    )
            
                    return true
                } else {
                    this.logger.error(
                        `Failed storing ${scores.length} scores for ${stamp}: ${result.Error}`,
                    )
                }
            } catch (error) {
                this.logger.error(`Exception in addScores`, error.stack)
            }
        } else {
            this.logger.warn(
                `NOT LIVE: Not adding ${scores.length} scores to distribution contract `,
            )
        }
        
        return false
    }

    public async complete(stamp: number): Promise<boolean> {
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
                ]
            })
    
            if (!result.Error) {
                this.logger.log(
                    `[${stamp}] Complete-Round: ${messageId ?? 'no-message-id'}`
                )
        
                return true
            } else {
                this.logger.error(
                    `Failed Complete-Round for ${stamp}: ${result.Error}`,
                )
            }
        } catch (error) {
            this.logger.error('Exception in distribute', error.stack)
        }
        return false
    }

    public async persistRound(stamp: number): Promise<boolean> {
        const metadata: RoundMetadata = ...
        const data: RoundData = ...
            
        if (data.Timestamp != stamp || metadata.Timestamp != stamp) {
            this.logger.warn('Different stamp in returned for previous round. Skipping persistence as either there is a newer one, or can\'t confirm the round was sucessfully completed')
            return false
        }
        try {
            if (!this.bundler) {
                this.logger.error('Bundler not initialized to persist distribution/summary')
                return false
            }

            if (this.isLive !== 'true') {
                this.logger.warn(
                    `NOT LIVE: Not storing distribution/summary [${data.Timestamp}]`
                )

                return false
            }

            const tags = [
                { name: 'Protocol', value: 'ANyONe' },
                { name: 'Protocol-Version', value: '0.2' },
                {
                    name: 'Content-Timestamp',
                    value: data.Timestamp.toString(),
                },
                {
                    name: 'Content-Type',
                    value: 'application/json',
                },
                { name: 'Entity-Type', value: 'distribution/summary' },
                
                { name: 'Time-Elapsed', value: data.Period.toString() },
                { name: 'Distribution-Rate', value: metadata.Configuration.TokensPerSecond.toString() },
                { name: 'Distributed-Tokens', value: metadata.Summary.Total.toString() },

                {
                    name: 'Hardware-Bonus-Enabled',
                    value: metadata.Configuration.Modifiers.Hardware.Enabled.toString()
                },
                {
                    name: 'Hardware-Bonus-Distributed-Tokens',
                    value: metadata.Summary.Hardware.toString()
                },
                {
                    name: 'Uptime-Bonus-Enabled',
                    value: metadata.Configuration.Modifiers.Uptime.Enabled.toString()
                },
                {
                    name: 'Uptime-Bonus-Distributed-Tokens',
                    value: metadata.Summary.Uptime.toString()
                },
                {
                    name: 'Exit-Bonus-Enabled',
                    value: metadata.Configuration.Modifiers.ExitBonus.Enabled.toString()
                },
                {
                    name: 'Exit-Bonus-Distributed-Tokens',
                    value: metadata.Summary.ExitBonus.toString()
                },

                {
                    name: 'Family-Multiplier-Enabled',
                    value: metadata.Configuration.Multipliers.Family.Enabled.toString()
                },
                {
                    name: 'Location-Multiplier-Enabled',
                    value: metadata.Configuration.Multipliers.Location.Enabled.toString()
                },
                {
                    name: 'Total-Distributed-Tokens',
                    value: metadata.Summary.Total.toString()
                },
            ]

            const { id: summary_tx } = await this.bundler.upload(
                JSON.stringify({ ...metadata, ...data }),
                { tags }
            )

            this.logger.log(
                `Permanently stored distribution/summary [${stamp}]: ${summary_tx}`
            )

            return true
        } catch (error) {
            this.logger.error(
                'Exception in distribution service persisting round',
                error.stack
            )
        }

        return false
    }
}
