import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { Test, TestingModule } from '@nestjs/testing'
import { cellToLatLng, latLngToCell } from 'h3-js'

import { GeoIpService } from './geo-ip.service'

const STOCKHOLM = { latitude: 59.3293, longitude: 18.0686 }
const NEW_YORK = { latitude: 40.7128, longitude: -74.006 }

const LOCATIONS: Record<string, { latitude: number, longitude: number }> = {
  '89.160.20.112': STOCKHOLM,
  '1.2.3.4': NEW_YORK,
  '5.6.7.8': { latitude: 0, longitude: 12.5 }
}

describe('GeoIpService', () => {
  let stub: Server
  let stubUrl: string
  let requests: string[][]
  let respond: (addresses: string[], res: ServerResponse) => void
  let module: TestingModule | undefined
  let tempDir: string

  const answerFromLocations = (addresses: string[], res: ServerResponse) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      results: addresses.map(address => LOCATIONS[address]
        ? { address, status: 'found', location: { coordinates: LOCATIONS[address], countryCode: 'XX' } }
        : { address, status: 'not-found' })
    }))
  }

  const createService = async (env: Record<string, string>) => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, skipProcessEnv: true, load: [() => env] }),
        HttpModule
      ],
      providers: [GeoIpService]
    }).compile()
    return module.get<GeoIpService>(GeoIpService)
  }

  const cellCenter = (point: { latitude: number, longitude: number }) => {
    const hexId = latLngToCell(point.latitude, point.longitude, 4)
    return { hexId, coordinates: cellToLatLng(hexId) }
  }

  beforeAll(async () => {
    stub = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        if (req.method !== 'POST' || req.url !== '/lookup') {
          res.statusCode = 404
          res.end()
          return
        }
        const { addresses } = JSON.parse(body)
        requests.push(addresses)
        respond(addresses, res)
      })
    })
    await new Promise<void>(resolve => stub.listen(0, '127.0.0.1', resolve))
    stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise(resolve => stub.close(resolve))
  })

  beforeEach(() => {
    requests = []
    respond = answerFromLocations
    tempDir = mkdtempSync(join(tmpdir(), 'geo-ip-service-'))
  })

  afterEach(async () => {
    await module?.close()
    module = undefined
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('requires exactly one of the url settings', async () => {
    await expect(createService({})).rejects.toThrow('Exactly one of')
    await expect(createService({
      GEO_IP_SERVICE_URL: stubUrl,
      GEO_IP_SERVICE_URL_FILE: join(tempDir, 'url')
    })).rejects.toThrow('Exactly one of')
  })

  it('places each relay in the H3 resolution 4 cell of its primary address', async () => {
    const service = await createService({ GEO_IP_SERVICE_URL: stubUrl })

    await service.resolve([
      { fingerprint: 'A', or_addresses: ['89.160.20.112:9001', '[2001:db8::1]:9001'] },
      { fingerprint: 'B', or_addresses: ['1.2.3.4:443'] },
      { fingerprint: 'C', or_addresses: ['89.160.20.112:9002'] }
    ])

    expect(requests).toEqual([['89.160.20.112', '1.2.3.4']])
    expect(service.lookup('A')).toEqual(cellCenter(STOCKHOLM))
    expect(service.lookup('B')).toEqual(cellCenter(NEW_YORK))
    expect(service.lookup('C')).toEqual(cellCenter(STOCKHOLM))
    const { hexId, coordinates: [lat, lng] } = service.lookup('A')!
    expect(latLngToCell(lat, lng, 4)).toBe(hexId)
  })

  it('leaves out relays without an address, without a location or with a zero coordinate', async () => {
    const service = await createService({ GEO_IP_SERVICE_URL: stubUrl })

    await service.resolve([
      { fingerprint: 'A', or_addresses: ['89.160.20.112:9001'] },
      { fingerprint: 'NO_ADDRESS', or_addresses: [] },
      { fingerprint: 'NO_FIELD' },
      { fingerprint: 'NOT_FOUND', or_addresses: ['10.0.0.1:9001'] },
      { fingerprint: 'ZERO', or_addresses: ['5.6.7.8:9001'] }
    ])

    expect(service.lookup('A')).not.toBeNull()
    expect(service.lookup('NO_ADDRESS')).toBeNull()
    expect(service.lookup('NO_FIELD')).toBeNull()
    expect(service.lookup('NOT_FOUND')).toBeNull()
    expect(service.lookup('ZERO')).toBeNull()
  })

  it('replaces the previous locations on every resolve', async () => {
    const service = await createService({ GEO_IP_SERVICE_URL: stubUrl })

    await service.resolve([{ fingerprint: 'A', or_addresses: ['89.160.20.112:9001'] }])
    await service.resolve([{ fingerprint: 'B', or_addresses: ['1.2.3.4:443'] }])

    expect(service.lookup('A')).toBeNull()
    expect(service.lookup('B')).toEqual(cellCenter(NEW_YORK))
  })

  it('keeps the previous locations when geo-ip-service fails', async () => {
    const service = await createService({ GEO_IP_SERVICE_URL: stubUrl })
    await service.resolve([{ fingerprint: 'A', or_addresses: ['89.160.20.112:9001'] }])

    respond = (_addresses, res) => {
      res.statusCode = 503
      res.end()
    }
    await service.resolve([{ fingerprint: 'B', or_addresses: ['1.2.3.4:443'] }])

    expect(service.lookup('A')).toEqual(cellCenter(STOCKHOLM))
    expect(service.lookup('B')).toBeNull()
  })

  it('reads the address file on every resolve', async () => {
    const urlFile = join(tempDir, 'geo-ip-service-url')
    const service = await createService({ GEO_IP_SERVICE_URL_FILE: urlFile })
    const relays = [{ fingerprint: 'A', or_addresses: ['89.160.20.112:9001'] }]

    await service.resolve(relays)
    expect(requests).toHaveLength(0)
    expect(service.lookup('A')).toBeNull()

    writeFileSync(urlFile, '\n')
    await service.resolve(relays)
    expect(requests).toHaveLength(0)

    writeFileSync(urlFile, `${stubUrl}\n`)
    await service.resolve(relays)
    expect(requests).toHaveLength(1)
    expect(service.lookup('A')).toEqual(cellCenter(STOCKHOLM))
  })

  it('splits large address sets into batches', async () => {
    const service = await createService({ GEO_IP_SERVICE_URL: stubUrl })
    const relays = Array.from({ length: 10_001 }, (_, i) => ({
      fingerprint: `F${i}`,
      or_addresses: [`10.${Math.floor(i / 65536)}.${Math.floor(i / 256) % 256}.${i % 256}:9001`]
    }))

    await service.resolve(relays)

    expect(requests.map(batch => batch.length)).toEqual([10_000, 1])
  })
})
