import { Injectable, Logger } from '@nestjs/common'
import { ScoreData } from './schemas/score-data'
import { ConfigService } from '@nestjs/config'
import Bundlr from '@bundlr-network/client'
import _ from 'lodash'
import { RelayRewardsService } from 'src/relay-rewards/relay-rewards.service'
import { AddScoresData } from './dto/add-scores'
import RoundSnapshot from './dto/round-snapshot'
import { HttpService } from '@nestjs/axios'
import { AxiosError } from 'axios'
import { firstValueFrom, catchError } from 'rxjs'
import { latLngToCell } from 'h3-js'
import * as geoip from 'geoip-lite'
import { RelayInfo } from './interfaces/8_3/relay-info'
import { DetailsResponse } from './interfaces/8_3/details-response'
import { OperatorRegistryService } from 'src/operator-registry/operator-registry.service'

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
            ONIONOO_DETAILS_URI: string
            DETAILS_URI_AUTH: string
        }>,
        private readonly relayRewardsService: RelayRewardsService,
        private readonly operatorRegistryService: OperatorRegistryService,
        private readonly httpService: HttpService,
    ) {
        this.isLive = config.get<string>('IS_LIVE', { infer: true })
        geoip.startWatchingDataUpdate()

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

    private async fetchRelays(): Promise<RelayInfo[]> {

        var relays: RelayInfo[] = []
        const detailsUri = this.config.get<string>('ONIONOO_DETAILS_URI', {
            infer: true,
        })
        if (detailsUri !== undefined) {
            const detailsAuth: string = this.config.get<string>('DETAILS_URI_AUTH', {
                infer: true,
            }) || ""
            const requestStamp = Date.now()
            try {
                const { headers, status, data } = await firstValueFrom(
                    this.httpService
                        .get<DetailsResponse>(detailsUri, {
                            headers: {
                                'content-encoding': 'gzip',
                                'authorization': `${detailsAuth}`
                            },
                            validateStatus: (status) =>
                                status === 304 || status === 200,
                        })
                        .pipe(
                            catchError((error: AxiosError) => {
                                this.logger.error(
                                    `Fetching relays from ${detailsUri} failed with ${error.response?.status??"?"}, ${error}`,
                                )
                                throw 'Failed to fetch relay details'
                            }),
                        ),
                )

                this.logger.debug(
                    `Fetch details from ${detailsUri} response ${status}`,
                )
                if (status === 200) {
                    relays = data.relays

                    this.logger.log(
                        `Received ${relays.length} relays from network details`,
                    )
                } else this.logger.debug('No relay updates from network details')
            } catch (e) {
                this.logger.error('Exception when fetching details of network relays', e.stack)
            }
        } else
            this.logger.warn(
                'Set the ONIONOO_DETAILS_URI in ENV vars or configuration',
            )

        return relays
    }

    private ipToGeoHex(ip: string): string {
        let portIndex = ip.indexOf(':')
        let cleanIp = ip.substring(0, portIndex)
        let lookupRes = geoip.lookup(cleanIp)?.ll
        if (lookupRes != undefined) {
            let [lat, lng] = lookupRes
            return latLngToCell(lat, lng, 4) // resolution 4 - avg hex area 1,770 km^2
        } else return '?'
    }

    private parseLocations(
        relays: RelayInfo[], verificationData: { [key: string]: string }
    ): { sizes: { [key: string]: number }, cells: { [key: string]: string } } {
        
        const sizes: { [key: string]: number } = {}
        const cells: { [key: string]: string } = {}
        
        relays.forEach((relay) => {
            if (verificationData[relay.fingerprint]) {
                const cell = this.ipToGeoHex(relay.or_addresses[0])
                cells[relay.fingerprint] = cell
                if (sizes[cell] == undefined) sizes[cell] = 0
                sizes[cell] += 1
            }
        })

        return { sizes, cells }
    }

    private async fetchUptimeStreaks(fingerprints: string[]): Promise<{ [key: string]: number}> {
        return {}
    }

    public async getCurrentScores(stamp: number): Promise<ScoreData[]> {
        const relaysData = await this.fetchRelays()
        const verificationData = await this.operatorRegistryService.fetchVerifiedOperators()
        const hardwareData = await this.operatorRegistryService.fetchHardwareFingerprints()
        const uptimeStreaks = await this.fetchUptimeStreaks(Object.keys(verificationData))

        const { sizes, cells } = this.parseLocations(relaysData, verificationData)

        const scores: ScoreData[] = []
        
        relaysData.forEach((relay) => {
            const verifiedAddress = verificationData[relay.fingerprint]
            if (verifiedAddress && verifiedAddress.length > 0) {
                const locationCell = cells[relay.fingerprint]??''
                const locationSize = sizes[locationCell]??0
                const score: ScoreData = {
                    Fingerprint: relay.fingerprint,
                    Address: verifiedAddress,
                    Network: relay.consensus_weight,
                    FamilySize: (relay.effective_family?.length??1) - 1,
                    IsHardware: hardwareData[relay.fingerprint]??false,
                    LocationSize: locationSize - 1,
                    UptimeStreak: uptimeStreaks[relay.fingerprint]??0,
                    ExitBonus: relay.flags?.includes('Exit')??false
                }
                scores.push(score)
            } else {
                this.logger.debug(`Found unverified relay in network details ${relay.fingerprint}`)
            }
        })

        return scores
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
