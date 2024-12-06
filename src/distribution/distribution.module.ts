import { forwardRef, Logger, Module } from '@nestjs/common'
import { DistributionService } from './distribution.service'
import { ConfigModule } from '@nestjs/config'
import { RelayRewardsModule } from 'src/relay-rewards/relay-rewards.module'
import { OperatorRegistryModule } from 'src/operator-registry/operator-registry.module'
import { HttpModule } from '@nestjs/axios'
import { TasksModule } from 'src/tasks/tasks.module'
import { MongooseModule } from '@nestjs/mongoose'
import { UptimeTicks as UptimeTicks, UptimeTicksSchema as UptimeTicksSchema } from './schemas/uptime-ticks'
import { UptimeStreak, UptimeStreakSchema } from './schemas/uptime-streak'

@Module({
  imports: [ConfigModule, RelayRewardsModule, OperatorRegistryModule, HttpModule, forwardRef(() => TasksModule),
    
    MongooseModule.forFeature([
      {
        name: UptimeTicks.name,
        schema: UptimeTicksSchema,
      },
    ]),
    MongooseModule.forFeature([
      {
        name: UptimeStreak.name,
        schema: UptimeStreakSchema,
      },
    ]),
  ],
  providers: [DistributionService, Logger],
  exports: [DistributionService],
})
export class DistributionModule {}
