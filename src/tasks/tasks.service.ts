import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectQueue, InjectFlowProducer } from '@nestjs/bullmq'
import { Queue, FlowProducer, FlowJob } from 'bullmq'
import { ScoreData } from '../distribution/schemas/score-data'
import { ConfigService } from '@nestjs/config'
import { TaskServiceData } from './schemas/task-service-data'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { ClusterService } from '../cluster/cluster.service'

@Injectable()
export class TasksService implements OnApplicationBootstrap {
    private readonly logger = new Logger(TasksService.name)

    private doClean?: string

    static readonly removeOnComplete = true
    static readonly removeOnFail = 8
    
    private readonly minRoundLength = 1000 * 60 * 60 * 4
    private lastRunAt = 0

    public static jobOpts = {
        removeOnComplete: TasksService.removeOnComplete,
        removeOnFail: TasksService.removeOnFail,
    }

    public static DISTRIBUTION_FLOW({
        stamp, total, scoreGroups
    }: {
        stamp: number,
        total: number,
        scoreGroups: ScoreData[][]
    }): FlowJob {
        return {
            name: 'persist-last-round',
            queueName: 'distribution-queue',
            opts: TasksService.jobOpts,
            data: { stamp },
            children: [{
                name: 'complete-round',
                queueName: 'distribution-queue',
                opts: TasksService.jobOpts,
                data: { stamp, total },
                children: scoreGroups.map((scores, index, array) => ({
                    name: 'add-scores',
                    queueName: 'distribution-queue',
                    opts: TasksService.jobOpts,
                    data: { stamp, scores }
                }))
            }]
        }
    }

    constructor(
        private readonly config: ConfigService<{
            IS_LIVE: string
            DO_CLEAN: string
            MIN_ROUND_LENGTH: number
        }>,
        private readonly cluster: ClusterService,
        @InjectQueue('tasks-queue')
        public tasksQueue: Queue,
        @InjectQueue('distribution-queue')
        public distributionQueue: Queue,
        @InjectFlowProducer('distribution-flow')
        public distributionFlow: FlowProducer
    ) {
        this.doClean = this.config.get<string>('DO_CLEAN', { infer: true })
        const minRound: number = this.config.get<number>('MIN_ROUND_LENGTH', { infer: true })
        if (minRound > 0) this.minRoundLength = minRound
    }

    async onApplicationBootstrap(): Promise<void> {
        if (this.cluster.isTheOne()) {
            if (this.doClean == 'true') {
                this.logger.log('Cleaning up jobs...')
                await this.tasksQueue.obliterate({ force: true })
                await this.distributionQueue.obliterate({ force: true })
            }
            this.queueDistribution()
            this.logger.log(`Bootstrapped Tasks Service`)
        } else {
            this.logger.debug('Not the one, skipping bootstrap of tasks service')
        }
    }

    public async queueDistribution(): Promise<void> {
        const now = Date.now()
        if (now - this.lastRunAt >= this.minRoundLength) {
            this.distributionQueue.add(
                'start-distribution',
                now,
                TasksService.jobOpts,
            )
        } else {
            const timeOffset = this.minRoundLength - (now - this.lastRunAt)
            await this.tasksQueue.add(
                'distribute',
                {},
                {
                    delay: timeOffset,
                    removeOnComplete: TasksService.removeOnComplete,
                    removeOnFail: TasksService.removeOnFail,
                },
            )
        }

        
    }
}
