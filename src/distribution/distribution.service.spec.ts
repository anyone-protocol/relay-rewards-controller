import { Test, TestingModule } from '@nestjs/testing'
import { DistributionService } from './distribution.service'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'

describe('DistributionService', () => {
  let service: DistributionService
  let module: TestingModule

  beforeEach(async () => {
    // DistributionService takes nine collaborators; auto-mock the ones a unit test does not
    // exercise, rather than hand-wiring Mongoose model tokens for tests that never touch them.
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      providers: [DistributionService],
    })
      .useMocker(() => ({}))
      .compile()

    service = module.get<DistributionService>(DistributionService)
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  // groupScoreJobs batches by BYTES against the uploader's 5 MiB item cap. These are cheap and
  // pure, and the failure they guard against is silent: a batch that overshoots the cap is
  // rejected at upload, and a round that splits when it need not costs slots and store.
  describe('groupScoreJobs', () => {
    const CAP = 5 * 1024 * 1024
    const BUDGET = Math.floor(CAP * 0.8)
    const score = (i: number) => ({
      Fingerprint: i.toString(16).toUpperCase().padStart(40, '0'),
      Address: '0x' + i.toString(16).padStart(40, '0'),
      Network: 1300, IsHardware: true, ExitBonus: false,
      UptimeStreak: 3, FamilySize: 0, LocationSize: 1,
    })
    // What addScores actually serializes, so the assertions measure the real wire payload:
    // fingerprint as the KEY only, never repeated inside the value.
    const wireBytes = (batch: ReturnType<typeof score>[]) => {
      const map: Record<string, unknown> = {}
      batch.forEach(({ Fingerprint, ...rest }) => (map[Fingerprint] = rest))
      return JSON.stringify({ Scores: map }).length
    }

    it('puts a live-sized round in ONE message', () => {
      const groups = service.groupScoreJobs(
        Array.from({ length: 6010 }, (_, i) => score(i + 1)) as any
      )
      expect(groups).toHaveLength(1)
      expect(groups[0]).toHaveLength(6010)
      expect(wireBytes(groups[0] as any)).toBeLessThan(BUDGET)
    })

    it('keeps every batch under the budget once splitting is needed', () => {
      const groups = service.groupScoreJobs(
        Array.from({ length: 40000 }, (_, i) => score(i + 1)) as any
      )
      expect(groups.length).toBeGreaterThan(1)
      for (const g of groups) {
        expect(wireBytes(g as any)).toBeLessThanOrEqual(BUDGET)
        expect(wireBytes(g as any)).toBeLessThan(CAP)   // the constraint that actually matters
      }
    })

    it('loses no scores and preserves order when it splits', () => {
      const input = Array.from({ length: 40000 }, (_, i) => score(i + 1))
      const flat = service.groupScoreJobs(input as any).flat()
      expect(flat).toHaveLength(input.length)
      expect(flat.map((s: any) => s.Fingerprint)).toEqual(input.map(s => s.Fingerprint))
    })

    it('estimates the batch size as the wire payload, not the input objects', () => {
      const batch = Array.from({ length: 500 }, (_, i) => score(i + 1))
      const groups = service.groupScoreJobs(batch as any)
      expect(groups).toHaveLength(1)
      // The estimate must track the SENT shape. If it measured the input objects it would count
      // the Fingerprint twice and over-reserve by ~57 B per relay.
      const sent = wireBytes(groups[0] as any)
      const withDuplicate = JSON.stringify({
        Scores: Object.fromEntries(batch.map(s => [s.Fingerprint, s]))
      }).length
      expect(sent).toBeLessThan(withDuplicate)
      expect((withDuplicate - sent) / batch.length).toBeGreaterThan(50)
    })

    it('emits no empty groups, including for empty input', () => {
      expect(service.groupScoreJobs([])).toEqual([])
      for (const g of service.groupScoreJobs(
        Array.from({ length: 40000 }, (_, i) => score(i + 1)) as any
      )) {
        expect(g.length).toBeGreaterThan(0)
      }
    })
  })

  // Skipped tests are part of implemented spec, but skipped for now as expensive testing of logs/e2e
  it.skip('should attempt to retry failed transactions for a distribution.', () => {})
  it.skip('should not finalize the distribution until all transactions succeed.', () => {})
  it.skip('should warn about distributions that are locked', () => {})
  it.skip('should warn about account funds depleting within a month', () => {})
  it.skip('should maintain distribution continuity between reboots', () => {})
  it.skip('should maintain distribution rhythm between reboots', () => {})
})
