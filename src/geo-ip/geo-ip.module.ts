import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'

import { GeoIpService } from './geo-ip.service'

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [GeoIpService],
  exports: [GeoIpService]
})
export class GeoIpModule {}
