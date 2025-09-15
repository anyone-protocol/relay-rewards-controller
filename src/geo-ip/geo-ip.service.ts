import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'

interface FingerprintGeoLocation {
  hexId: string
  coordinates: [number, number] // [lat, lon]
}

interface FingerprintGeoLocationMap { 
  [fingerprint:string]: FingerprintGeoLocation
}

const DEFAULT_CACHE_TTL = 60 * 60 * 1000 // 1 hour in milliseconds

@Injectable()
export class GeoIpService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeoIpService.name)
  public fingerprintMapData: FingerprintGeoLocationMap = {}
  public lastResponseTimestamp: number | undefined
  private readonly anyoneApiUrl: string
  private readonly anyoneApiCacheTtl: number

  constructor(
    readonly config: ConfigService<{
      ANYONE_API_URL: string
      ANYONE_API_CACHE_TTL?: number
    }>,
    private readonly httpService: HttpService
  ) {
    this.logger.log('Initializing geo ip service')

    this.anyoneApiUrl = config.get<string>(
      'ANYONE_API_URL',
      { infer: true }
    )
    if (!this.anyoneApiUrl) {
      throw new Error('ANYONE_API_URL is not set!')
    }

    this.anyoneApiCacheTtl = config.get<number>(
      'ANYONE_API_CACHE_TTL',
      { infer: true }
    ) || DEFAULT_CACHE_TTL

    this.logger.log(
      `Initialized geo ip service with Anyone API Url [${this.anyoneApiUrl}]`
      + ` and cache TTL [${this.anyoneApiCacheTtl}] ms`
    )
  }

  async onApplicationBootstrap() {
    await this.fetchFingerprintMapData()
  }

  async cacheCheck() {
    this.logger.log('Checking fingerprint map cache...')
    const elapsedSinceLastResponse = this.lastResponseTimestamp && Date.now()
      - new Date(this.lastResponseTimestamp).getTime()
    if (elapsedSinceLastResponse > this.anyoneApiCacheTtl) {
      this.logger.log(
        `Refreshing fingerprint map data after `
        + `[${elapsedSinceLastResponse}] ms`
      )
      await this.fetchFingerprintMapData()
    } else {
      this.logger.log(
        `Fingerprint map data is fresh, last updated `
        + `[${elapsedSinceLastResponse}] ms ago`
      )
    }
  }

  lookup(fingerprint: string): FingerprintGeoLocation | null {
    if (Object.keys(this.fingerprintMapData).length === 0) {
      this.logger.warn(
        'Fingerprint map data is empty, cannot perform fingerprint lookup'
      )

      return null
    }

    if (!this.fingerprintMapData[fingerprint]) {
      this.logger.warn(
        `No geolocation data found for fingerprint: [${fingerprint}]`
      )
      return null
    }

    this.logger.debug(`Looking up geolocation for fingerprint: [${fingerprint}]`)
    return this.fingerprintMapData[fingerprint]
  }

  private async fetchFingerprintMapData() {
    try {
      this.logger.log('Fetching latest fingerprint-map data from Anyone API...')
      
      const fingerprintMapUrl = `${this.anyoneApiUrl}/fingerprint-map`
      const response = await firstValueFrom(
        this.httpService.get<FingerprintGeoLocationMap>(fingerprintMapUrl)
      )
      
      this.fingerprintMapData = response.data
      this.lastResponseTimestamp = new Date(response.headers['date']).getTime()
      this.logger.log(
        `Successfully fetched relay map data`
        + ` [${Object.keys(this.fingerprintMapData).length}]`
        + ` cells loaded with last response timestamp`
        + ` [${this.lastResponseTimestamp}]`
      )
    } catch (error) {
      this.logger.error(
        'Failed to fetch relay map data from Anyone API',
        error instanceof Error ? error.stack : error
      )
    }
  }
}
