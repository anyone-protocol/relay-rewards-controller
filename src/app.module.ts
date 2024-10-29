import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { TasksModule } from './tasks/tasks.module'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { DistributionModule } from './distribution/distribution.module'
import { BullModule } from '@nestjs/bullmq'
import { ClusterModule } from './cluster/cluster.module'

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
                    REDIS_HOSTNAME: string
                    REDIS_PORT: number
                }>,
            ) => ({
                connection: {
                    host: config.get<string>('REDIS_HOSTNAME', { infer: true }),
                    port: config.get<number>('REDIS_PORT', { infer: true }),
                },
            }),
        }),
        DistributionModule,
        ClusterModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
