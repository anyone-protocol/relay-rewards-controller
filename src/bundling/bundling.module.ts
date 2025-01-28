import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { BundlingService } from './bundling.service'

@Module({
  imports: [ConfigModule],
  providers: [BundlingService],
  exports: [BundlingService]
})
export class BundlingModule {}
