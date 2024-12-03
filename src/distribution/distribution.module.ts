import { Module } from '@nestjs/common'
import { DistributionService } from './distribution.service'
import { ConfigModule } from '@nestjs/config'
import { RelayRewardsModule } from 'src/relay-rewards/relay-rewards.module'
import { OperatorRegistryModule } from 'src/operator-registry/operator-registry.module'
import { HttpModule } from '@nestjs/axios'

@Module({
  imports: [ConfigModule, RelayRewardsModule, OperatorRegistryModule, HttpModule],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
