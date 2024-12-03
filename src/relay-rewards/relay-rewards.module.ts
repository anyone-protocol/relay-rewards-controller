import { Module } from '@nestjs/common';
import { RelayRewardsService } from './relay-rewards.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [RelayRewardsService],
  exports: [RelayRewardsService]
})
export class RelayRewardsModule {}
