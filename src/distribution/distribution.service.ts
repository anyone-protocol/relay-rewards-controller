import { Inject, Injectable, Logger } from '@nestjs/common'
import { ScoreData } from './schemas/score-data'
import { ConfigService } from '@nestjs/config'
import _ from 'lodash'
import { RelayRewardsService } from 'src/relay-rewards/relay-rewards.service'
import { AddScoresData } from './dto/add-scores'
import RoundSnapshot from './dto/round-snapshot'
import { HttpService } from '@nestjs/axios'
import { AxiosError } from 'axios'
import { firstValueFrom, catchError } from 'rxjs'
import { latLngToCell } from 'h3-js'
import { RelayInfo } from './interfaces/8_3/relay-info'
import { DetailsResponse } from './interfaces/8_3/details-response'
import { OperatorRegistryService } from 'src/operator-registry/operator-registry.service'
import { TasksService } from 'src/tasks/tasks.service'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { UptimeTicks } from './schemas/uptime-ticks'
import { differenceInDays, startOfDay, subDays } from 'date-fns'
import { UptimeStreak } from './schemas/uptime-streak'
import { BundlingService } from '../bundling/bundling.service'
import { ethers } from 'ethers'
import { GeoIpService } from '../geo-ip/geo-ip.service'

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name)

  private isLive?: string

  /**
   * Batch `Add-Scores` by BYTES, not by a fixed count.
   *
   * The constraint that actually exists is the uploader's item size limit: the node pushes every
   * scheduled message to Arweave via up.arweave.net, which caps an item at 5 MiB. The old
   * `scoresPerBatch = 420` predates this stack and encoded a legacynet limit instead, so it split
   * a round into ~15 messages that no longer need splitting.
   *
   * That split is not free. Each message is its own slot, and every slot writes state-sized data:
   * measured at live cardinality, one message per round cut store growth from 167 MiB to 32 MiB
   * per round (5.2x) with no change in wall clock, because the per-relay cost is keccak in the
   * contract and does not care how the scores arrive.
   *
   * It also makes a round ATOMIC. With N batches, some can land and one can fail, and
   * `Complete-Round` will happily settle the incomplete set: relays whose batch went missing are
   * silently under-rewarded. One message either lands or does not.
   *
   * Budgeted at 80% of the cap so tags, the ans104 envelope and any growth between rounds have
   * room. At today's ~260 B/relay that is ~16,100 relays in one message, against 6,010 live.
   */
  private static readonly ITEM_SIZE_LIMIT = 5 * 1024 * 1024
  private static readonly maxBatchBytes = Math.floor(
    DistributionService.ITEM_SIZE_LIMIT * 0.8
  )
  private readonly useHodler: boolean

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      ONIONOO_DETAILS_URI: string
      DETAILS_URI_AUTH: string
      USE_HODLER: string
    }>,
    private readonly relayRewardsService: RelayRewardsService,
    private readonly operatorRegistryService: OperatorRegistryService,
    private readonly httpService: HttpService,
    private readonly tasksService: TasksService,
    @InjectModel(UptimeTicks.name)
    private readonly uptimeTicksModel: Model<UptimeTicks>,
    @InjectModel(UptimeStreak.name)
    private readonly uptimeStreakModel: Model<UptimeStreak>,
    private readonly bundlingService: BundlingService,
    private readonly geoipService: GeoIpService
  ) {
    this.isLive = config.get<string>('IS_LIVE', { infer: true })

    this.useHodler = this.config.get<string>('USE_HODLER', { infer: true }) === 'true'

    this.logger.log(
      `Initializing distribution service (IS_LIVE: ${this.isLive}, USE_HODLER: ${this.useHodler})`
    )
  }

  public groupScoreJobs(data: ScoreData[]): ScoreData[][] {
    // Mirror what addScores actually puts on the wire: {"Scores":{"<fp>":{...},...}}
    const ENVELOPE = '{"Scores":{}}'.length
    // "<fp>": {...} plus the separating comma
    const entrySize = (s: ScoreData) =>
      s.Fingerprint.length + JSON.stringify(s).length + 4

    const groups: ScoreData[][] = []
    let current: ScoreData[] = []
    let bytes = ENVELOPE

    for (const score of data) {
      const size = entrySize(score)
      // Never emit an empty group: a single score wider than the budget still has to go, since
      // there is nothing left to split. It would fail at upload, loudly, rather than silently here.
      if (current.length > 0 && bytes + size > DistributionService.maxBatchBytes) {
        groups.push(current)
        current = []
        bytes = ENVELOPE
      }
      current.push(score)
      bytes += size
    }
    if (current.length > 0) {
      groups.push(current)
    }

    const budgetKB = Math.round(DistributionService.maxBatchBytes / 1024)
    const largest = groups.reduce(
      (max, g) => Math.max(max, g.reduce((b, s) => b + entrySize(s), ENVELOPE)),
      0
    )
    this.logger.log(
      `Grouped ${data.length} scores into ${groups.length} message(s), ` +
        `largest ${Math.round(largest / 1024)}KB of a ${budgetKB}KB budget`
    )

    return groups
  }

  private async fetchRelays(): Promise<RelayInfo[]> {
    var relays: RelayInfo[] = []
    const detailsUri = this.config.get<string>('ONIONOO_DETAILS_URI', {
      infer: true,
    })
    if (detailsUri !== undefined) {
      const detailsAuth: string =
        this.config.get<string>('DETAILS_URI_AUTH', {
          infer: true,
        }) || ''
      const requestStamp = Date.now()
      try {
        const { headers, status, data } = await firstValueFrom(
          this.httpService
            .get<DetailsResponse>(detailsUri, {
              headers: {
                'content-encoding': 'gzip',
                authorization: `${detailsAuth}`,
              },
              validateStatus: status => status === 304 || status === 200,
            })
            .pipe(
              catchError((error: AxiosError) => {
                this.logger.error(
                  `Fetching relays from ${detailsUri} failed with ${error.response?.status ?? '?'}, ${error}`
                )
                throw 'Failed to fetch relay details'
              })
            )
        )

        this.logger.debug(`Fetch details from ${detailsUri} response ${status}`)
        if (status === 200) {
          relays = data.relays

          this.logger.log(`Received ${relays.length} relays from network details`)
        } else this.logger.debug('No relay updates from network details')
      } catch (e) {
        this.logger.error('Exception when fetching details of network relays', e.stack)
      }
    } else this.logger.warn('Set the ONIONOO_DETAILS_URI in ENV vars or configuration')

    return relays
  }

  private fingerprintToGeoHex(fingerprint: string): string {
    const fingerprintGeolocation = this.geoipService.lookup(fingerprint)
    if (fingerprintGeolocation) {
      const [lat, lng] = fingerprintGeolocation.coordinates
      return latLngToCell(lat, lng, 4) // resolution 4 - avg hex area 1,770 km^2
    } else return '?'
  }

  private parseLocations(
    relays: RelayInfo[],
    verificationData: { [key: string]: string }
  ): { sizes: { [key: string]: number }; cells: { [key: string]: string } } {
    const sizes: { [key: string]: number } = {}
    const cells: { [key: string]: string } = {}

    relays.forEach(relay => {
      if (verificationData[relay.fingerprint]) {
        const cell = this.fingerprintToGeoHex(relay.fingerprint)
        cells[relay.fingerprint] = cell
        if (sizes[cell] == undefined) sizes[cell] = 0
        sizes[cell] += 1
      }
    })

    return { sizes, cells }
  }

  private async fetchUptimeStreaks(stamp: number, fingerprints: { [key: string]: string }): Promise<{ [key: string]: number }> {
    const startOfToday = startOfDay(new Date(stamp))
    
    const trackedStreaks: UptimeStreak[] = await this.uptimeStreakModel.find({ last: startOfToday.getTime() })
    const streaks = {}
    trackedStreaks.forEach((streak) => {
      if (streak.last > 0) {
        streaks[streak._id] = differenceInDays(new Date(streak.last), new Date(streak.start))
      } else {
        streaks[streak._id] = 0
      }
    })
    this.logger.log(`Tracked uptime streaks: ${trackedStreaks.length}`)

    return streaks
  }

  private async trackUptime(stamp: number, fingerprints: string[]): Promise<void> {
    const maxDailyTicks = Math.ceil((1000 * 60 * 60 * 24) / this.tasksService.minRoundLength)
    
    const updates = fingerprints.map(fingerprint => ({
      insertOne: {
        document: { fingerprint, stamp }
      }
    }))

    const batchSize = 1000
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + 1000)
      await this.uptimeTicksModel.bulkWrite(batch)
      this.logger.log(`Tracking uptime (phase 1/3): prepared uptime ticks batch ${i / batchSize + 1}`)
    }
    
    const timestamp = new Date(stamp)
    const startOfToday = startOfDay(timestamp)
    const yesterday = subDays(timestamp, 1)
    const startOfYesterday = startOfDay(yesterday)
    
    await this.uptimeStreakModel.deleteMany({ last: { $lt: startOfYesterday.getTime() }})
    await this.uptimeTicksModel.deleteMany({ stamp: { $lt: startOfYesterday.getTime() }})

    const requiredTicksPerDay = Math.ceil(maxDailyTicks * 0.6)
    const aggregateQuery = [
      {
        $match: {
          stamp: {
            $gte: startOfYesterday.getTime(),
            $lt: startOfToday.getTime()
          }
        }
      },
      {  
        $group: {
          _id: '$fingerprint',
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gte: requiredTicksPerDay }
        }
      },
    ]
    const scope: { _id: string, count: number}[] = await this.uptimeTicksModel.aggregate(aggregateQuery)
    this.logger.log(`Tracking uptime (phase 2/3): aggregate size: ${scope.length} for query ${JSON.stringify(aggregateQuery)}`)
    
    const streaks = scope.map((value) => ({ 
      updateOne: {
        filter: { _id: value._id },
        update: {
          $min: { start: startOfYesterday.getTime() }, $max: { last: startOfToday.getTime() }, 
          $setOnInsert: { _id: value._id } 
        },
        upsert: true
      }
    }))

    for (let i = 0; i < streaks.length; i += batchSize) {
      const batch = streaks.slice(i, i + batchSize)
      await this.uptimeStreakModel.bulkWrite(batch)
      this.logger.log(`Tracking uptime (phase 3/3): stored uptime streaks batch ${i / batchSize + 1}`)
    }
    
    return
  }

  public async getCurrentScores(stamp: number): Promise<ScoreData[]> {
    const relaysData = await this.fetchRelays()
    const { locksData, stakingData } = await this.relayRewardsService.getHodlerData()
    const { verified: verificationData, hardware: hardwareData } =
      await this.operatorRegistryService.getOperatorRegistryScoring()
    const uptimeStreaks = await this.fetchUptimeStreaks(stamp, verificationData)
    await this.geoipService.cacheCheck()
    const { sizes, cells } = this.parseLocations(relaysData, verificationData)

    const scores: ScoreData[] = []
    const uptimeTicks: string[] = []

    relaysData.forEach(relay => {
      if (relay.running && relay.consensus_weight > 0) {
        const verifiedAddress = verificationData[relay.fingerprint]

        if (verifiedAddress && verifiedAddress.length > 0) {
          const pVA = ethers.getAddress(verifiedAddress)

          if (!this.useHodler || 
            ( hardwareData[relay.fingerprint] ||
              (locksData[relay.fingerprint] && locksData[relay.fingerprint].includes(pVA))
            )
          ) {
            const locationCell = cells[relay.fingerprint] ?? ''
            const locationSize = sizes[locationCell] ?? 0
            const score: ScoreData = {
              Fingerprint: relay.fingerprint,
              Address: verifiedAddress,
              Network: relay.consensus_weight,
              FamilySize: (relay.effective_family?.length ?? 1) - 1,
              IsHardware: hardwareData[relay.fingerprint] ?? false,
              LocationSize: locationSize - 1,
              UptimeStreak: uptimeStreaks[relay.fingerprint] ?? 0,
              ExitBonus: relay.flags?.includes('Exit') ?? false,
            }
            scores.push(score)
            uptimeTicks.push(relay.fingerprint)
          }
        } else {
          // this.logger.debug(`Found unverified relay in network details ${relay.fingerprint}`)
        }
      }
    })

    await this.trackUptime(stamp, uptimeTicks)

    return scores
  }

  public async addScores(stamp: number, scores: ScoreData[]): Promise<boolean> {
    const scoresForLua: AddScoresData = {}
    scores.forEach(score => (scoresForLua[score.Fingerprint] = score))

    return this.relayRewardsService.addScores(stamp, scoresForLua)
  }

  /**
   * Settle the round. Returns the SLOT of the Complete-Round message (or undefined if it did
   * not settle) — the round's full snapshot, including per-fingerprint Details, is that slot's
   * output and exists nowhere else. persistRound needs it.
   */
  public async complete(stamp: number): Promise<string | undefined> {
    const slot = await this.relayRewardsService.completeRound(stamp)
    if (slot) {
      this.tasksService.updateDistribution(stamp, true, false)
    }
    return slot
  }

  public async persistRound(stamp: number, slot: string): Promise<boolean> {
    const snapshot: RoundSnapshot | undefined =
      await this.relayRewardsService.getLastSnapshot(slot)

    if (!snapshot || snapshot.Timestamp == 0) {
      this.logger.error('Last snapshot not found')
      return false
    }

    if (snapshot.Timestamp != stamp || snapshot.Timestamp != stamp) {
      this.logger.warn(
        "Different stamp in returned for previous round. Skipping persistence as either there is a newer one, or can't confirm the round was sucessfully completed"
      )
      return false
    }
    try {
      if (this.isLive !== 'true') {
        this.logger.warn(`NOT LIVE: Not storing distribution/summary [${snapshot.Timestamp}]`)

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
        { name: 'Distributed-Tokens', value: snapshot.Summary.Rewards.Total },

        {
          name: 'Hardware-Bonus-Enabled',
          value: snapshot.Configuration.Modifiers.Hardware.Enabled.toString(),
        },
        {
          name: 'Hardware-Bonus-Distributed-Tokens',
          value: snapshot.Summary.Rewards.Hardware.toString(),
        },
        {
          name: 'Uptime-Bonus-Enabled',
          value: snapshot.Configuration.Modifiers.Uptime.Enabled.toString(),
        },
        {
          name: 'Uptime-Bonus-Distributed-Tokens',
          value: snapshot.Summary.Rewards.Uptime.toString(),
        },
        {
          name: 'Exit-Bonus-Enabled',
          value: snapshot.Configuration.Modifiers.ExitBonus.Enabled.toString(),
        },
        {
          name: 'Exit-Bonus-Distributed-Tokens',
          value: snapshot.Summary.Rewards.ExitBonus.toString(),
        },

        {
          name: 'Family-Multiplier-Enabled',
          value: snapshot.Configuration.Multipliers.Family.Enabled.toString(),
        },
        {
          name: 'Location-Multiplier-Enabled',
          value: snapshot.Configuration.Multipliers.Location.Enabled.toString(),
        },
        {
          name: 'Total-Distributed-Tokens',
          value: snapshot.Summary.Rewards.Total,
        },
      ]

      const { id: summary_tx } = await this.bundlingService.upload(
        Buffer.from(JSON.stringify(snapshot)),
        { tags }
      )

      this.logger.log(`Permanently stored distribution/summary [${stamp}]: ${summary_tx}`)
      this.tasksService.updateDistribution(stamp, true, true)
      return true
    } catch (error) {
      this.logger.error(`Exception in distribution service persisting round: ${error.message}`, error.stack)
    }

    return false
  }
}
