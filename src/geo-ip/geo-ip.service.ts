import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { cellToLatLng, latLngToCell } from 'h3-js'

interface FingerprintGeoLocation {
  hexId: string
  coordinates: [number, number] // [lat, lon]
}

interface FingerprintGeoLocationMap {
  [fingerprint: string]: FingerprintGeoLocation
}

export interface LocatableRelay {
  fingerprint: string
  or_addresses?: string[]
}

interface LookupItem {
  address: string
  status: 'found' | 'not-found' | 'invalid'
  location?: { coordinates?: { latitude: number, longitude: number } }
}

interface LookupResponse {
  results: LookupItem[]
}

const H3_RESOLUTION = 4
const LOOKUP_BATCH_SIZE = 10_000
const LOOKUP_TIMEOUT_MS = 30_000

@Injectable()
export class GeoIpService {
  private readonly logger = new Logger(GeoIpService.name)
  public fingerprintMapData: FingerprintGeoLocationMap = {}
  private readonly geoIpServiceUrl: string

  constructor(
    readonly config: ConfigService<{
      GEO_IP_SERVICE_URL: string
    }>,
    private readonly httpService: HttpService
  ) {
    this.logger.log('Initializing geo ip service')

    this.geoIpServiceUrl = config.get<string>(
      'GEO_IP_SERVICE_URL',
      { infer: true }
    )
    if (!this.geoIpServiceUrl) {
      throw new Error('GEO_IP_SERVICE_URL is not set!')
    }

    this.logger.log(
      `Initialized geo ip service with geo-ip-service Url [${this.geoIpServiceUrl}]`
    )
  }

  async resolve(relays: LocatableRelay[]): Promise<void> {
    const addressed = relays.flatMap(relay => {
      const address = relay.or_addresses?.[0]?.split(':')[0]
      return address ? [{ fingerprint: relay.fingerprint, address }] : []
    })
    const addresses = [...new Set(addressed.map(({ address }) => address))]

    try {
      this.logger.log(
        `Resolving [${addresses.length}] relay addresses through geo-ip-service...`
      )

      const located = new Map<string, FingerprintGeoLocation>()
      for (let i = 0; i < addresses.length; i += LOOKUP_BATCH_SIZE) {
        const response = await firstValueFrom(
          this.httpService.post<LookupResponse>(
            `${this.geoIpServiceUrl}/lookup`,
            { addresses: addresses.slice(i, i + LOOKUP_BATCH_SIZE) },
            { timeout: LOOKUP_TIMEOUT_MS }
          )
        )
        for (const item of response.data.results) {
          const location = GeoIpService.toLocation(item)
          if (location) located.set(item.address, location)
        }
      }

      const fingerprintMapData: FingerprintGeoLocationMap = {}
      for (const { fingerprint, address } of addressed) {
        const location = located.get(address)
        if (location) fingerprintMapData[fingerprint] = location
      }
      this.fingerprintMapData = fingerprintMapData

      this.logger.log(
        `Resolved locations of [${Object.keys(fingerprintMapData).length}]`
        + ` of [${relays.length}] relays`
      )
    } catch (error) {
      this.logger.error(
        'Failed to resolve relay locations through geo-ip-service,'
        + ' keeping previous relay locations',
        error instanceof Error ? error.stack : error
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

  private static toLocation(item: LookupItem): FingerprintGeoLocation | undefined {
    if (item.status !== 'found') return undefined
    const { latitude, longitude } = item.location?.coordinates ?? {}
    if (!latitude || !longitude) return undefined

    const hexId = latLngToCell(latitude, longitude, H3_RESOLUTION)
    const [cellLatitude, cellLongitude] = cellToLatLng(hexId)
    return { hexId, coordinates: [cellLatitude, cellLongitude] }
  }
}
