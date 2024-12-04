import { Logger, Module } from '@nestjs/common'
import { ClusterService } from './cluster.service'
import { AppThreadsService } from './app-threads.service'

@Module({
  imports: [],
  providers: [ClusterService, AppThreadsService, Logger],
  exports: [ClusterService],
})
export class ClusterModule {}
