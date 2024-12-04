import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { AppThreadsService } from './cluster/app-threads.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'], // 'verbose'],
  })
  const port = process.env.PORT || 3000
  console.log(`Listening on ${port}`)
  await app.listen(port)
}
AppThreadsService.parallelize(bootstrap)
