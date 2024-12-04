import { forwardRef, Logger, Module } from '@nestjs/common'
import { DistributionService } from './distribution.service'
import { ConfigModule } from '@nestjs/config'
import { RelayRewardsModule } from 'src/relay-rewards/relay-rewards.module'
import { OperatorRegistryModule } from 'src/operator-registry/operator-registry.module'
import { HttpModule } from '@nestjs/axios'
import { TasksModule } from 'src/tasks/tasks.module'

@Module({
  imports: [ConfigModule, RelayRewardsModule, OperatorRegistryModule, HttpModule, forwardRef(() => TasksModule)],
  providers: [DistributionService, Logger],
  exports: [DistributionService],
})
export class DistributionModule {}
