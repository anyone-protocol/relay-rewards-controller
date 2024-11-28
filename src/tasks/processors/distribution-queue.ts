import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { DistributionService } from 'src/distribution/distribution.service'
import { TasksService } from '../tasks.service'
import { ScoreData } from 'src/distribution/schemas/score-data'
import AddScoresResult from 'src/distribution/dto/add-scores-result'

@Processor('distribution-queue')
export class DistributionQueue extends WorkerHost {
  private readonly logger = new Logger(DistributionQueue.name)

  public static readonly JOB_START_DISTRIBUTION = 'start-distribution'
  public static readonly JOB_ADD_SCORES = 'add-scores'
  public static readonly JOB_COMPLETE_ROUND = 'complete-round'
  public static readonly JOB_PERSIST_LAST_ROUND = 'persist-last-round'

  constructor(
    private readonly distribution: DistributionService,
    private readonly tasks: TasksService
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<boolean | AddScoresResult | undefined> {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case DistributionQueue.JOB_START_DISTRIBUTION:
        return this.startDistributionHandler(job)

      case DistributionQueue.JOB_ADD_SCORES:
        return this.addScoresHandler(job)

      case DistributionQueue.JOB_COMPLETE_ROUND:
        return this.completeDistributionHandler(job)

      case DistributionQueue.JOB_PERSIST_LAST_ROUND:
        return this.persistDistributionHandler(job)

      default:
        this.logger.warn(`Found unknown job ${job.name} [${job.id}]`)
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<any, any, string>) {
    this.logger.debug(`Finished ${job.name} [${job.id}]`)
  }

  async startDistributionHandler(job: Job<number, boolean, string>): Promise<boolean> {
    return this.distribution.getCurrentScores(job.data).then(
      scores => {
        const filtered = scores.filter(score => score.Network > 0)
        const scoreGroups = this.distribution.groupScoreJobs(filtered)

        this.tasks.distributionFlow.add(
          TasksService.DISTRIBUTION_FLOW({
            stamp: job.data,
            total: scores.length,
            scoreGroups: scoreGroups,
          })
        )

        this.logger.log(
          `Started distribution ${job.data} with ${filtered.length} non-zero scores grouped to ${scoreGroups.length} jobs`
        )
        return true
      },
      error => {
        this.logger.error('Exception while starting distribution', error.message, error.stack)
        return false
      }
    )
  }

  async addScoresHandler(
    job: Job<{ stamp: number; scores: ScoreData[] }, AddScoresResult, string>
  ): Promise<AddScoresResult> {
    try {
      if (job.data != undefined) {
        this.logger.log(`Adding ${job.data.scores.length} scores for ${job.data.stamp}`)

        return this.distribution.addScores(job.data.stamp, job.data.scores).then(
          result => ({
            result: result,
            stamp: job.data.stamp,
            scored: job.data.scores.map(value => value.Fingerprint),
          }),
          error => {
            this.logger.error('Exception while adding scores', error.message, error.stack)
            return { result: false, stamp: 0, scored: [] }
          }
        )
      } else {
        this.logger.error('Undefined job data')
      }
    } catch (e) {
      this.logger.error('Exception while adding scores', e.stack)
    }
    return { result: false, stamp: 0, scored: [] }
  }

  async completeDistributionHandler(job: Job<{ stamp: number; total: number }, boolean, string>): Promise<boolean> {
    return job
      .getChildrenValues()
      .then(jobValues => {
        const jobsData = Object.values(jobValues)
        const { processed, failed } = jobsData.reduce(
          (acc, curr) => {
            if (curr.result) {
              acc.processed.push(...curr.scored)
            } else {
              acc.failed.push(...curr.scored)
            }
            return acc
          },
          { processed: [] as string[], failed: [] as string[] }
        )

        if (processed.length < job.data.total) {
          this.logger.warn(`Processed less scores (${processed.length}) then the total found (${job.data.total})`)
        } else {
          this.logger.log(`Processed ${processed.length} scores`)
        }
      })
      .then(
        () => this.distribution.complete(job.data.stamp),
        error => {
          this.logger.error('Exception while completing distribution', error.message, error.stack)
          return false
        }
      )
  }

  async persistDistributionHandler(job: Job<{ stamp: number }, boolean, string>): Promise<boolean> {
    try {
      this.logger.log(`Persisting distribution summary [${job.data.stamp}]`)
      return this.distribution.persistRound(job.data.stamp)
    } catch (err) {
      this.logger.error(`Exception persisting distribution summary [${job.data.stamp}]`, err.stack)
    }

    return false
  }
}
