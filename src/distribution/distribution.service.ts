import { Injectable, Logger } from '@nestjs/common'
import { ScoreData } from './schemas/score-data'
import { ConfigService } from '@nestjs/config'
import Bundlr from '@bundlr-network/client'
import _ from 'lodash'
import { RelayRewardsService } from 'src/relay-rewards/relay-rewards.service'
import { AddScoresData } from './dto/add-scores'
import RoundSnapshot from './dto/round-snapshot'

@Injectable()
export class DistributionService {
    private readonly logger = new Logger(DistributionService.name)

    private isLive?: string

    private static readonly scoresPerBatch = 420
    
    private bundler

    constructor(
        private readonly config: ConfigService<{
            IS_LIVE: string
            BUNDLER_NODE: string
            BUNDLER_NETWORK: string
            BUNDLER_CONTROLLER_KEY: string
        }>,
        private readonly relayRewardsService: RelayRewardsService,
    ) {
        this.isLive = config.get<string>('IS_LIVE', { infer: true })

        this.logger.log(
            `Initializing distribution service (IS_LIVE: ${this.isLive})`,
        )
        
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

    public async getCurrentScores(stamp: number): Promise<ScoreData[]> {
        return []
    }

    public async addScores(stamp: number, scores: ScoreData[]): Promise<boolean> {
        const scoresForLua: AddScoresData = {}
        scores.forEach((score) => scoresForLua[score.Fingerprint] = score)

        return this.relayRewardsService.addScores(stamp, scoresForLua)
    }

    public async complete(stamp: number): Promise<boolean> {
        return this.relayRewardsService.completeRound(stamp)
    }

    public async persistRound(stamp: number): Promise<boolean> {
        const snapshot: RoundSnapshot | undefined = await this.relayRewardsService.getLastSnapshot()
            
        if (!snapshot) {
            this.logger.error('Last snapshot not found')
            return false
        }
        if (snapshot.Timestamp != stamp || snapshot.Timestamp != stamp) {
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
                    `NOT LIVE: Not storing distribution/summary [${snapshot.Timestamp}]`
                )

                return false
            }

            const tags = [
                { name: 'Protocol', value: 'ANyONe' },
                { name: 'Protocol-Version', value: '0.2' },
                {
                    name: 'Content-Timestamp',
                    value: snapshot.Timestamp.toString(),
                },
                {
                    name: 'Content-Type',
                    value: 'application/json',
                },
                { name: 'Entity-Type', value: 'distribution/summary' },
                
                { name: 'Time-Elapsed', value: snapshot.Period.toString() },
                { name: 'Distribution-Rate', value: snapshot.Configuration.TokensPerSecond.toString() },
                { name: 'Distributed-Tokens', value: snapshot.Summary.Total.toString() },

                {
                    name: 'Hardware-Bonus-Enabled',
                    value: snapshot.Configuration.Modifiers.Hardware.Enabled.toString()
                },
                {
                    name: 'Hardware-Bonus-Distributed-Tokens',
                    value: snapshot.Summary.Hardware.toString()
                },
                {
                    name: 'Uptime-Bonus-Enabled',
                    value: snapshot.Configuration.Modifiers.Uptime.Enabled.toString()
                },
                {
                    name: 'Uptime-Bonus-Distributed-Tokens',
                    value: snapshot.Summary.Uptime.toString()
                },
                {
                    name: 'Exit-Bonus-Enabled',
                    value: snapshot.Configuration.Modifiers.ExitBonus.Enabled.toString()
                },
                {
                    name: 'Exit-Bonus-Distributed-Tokens',
                    value: snapshot.Summary.ExitBonus.toString()
                },

                {
                    name: 'Family-Multiplier-Enabled',
                    value: snapshot.Configuration.Multipliers.Family.Enabled.toString()
                },
                {
                    name: 'Location-Multiplier-Enabled',
                    value: snapshot.Configuration.Multipliers.Location.Enabled.toString()
                },
                {
                    name: 'Total-Distributed-Tokens',
                    value: snapshot.Summary.Total.toString()
                },
            ]

            const { id: summary_tx } = await this.bundler.upload(
                JSON.stringify(snapshot),
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
