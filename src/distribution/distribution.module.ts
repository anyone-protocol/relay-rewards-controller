import { Module } from '@nestjs/common'
import { DistributionService } from './distribution.service'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [ConfigModule],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
