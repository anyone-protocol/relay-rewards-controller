import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Consul from 'consul'
import { Append, AppendResult, Config, State, Vote, VoteResult } from './interfaces/raft-types'
import { AppThreadsService } from './app-threads.service'

import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class ClusterService implements OnApplicationBootstrap, BeforeApplicationShutdown {
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

  constructor(
    private readonly config: ConfigService<{
      CONSUL_HOST: string
      CONSUL_PORT: number
      CONSUL_TOKEN: string
      SERVICE_NAME: string
      IS_LIVE: string
    }>
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    const host = this.config.get<string>('CONSUL_HOST', { infer: true })
    const port = this.config.get<number>('CONSUL_PORT', { infer: true })

    if (this.isLive === 'true') {
      if (host != undefined && port != undefined) {
        this.serviceName = this.config.get<string>('SERVICE_NAME', { infer: true })
        this.serviceId = `${this.serviceName}-${uuidv4()}`
        const consulToken = this.config.get<string>('CONSUL_TOKEN', { infer: true })

        this.logger.log(`Connecting to Consul at ${host}:${port} with service: ${this.serviceName}`)
        this.consul = new Consul({ host, port, defaults: { token: consulToken } })
        
      } else {
        this.logger.warn('Host/port of Consul not set, bootstrapping in single node mode...')
        this.isLeader = true
      }
    } else {
      this.logger.warn('Not live, skipping consul based cluster data. Bootstrapping in single node mode...')
      this.isLeader = true
    }
  }

  public isLocalLeader(): boolean {
    let isLL = process.env['IS_LOCAL_LEADER']
    return isLL != undefined && isLL == 'true'
  }

  public isTheOne(): boolean {
    const isLL = this.isLocalLeader()
    this.logger.debug(`is the one? isLeader: ${this.isLeader} isLocalLeader: ${isLL} - ${process.pid}`)
    return this.isLeader != undefined && this.isLeader == true && isLL
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.consul && this.isLocalLeader()) {
      try {
        this.sessionId = await this.createSession()
        this.startLeaderElection()
      } catch (error) {
        this.logger.error(`Failed to initialize clustering discovery: ${error.message}`, error.stack)
      }
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.consul && this.isLocalLeader() && this.sessionId) {
      this.logger.log(`Releasing cluster session`)
      await this.consul.session.destroy(this.sessionId)
    }
  }

  private async createSession(): Promise<string> {
    const { ID } = await this.consul.session.create({
      name: this.serviceId,
      ttl: '15s',
    })

    setInterval(() => {
      this.consul.session.renew(ID)
    }, 10000)

    return ID
  }

  private async startLeaderElection(): Promise<void> {
    const leaderKey = `clusters/${this.serviceName}/leader`

    const acquireLock = async () => {
      if (!this.sessionId) return

      try {
        const result = await this.consul.kv.set({
          key: leaderKey,
          value: this.serviceId,
          acquire: this.sessionId,
        })

        this.isLeader = result
        this.logger.log(`Instance ${this.serviceId} is ${this.isLeader ? 'now leader' : 'not leader'}`)
      } catch (error) {
        this.logger.error('Error during leader election:', error)
      }
    }

    await acquireLock()

    this.consul
      .watch({
        method: this.consul.kv.get,
        options: { key: leaderKey },
        backoffFactor: 1000,
      })
      .on('change', async data => {
        if (!data) {
          await acquireLock()
        }
      })
  }
}
