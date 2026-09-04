import { Logger, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { EvmProviderService } from './evm-provider.service'

@Module({
  imports: [ConfigModule],
  providers: [EvmProviderService, Logger],
  exports: [EvmProviderService]
})
export class EvmProviderModule {}
