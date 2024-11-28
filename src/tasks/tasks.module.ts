import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { TasksQueue } from './processors/tasks-queue'
import { TasksService } from './tasks.service'
import { DistributionQueue } from './processors/distribution-queue'
import { DistributionModule } from 'src/distribution/distribution.module'
import {
  TaskServiceData,
  TaskServiceDataSchema,
} from './schemas/task-service-data'
import { MongooseModule } from '@nestjs/mongoose'
import { ClusterModule } from 'src/cluster/cluster.module'

@Module({
  imports: [
    DistributionModule,
    ClusterModule,
    BullModule.registerQueue({
      name: 'tasks-queue',
      streams: { events: { maxLen: 1000 } },
    }),
    BullModule.registerQueue({
      name: 'distribution-queue',
      streams: { events: { maxLen: 1000 } },
    }),
    BullModule.registerFlowProducer({ name: 'distribution-flow' }),
    MongooseModule.forFeature([
      {
        name: TaskServiceData.name,
        schema: TaskServiceDataSchema,
      },
    ]),
  ],
  providers: [TasksService, TasksQueue, DistributionQueue],
  exports: [TasksService],
})
export class TasksModule {}
