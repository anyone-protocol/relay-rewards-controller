import { Logger, Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { TasksModule } from './tasks/tasks.module'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { DistributionModule } from './distribution/distribution.module'
import { BullModule } from '@nestjs/bullmq'
import { ClusterModule } from './cluster/cluster.module'
import { RelayRewardsModule } from './relay-rewards/relay-rewards.module'
import { OperatorRegistryModule } from './operator-registry/operator-registry.module'
import { BundlingModule } from './bundling/bundling.module'
import { ConnectionOptions } from 'bullmq'

@Module({
  imports: [
    TasksModule,
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService<{ MONGO_URI: string }>],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI', { infer: true }),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<{
          REDIS_MODE: string
          REDIS_HOSTNAME: string
          REDIS_PORT: number
          REDIS_MASTER_NAME: string
          REDIS_SENTINEL_1_HOST: string
          REDIS_SENTINEL_1_PORT: number
          REDIS_SENTINEL_2_HOST: string
          REDIS_SENTINEL_2_PORT: number
          REDIS_SENTINEL_3_HOST: string
          REDIS_SENTINEL_3_PORT: number
        }>,
      ) => {
        const logger = new Logger(AppModule.name)
        const redisMode = config.get<string>(
          'REDIS_MODE',
          'standalone',
          { infer: true }
        )

        let connection: ConnectionOptions = {
          host: config.get<string>('REDIS_HOSTNAME', { infer: true }),
          port: config.get<number>('REDIS_PORT', { infer: true }),
        }

        if (redisMode === 'sentinel') {
          const name = config.get<string>('REDIS_MASTER_NAME', { infer: true })
          const sentinels = [
            {
              host: config.get<string>(
                'REDIS_SENTINEL_1_HOST',
                { infer: true }
              ),
              port: config.get<number>('REDIS_SENTINEL_1_PORT', { infer: true })
            },
            {
              host: config.get<string>(
                'REDIS_SENTINEL_2_HOST',
                { infer: true }
              ),
              port: config.get<number>('REDIS_SENTINEL_2_PORT', { infer: true })
            },
            {
              host: config.get<string>(
                'REDIS_SENTINEL_3_HOST',
                { infer: true }
              ),
              port: config.get<number>('REDIS_SENTINEL_3_PORT', { infer: true })
            }
          ]
          connection = { sentinels, name }
        }

        logger.log(`Connecting to Redis with mode ${redisMode}`)
        logger.log(`Connection: ${JSON.stringify(connection)}`)

        return { connection }
      }
    }),
    BundlingModule,
    DistributionModule,
    ClusterModule,
    RelayRewardsModule,
    OperatorRegistryModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
