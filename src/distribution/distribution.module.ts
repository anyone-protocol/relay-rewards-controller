import { HttpModule } from '@nestjs/axios'
import { forwardRef, Logger, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'

import { DistributionService } from './distribution.service'
import { RelayRewardsModule } from '../relay-rewards/relay-rewards.module'
import {
  OperatorRegistryModule
} from '../operator-registry/operator-registry.module'
import { TasksModule } from '../tasks/tasks.module'
import { UptimeTicks, UptimeTicksSchema} from './schemas/uptime-ticks'
import { UptimeStreak, UptimeStreakSchema } from './schemas/uptime-streak'
import { BundlingModule } from '../bundling/bundling.module'
import { GeoIpModule } from '../geo-ip/geo-ip.module'

@Module({
  imports: [
    ConfigModule,
    RelayRewardsModule,
    OperatorRegistryModule,
    HttpModule,
    BundlingModule,
    forwardRef(() => TasksModule),
    GeoIpModule,
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
