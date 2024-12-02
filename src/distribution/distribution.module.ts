import { Module } from '@nestjs/common'
import { DistributionService } from './distribution.service'
import { ConfigModule } from '@nestjs/config'
import { RelayRewardsModule } from 'src/relay-rewards/relay-rewards.module'

@Module({
  imports: [ConfigModule, RelayRewardsModule],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
