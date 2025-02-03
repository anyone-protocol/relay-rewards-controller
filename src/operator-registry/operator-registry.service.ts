import { Inject, Injectable, Logger } from '@nestjs/common'
import { AosSigningFunction, sendAosDryRun } from '../util/send-aos-message'
import { createEthereumDataItemSigner } from '../util/create-ethereum-data-item-signer'
import { Wallet } from 'ethers'
import _ from 'lodash'
import { EthereumSigner } from '../util/arbundles-lite'
import { ConfigService } from '@nestjs/config'
import { OperatorRegistryState } from './interfaces/operator-registry'

@Injectable()
export class OperatorRegistryService {
  private readonly logger = new Logger(OperatorRegistryService.name)

  private isLive?: string

  private readonly operatorRegistryProcessId: string
  private readonly operatorRegistryControllerKey: string

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      OPERATOR_REGISTRY_PROCESS_ID: string
    }>
  ) {
    this.isLive = config.get<string>('IS_LIVE', { infer: true })

    this.logger.log(`Initializing operator registry service (IS_LIVE: ${this.isLive})`)

    const operatorRegistryPid = this.config.get<string>('OPERATOR_REGISTRY_PROCESS_ID', {
      infer: true,
    })
    if (operatorRegistryPid != undefined) {
      this.operatorRegistryProcessId = operatorRegistryPid
    } else this.logger.error('Missing relay rewards process id')

    const operatorRegistryKey = this.config.get<string>('RELAY_REWARDS_CONTROLLER_KEY', {
      infer: true,
    })

    if (operatorRegistryKey != undefined) {
      this.operatorRegistryControllerKey = operatorRegistryKey
    } else this.logger.error('Missing relay rewards controller key')
  }

  public async getOperatorRegistryState(): Promise<OperatorRegistryState> {
    const { result } = await sendAosDryRun({
      processId: this.operatorRegistryProcessId,
      tags: [{ name: 'Action', value: 'View-State' }],
    })
    const state = JSON.parse(result.Messages[0].Data)

    for (const prop in state) {
      // NB: Lua returns empty tables as JSON arrays, so we normalize them to
      //     empty objects as when they are populated they will also be objects
      if (Array.isArray(state[prop]) && state[prop].length < 1) {
        state[prop] = {}
      }
    }

    return state
  }
}
