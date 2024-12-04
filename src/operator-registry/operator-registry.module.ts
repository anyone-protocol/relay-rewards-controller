import { Logger, Module } from '@nestjs/common'
import { OperatorRegistryService } from './operator-registry.service'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [OperatorRegistryService, Logger],
  exports: [OperatorRegistryService],
})
export class OperatorRegistryModule {}
