jest.mock('src/relay-rewards/relay-rewards.service', () => ({ RelayRewardsService: class {} }), { virtual: true })
jest.mock('src/operator-registry/operator-registry.service', () => ({ OperatorRegistryService: class {} }), { virtual: true })
jest.mock('src/tasks/tasks.service', () => ({ TasksService: class {} }), { virtual: true })
jest.mock('../bundling/bundling.service', () => ({ BundlingService: class {} }))
jest.mock('../geo-ip/geo-ip.service', () => ({ GeoIpService: class {} }))

import { Logger } from '@nestjs/common'
import { of, throwError } from 'rxjs'
import { DistributionService } from './distribution.service'

function build(response: () => any) {
  const settings = { IS_LIVE: 'true', ONIONOO_DETAILS_URI: 'http://onionoo.test/details', USE_HODLER: 'true' }
  const config = { get: (key: string) => settings[key] }
  const relayRewards = { getHodlerData: jest.fn() }
  const operatorRegistry = { getOperatorRegistryScoring: jest.fn() }
  const http = { get: jest.fn(response) }
  const uptimeTicks = { bulkWrite: jest.fn(), deleteMany: jest.fn(), aggregate: jest.fn() }
  const uptimeStreaks = { find: jest.fn(), bulkWrite: jest.fn(), deleteMany: jest.fn() }
  const service = new DistributionService(
    config as any,
    relayRewards as any,
    operatorRegistry as any,
    http as any,
    {} as any,
    uptimeTicks as any,
    uptimeStreaks as any,
    {} as any,
    {} as any
  )
  return { service, relayRewards, uptimeTicks }
}

describe('DistributionService onionoo guard', () => {
  let errors: jest.SpyInstance

  beforeEach(() => {
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  const alarmed = (name: string) =>
    errors.mock.calls.some(([message]) => String(message).includes(`[alarm=${name}]`))

  it('skips the round before scoring or tracking uptime when the onionoo request fails', async () => {
    const { service, relayRewards, uptimeTicks } = build(() =>
      throwError(() => Object.assign(new Error('Request failed with status code 502'), { response: { status: 502 } }))
    )

    await expect(service.getCurrentScores(1)).rejects.toThrow('Onionoo fetch failed')
    expect(alarmed('onionoo-fetch-failed')).toBe(true)
    expect(relayRewards.getHodlerData).not.toHaveBeenCalled()
    expect(uptimeTicks.bulkWrite).not.toHaveBeenCalled()
  })

  it('treats an empty relay list as a failed fetch', async () => {
    const { service } = build(() => of({ status: 200, data: { relays: [] }, headers: {} }))

    await expect(service.getCurrentScores(1)).rejects.toThrow('Onionoo fetch failed')
    expect(alarmed('onionoo-fetch-failed')).toBe(true)
  })

  it('returns the relay list when onionoo answers with relays', async () => {
    const relays = [{ fingerprint: 'A'.repeat(40), running: true, consensus_weight: 100 }]
    const { service } = build(() => of({ status: 200, data: { relays }, headers: {} }))

    await expect((service as any).fetchRelays()).resolves.toEqual(relays)
    expect(errors).not.toHaveBeenCalled()
  })
})
