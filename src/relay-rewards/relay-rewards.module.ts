import { Module } from '@nestjs/common';
import { RelayRewardsService } from './relay-rewards.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [RelayRewardsService],
  exports: [RelayRewardsService]
})
export class RelayRewardsModule {}
