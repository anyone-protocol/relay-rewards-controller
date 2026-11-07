jest.mock('src/distribution/distribution.service', () => ({ DistributionService: class {} }), { virtual: true })
jest.mock('../tasks.service', () => ({ TasksService: class { static DISTRIBUTION_FLOW = (flow: any) => flow } }))

import { Logger } from '@nestjs/common'
import { DistributionQueue } from './distribution-queue'

const score = (fingerprint: string, network: number) => ({ Fingerprint: fingerprint, Network: network })

describe('DistributionQueue round guards', () => {
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

  function build(scores: any[] | Error) {
    const distribution = {
      getCurrentScores: jest.fn(async () => {
        if (scores instanceof Error) throw scores
        return scores
      }),
      groupScoreJobs: jest.fn((filtered: any[]) => [filtered]),
      complete: jest.fn(async () => 'settle-slot'),
    }
    const tasks = { distributionFlow: { add: jest.fn(async () => undefined) } }
    return { queue: new DistributionQueue(distribution as any, tasks as any), distribution, tasks }
  }

  it('fails the start job when the round cannot be scored', async () => {
    const { queue, tasks } = build(new Error('Onionoo fetch failed: down'))

    await expect(queue.startDistributionHandler({ data: 1 } as any)).rejects.toThrow('Onionoo fetch failed')
    expect(tasks.distributionFlow.add).not.toHaveBeenCalled()
  })

  it('skips a round with no network score and raises an alarm', async () => {
    const { queue, tasks } = build([score('A'.repeat(40), 0)])

    await expect(queue.startDistributionHandler({ data: 1 } as any)).rejects.toThrow('Zero-score round')
    expect(alarmed('zero-score-round')).toBe(true)
    expect(tasks.distributionFlow.add).not.toHaveBeenCalled()
  })

  it('starts the round with the scores it will submit', async () => {
    const { queue, tasks } = build([score('A'.repeat(40), 10), score('B'.repeat(40), 0)])

    await expect(queue.startDistributionHandler({ data: 1 } as any)).resolves.toBe(true)
    expect(tasks.distributionFlow.add).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }))
    expect(errors).not.toHaveBeenCalled()
  })

  it('raises an alarm and does not complete the round when no score is accepted', async () => {
    const { queue, distribution } = build([])
    const job = {
      data: { stamp: 1, total: 2 },
      getChildrenValues: async () => ({ batch: { result: false, scored: ['A'.repeat(40), 'B'.repeat(40)] } }),
    }

    await expect(queue.completeDistributionHandler(job as any)).resolves.toBeUndefined()
    expect(alarmed('scores-not-accepted')).toBe(true)
    expect(distribution.complete).not.toHaveBeenCalled()
  })
})
