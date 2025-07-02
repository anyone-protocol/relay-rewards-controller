import { Logger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { Wallet } from 'ethers'

import { GeoIpService } from './geo-ip.service'
import { HttpModule } from '@nestjs/axios'

describe('GeoIpService', () => {
  let module: TestingModule
  let service: GeoIpService

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        HttpModule.register({ timeout: 60 * 1000, maxRedirects: 3 })
      ],
      providers: [GeoIpService],
      exports: [GeoIpService]
    })
      .setLogger(new Logger())
      .compile()
    service = module.get<GeoIpService>(GeoIpService)

    await service.onApplicationBootstrap()
  })

  afterEach(async () => {
    await module.close()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('Gets Fingerprint Map OnApplicationBootstrap', () => {
    const fingerprintMapData = service.fingerprintMapData

    expect(Object.keys(fingerprintMapData).length).toBeGreaterThan(0)
  }, 30_000)

  it('Looks up FingerprintGeoLocation', () => {
    const fingerprint = '000263490B3B3EA599ED4C976AA4C3D4987B62ED'

    const fingerprintGeoLocation = service.lookup(fingerprint)

    console.log('Fingerprint Geo Location:', fingerprintGeoLocation)

    expect(fingerprintGeoLocation).not.toBeNull()
  }, 30_000)

  it('Sets lastResponseTimestamp on successful fetch', () => {
    expect(service.lastResponseTimestamp).toBeDefined()
  })

  it('Cache check refreshes data after one week', async () => {
    const initialTimestamp = service.lastResponseTimestamp
    expect(initialTimestamp).toBeDefined()
    console.log('Initial Timestamp:', initialTimestamp)

    // Simulate a cache check after one week
    service.lastResponseTimestamp = initialTimestamp - 8 * 24 * 60 * 60 * 1000

    console.log(
      'Simulated Last Response Timestamp:',
      service.lastResponseTimestamp
    )

    await service.cacheCheck()

    expect(service.fingerprintMapData).not.toEqual({})
    expect(service.lastResponseTimestamp).toBeDefined()
  }, 30_000)
})
