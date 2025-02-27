import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { AppThreadsService } from './cluster/app-threads.service'
import { WinstonModule } from 'nest-winston';
import winston, { createLogger } from 'winston';

export const logz = createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ level, message, context, timestamp, stack }) => {
          const _stack = Array.isArray(stack) && stack[0] ? '\n'+stack.join('\n') : '';
          return `${timestamp}|${level}|${context}: ${message}${_stack}`;
        }),
      ),
      handleExceptions: true
    }),
  ],
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      instance: logz,
    }),
  })

  const port = process.env.PORT || 3000
  logz.info(`Listening on ${port}`)
  
  await app.listen(port)
}
AppThreadsService.parallelize(bootstrap)
