import { Logger, Module } from '@nestjs/common'
import { RelayRewardsService } from './relay-rewards.service'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'

import { EvmProviderModule } from '../evm-provider/evm-provider.module'

@Module({
  imports: [ConfigModule, HttpModule, EvmProviderModule],
  providers: [RelayRewardsService, Logger],
  exports: [RelayRewardsService],
})
export class RelayRewardsModule {}
