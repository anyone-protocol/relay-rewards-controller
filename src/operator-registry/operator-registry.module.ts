import { Module } from '@nestjs/common'
import { OperatorRegistryService } from './operator-registry.service'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [OperatorRegistryService],
  exports: [OperatorRegistryService],
})
export class OperatorRegistryModule {}
