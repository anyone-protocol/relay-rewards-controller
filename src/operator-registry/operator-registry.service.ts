import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AoClient, createAoClient, nodeUrlFromEnv } from '@anyone-protocol/ao-client'

import { OperatorRegistryScoring } from './interfaces/operator-registry'

@Injectable()
export class OperatorRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OperatorRegistryService.name)

  private isLive?: string

  private readonly operatorRegistryProcessId: string
  private readonly hbUrl: string

  private ao!: AoClient

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      OPERATOR_REGISTRY_PROCESS_ID: string
      HB_URL: string
    }>
  ) {
    this.isLive = config.get<string>('IS_LIVE', { infer: true })

    this.logger.log(
      `Initializing operator registry service (IS_LIVE: ${this.isLive})`
    )

    const operatorRegistryPid = this.config.get<string>(
      'OPERATOR_REGISTRY_PROCESS_ID',
      { infer: true }
    )
    if (operatorRegistryPid != undefined) {
      this.operatorRegistryProcessId = operatorRegistryPid
    } else {
      this.logger.error('Missing operator registry process id')
    }

    // Fail closed, no default. Replaces CU_URL. The outage that forced this migration was
    // caused by endpoints nobody had set explicitly.
    this.hbUrl = nodeUrlFromEnv({
      HB_URL: config.get<string>('HB_URL', { infer: true })
    })
  }

  onApplicationBootstrap() {
    // Reads only — this service never writes to the operator registry, so no signer.
    this.ao = createAoClient({
      url: this.hbUrl,
      logger: {
        debug: (m, ...meta) => this.logger.debug(m, ...meta),
        warn: (m, ...meta) => this.logger.warn(m, ...meta),
        error: (m, ...meta) => this.logger.error(m, ...meta)
      }
    })
    this.logger.log(`Reading operator registry from node ${this.hbUrl}`)
  }

  /**
   * The verified/hardware slice used to score a round.
   *
   * This was a `View-State` dryrun that pulled all five registry maps to use two. The native
   * contract exposes `scoring` for precisely this, so we ask for the slice instead.
   */
  public async getOperatorRegistryScoring(): Promise<OperatorRegistryScoring> {
    const scoring = await this.ao.readView<OperatorRegistryScoring>(
      this.operatorRegistryProcessId,
      'scoring'
    )

    // NB: Lua returns empty tables as JSON arrays, so we normalize them to empty objects as
    //     when they are populated they will also be objects. Still true of the native
    //     contract: an empty registry serves {"verified":[],"hardware":[]}.
    for (const prop in scoring) {
      if (Array.isArray(scoring[prop]) && scoring[prop].length < 1) {
        scoring[prop] = {} as any
      }
    }

    return scoring
  }
}
