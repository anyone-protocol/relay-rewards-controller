/**
 * INTEGRATION test — talks to a real HyperBEAM node holding a real relay-rewards process.
 * No mocks: the point is to prove ans104 signing, the ACL, and the settle-slot read path
 * actually work end to end.
 *
 * Requires:
 *   HB_URL                          e.g. http://localhost:8734
 *   RELAY_REWARDS_PROCESS_ID        a process spawned from a relay-rewards module
 *   RELAY_REWARDS_CONTROLLER_KEY    an EVM key holding owner/admin on that process
 *   IS_LIVE=true                    the write paths no-op otherwise, by design
 *
 * To stand one up locally see smart-contracts/ao/scripts/run-e2e.ts, which publishes the
 * pure-source module into a node container and spawns it with the migration seed.
 */
import { Logger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { EvmProviderModule } from '../evm-provider/evm-provider.module'
import { RelayRewardsService } from './relay-rewards.service'

const HAVE_NODE = !!process.env.RELAY_REWARDS_PROCESS_ID && !!process.env.HB_URL
const itNode = HAVE_NODE ? it : it.skip

describe('RelayRewardsService', () => {
  let module: TestingModule
  let service: RelayRewardsService

  beforeEach(async () => {
    // EvmProviderModule is real rather than mocked: RelayRewardsService resolves its Hodler
    // contract from it during onApplicationBootstrap, so a stub would skip the wiring this
    // test exists to exercise. With USE_HODLER unset it probes nothing and stays quiet.
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), EvmProviderModule],
      providers: [RelayRewardsService]
    })
      .setLogger(new Logger())
      .compile()
    service = module.get<RelayRewardsService>(RelayRewardsService)
    await service.onApplicationBootstrap()
  })

  afterEach(async () => {
    await module.close()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  itNode(
    'settles a round and reads the full snapshot back from the settle slot',
    async () => {
      // A round must be newer than the seeded PreviousRound, so derive the stamp from the
      // contract rather than the wall clock.
      const status: any = await (service as any).ao.readView(
        process.env.RELAY_REWARDS_PROCESS_ID,
        'status'
      )
      const stamp = Number(status.lastRoundTimestamp) + 3_600_000

      const fingerprint = 'A'.repeat(40)
      const address = '0x' + '1'.repeat(40)
      const added = await service.addScores(stamp, {
        [fingerprint]: {
          Fingerprint: fingerprint,
          Address: address,
          Network: 10_000,
          IsHardware: false,
          UptimeStreak: 14,
          ExitBonus: false,
          FamilySize: 0,
          LocationSize: 0
        }
      } as any)
      expect(added).toBe(true)

      const slot = await service.completeRound(stamp)
      // completeRound now yields the SLOT, not a boolean — the snapshot lives in its output.
      expect(slot).toBeDefined()

      const snapshot = await service.getLastSnapshot(slot!)
      expect(snapshot).toBeDefined()
      expect(snapshot!.Timestamp).toBe(stamp)
      expect(snapshot!.Period).toBeGreaterThan(0)
      expect(snapshot!.Configuration).toBeDefined()
      expect(snapshot!.Summary?.Rewards?.Total).toBeDefined()

      // Details are the whole reason this reads the slot rather than state — the contract
      // never persists them. Losing them silently would still produce a "valid" snapshot.
      expect(snapshot!.Details).toBeDefined()
      expect(snapshot!.Details[fingerprint]).toBeDefined()
    },
    180_000
  )

  itNode('reports a round it did not settle rather than guessing', async () => {
    // A stamp at/behind the previous round cannot settle; completeRound must yield undefined
    // so persistRound skips instead of archiving someone else's round.
    const status: any = await (service as any).ao.readView(
      process.env.RELAY_REWARDS_PROCESS_ID,
      'status'
    )
    const stale = Number(status.lastRoundTimestamp)

    const slot = await service.completeRound(stale)
    expect(slot).toBeUndefined()
  }, 120_000)
})
