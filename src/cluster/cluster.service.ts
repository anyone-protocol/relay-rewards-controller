import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Consul from 'consul'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class ClusterService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ClusterService.name)

  // true - should receive and act on one-time only events
  // false - should receive external events, and be ready to become a leader
  // undefined - wait for leader resolution to finish
  public isLeader?: boolean

  private isLive?: string
  private serviceId: string
  private serviceName: string
  private sessionId: string | null = null
  private consul?: Consul
  private renewInterval?: NodeJS.Timeout

  constructor(
    private readonly config: ConfigService<{
      CONSUL_HOST: string
      CONSUL_PORT: number
      CONSUL_TOKEN_CONTROLLER_CLUSTER: string
      SERVICE_NAME: string
      IS_LIVE: string
    }>
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    const host = this.config.get<string>('CONSUL_HOST', { infer: true })
    const port = this.config.get<number>('CONSUL_PORT', { infer: true })

    if (this.isLive !== 'true') {
      this.logger.warn(
        'Not live, skipping consul based cluster data. ' +
          'Bootstrapping in single node mode...'
      )
      this.isLeader = true
      return
    }

    if (!host || !port) {
      this.logger.warn(
        'Host/port of Consul not set, bootstrapping in single node mode...'
      )
      this.isLeader = true
      return
    }

    const serviceName = this.config.get<string>(
      'CONSUL_SERVICE_NAME',
      { infer: true }
    )
    if (!serviceName) {
      this.logger.error(
        'Missing CONSUL_SERVICE_NAME. Cannot initialize Consul service!'
      )
      throw new Error(
        'CONSUL_SERVICE_NAME is required for Consul service initialization'
      )
    }
    this.serviceName = serviceName
    this.serviceId = `${this.serviceName}-${uuidv4()}`
    const consulToken = this.config.get<string>(
      'CONSUL_TOKEN_CONTROLLER_CLUSTER',
      { infer: true }
    )

    try {
      this.logger.log(
        `Connecting to Consul at ${host}:${port} ` +
          `with service: ${this.serviceName}`
      )
      this.consul = new Consul({ host, port, defaults: { token: consulToken } })
    } catch (error) {
      this.logger.error(
        `Failed to connect to Consul: ${error.message}`,
        error
      )
      throw error
    }
  }

  public isLocalLeader(): boolean {
    let isLL = process.env['IS_LOCAL_LEADER']
    return isLL != undefined && isLL === 'true'
  }

  public isTheOne(): boolean {
    const isLL = this.isLocalLeader()
    this.logger.log(
      `is the one? isLeader: ${this.isLeader} ` +
        `isLocalLeader: ${isLL} - ${process.pid}`
    )
    return !!this.isLeader && isLL
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.consul) { return }
    if (!this.isLocalLeader()) {
      this.logger.log('Not a local leader, skipping leader election setup.')
      return
    }

    try {
      this.sessionId = await this.createSession()
      await this.startLeaderElection()
    } catch (error) {
      this.logger.error(
        `Failed to initialize clustering discovery: ${error.message}`,
        error.stack
      )
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.logger.log('Shutting down cluster...')
    if (this.renewInterval) {
      clearInterval(this.renewInterval);
      this.renewInterval = undefined;
    }
    if (this.consul && this.isLocalLeader() && this.sessionId) {
      this.logger.log('Cleaning up leader locks...')
      await this.consul.session.destroy(this.sessionId)
    }
  }

  private async createSession(): Promise<string> {
    if (!this.consul) {
      throw new Error('Consul client is not initialized')
    }

    const { ID } = await this.consul.session.create({
      name: this.serviceId,
      ttl: '15s',
      behavior: 'delete',
    })

    this.renewInterval = setInterval(async () =>{
      if (this.consul) {
        try {
          await this.consul.session.renew(ID)
        } catch (error) {
          this.logger.error('Failed to renew consul session', error)
        }
      }
    }, 10000)

    return ID
  }

  private async startLeaderElection(): Promise<void> {
    const leaderKey = `clusters/${this.serviceName}/leader`

    const acquireLock = async () => {
      if (!this.sessionId || !this.consul) return

      try {
        const result = await this.consul.kv.set({
          key: leaderKey,
          value: this.serviceId,
          acquire: this.sessionId
        })

        this.isLeader = result
        this.logger.log(
          `Instance ${this.serviceId} is ` +
            `${this.isLeader ? 'now leader' : 'not leader'}`
        )
      } catch (error) {
        this.logger.error('Error during leader election:', error)
      }
    }

    await acquireLock()

    if (this.consul) {
      this.consul
        .watch({
          method: this.consul.kv.get,
          options: { key: leaderKey },
          backoffFactor: 1000,
        })
        .on('change', async (data: any) => {
          if (!data) {
            await acquireLock()
          }
        })
      }
  }
}
