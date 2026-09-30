import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

/** Host only, for log lines — never the key in the path. */
const hostOf = (url: string) => {
  try { return new URL(url).host } catch { return 'unparseable url' }
}

const DefaultEvmProviderServiceConfig = {
  JSON_RPC: '',
  JSON_RPC_BACKUP: ''
}

/**
 * The JSON-RPC endpoint, checked at bootstrap, with an OPTIONAL second one.
 *
 * This exists because a single endpoint fails at USE time, not boot. A stale Infura key here
 * started the controller cleanly and then threw `401 invalid project id` out of the distribution
 * job, which reads like a distribution bug — and the same key had already been silently failing
 * for ~26 days, which is why stage completed no rounds between 2026-06-13 and the migration.
 * Probing at startup turns both of those into one obvious line.
 *
 * `JSON_RPC_BACKUP` is optional on purpose: spare provider keys are not always available, and a
 * missing backup must not stop the service. With one endpoint this is a health check that warns;
 * with two it also fails over. Which vendor is which is a jobspec decision, so nothing here
 * names them — the log prints the host instead.
 *
 * It deliberately does NOT throw when the endpoint is unreachable. Reads will still fail the way
 * they do today, but the reason is stated once at boot rather than inferred from a stack trace,
 * and a provider blip cannot crash-loop the controller.
 */
@Injectable()
export class EvmProviderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EvmProviderService.name)

  public readonly config: typeof DefaultEvmProviderServiceConfig =
    DefaultEvmProviderServiceConfig

  private currentJsonRpcProvider?: ethers.JsonRpcProvider
  private backupJsonRpcProvider?: ethers.JsonRpcProvider

  constructor(config: ConfigService<typeof DefaultEvmProviderServiceConfig>) {
    this.config.JSON_RPC = config.get<string>('JSON_RPC', { infer: true })
    this.config.JSON_RPC_BACKUP =
      config.get<string>('JSON_RPC_BACKUP', { infer: true }) || ''
  }

  async onApplicationBootstrap() {
    if (!this.config.JSON_RPC) {
      // Not fatal here: whether an RPC endpoint is required at all depends on USE_HODLER, and
      // that decision belongs to the service that needs it.
      this.logger.warn('JSON_RPC is not set — no EVM provider will be available')

      return
    }

    const primary = new ethers.JsonRpcProvider(this.config.JSON_RPC)
    const primaryName = `primary (${hostOf(this.config.JSON_RPC)})`
    const primaryOk = await this.checkProvider(primaryName, primary)

    if (!this.config.JSON_RPC_BACKUP) {
      this.currentJsonRpcProvider = primary
      this.logger.warn(
        `No JSON_RPC_BACKUP configured — running on ${primaryName} with NO failover` +
          `${primaryOk ? '' : ', and it is NOT reachable right now'}`
      )

      return
    }

    const secondary = new ethers.JsonRpcProvider(this.config.JSON_RPC_BACKUP)
    const secondaryName = `secondary (${hostOf(this.config.JSON_RPC_BACKUP)})`
    const secondaryOk = await this.checkProvider(secondaryName, secondary)

    // Prefer the primary, but do not insist on it — a dead primary with a healthy secondary is
    // a degraded service, not a stopped one.
    if (primaryOk || !secondaryOk) {
      this.currentJsonRpcProvider = primary
      this.backupJsonRpcProvider = secondaryOk ? secondary : undefined
      if (primaryOk) {
        this.logger.log(`Using ${primaryName}, ${secondaryName} standing by`)
      } else {
        this.logger.error(
          `NEITHER JSON-RPC provider is reachable (${primaryName}, ${secondaryName}). ` +
            `Continuing on ${primaryName}; EVM reads will fail until one recovers.`
        )
      }
    } else {
      this.currentJsonRpcProvider = secondary
      this.logger.warn(
        `${primaryName} is unavailable — running on ${secondaryName} with NO failover`
      )
    }
  }

  /** Reachability, not credits: an auth failure and an outage both surface as a throw here. */
  private async checkProvider(name: string, provider: ethers.JsonRpcProvider) {
    try {
      const blockNumber = await provider.getBlockNumber()
      this.logger.log(`${name} JSON-RPC provider is live at block ${blockNumber}`)

      return true
    } catch (error) {
      this.logger.error(
        `${name} JSON-RPC provider is NOT usable: ` +
          `${error instanceof Error ? error.message : error}`
      )

      return false
    }
  }

  async getCurrentJsonRpcProvider() {
    return this.currentJsonRpcProvider
  }

  /** `undefined` whenever there is no usable second endpoint — callers must handle that. */
  async getBackupJsonRpcProvider() {
    return this.backupJsonRpcProvider
  }
}
