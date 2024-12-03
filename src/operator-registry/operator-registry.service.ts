import { Injectable, Logger } from '@nestjs/common';
import RoundData from 'src/distribution/dto/round-data';
import RoundMetadata from 'src/distribution/dto/round-metadata';

import {
    AosSigningFunction,
    sendAosDryRun,
    sendAosMessage
  } from '../util/send-aos-message'
import { createEthereumDataItemSigner } from '../util/create-ethereum-data-item-signer'
import { Wallet } from 'ethers'
import _ from 'lodash'
import { EthereumSigner } from '../util/arbundles-lite'
import { ConfigService } from '@nestjs/config';
import { AddScoresData, AddScoresResult } from 'src/distribution/dto/add-scores';
import RoundSnapshot from 'src/distribution/dto/round-snapshot';
import { RelayRewardsService } from 'src/relay-rewards/relay-rewards.service'
import { HttpService } from '@nestjs/axios'
import { AxiosError } from 'axios'
import { firstValueFrom, catchError } from 'rxjs'
import { latLngToCell } from 'h3-js'
import * as geoip from 'geoip-lite'

@Injectable()
export class OperatorRegistryService {
    private readonly logger = new Logger(OperatorRegistryService.name)

    private isLive?: string

    private readonly operatorRegistryProcessId: string
    private readonly operatorRegistryControllerKey: string
      
    private signer!: AosSigningFunction

    constructor(
        private readonly config: ConfigService<{
            IS_LIVE: string
            OPERATOR_REGISTRY_PROCESS_ID: string
            OPERATOR_REGISTRY_CONTROLLER_KEY: string
        }>
    ) {
        this.isLive = config.get<string>('IS_LIVE', { infer: true })

        this.logger.log(
            `Initializing operator registry service (IS_LIVE: ${this.isLive})`,
        )
        
        const operatorRegistryPid = this.config.get<string>(
            'OPERATOR_REGISTRY_PROCESS_ID',
            {
                infer: true,
            },
        )
        if (operatorRegistryPid != undefined) {
            this.operatorRegistryProcessId = operatorRegistryPid
        } else this.logger.error('Missing relay rewards process id')

        const operatorRegistryKey = this.config.get<string>(
            'RELAY_REWARDS_CONTROLLER_KEY',
            {
                infer: true,
            },
        )

        if (operatorRegistryKey != undefined) {
            this.operatorRegistryControllerKey = operatorRegistryKey
        } else this.logger.error('Missing relay rewards controller key')
    }

    async onApplicationBootstrap(): Promise<void> {
        this.signer = await createEthereumDataItemSigner(
            new EthereumSigner(this.operatorRegistryControllerKey)
        )
        const wallet = new Wallet(this.operatorRegistryControllerKey)
        const address = await wallet.getAddress()
        this.logger.log(`Bootstrapped with signer address ${address}`)
    }

    public async fetchVerifiedOperators(): Promise<{ [key: string]: string }> {
        try {
            const { messageId, result } = await sendAosMessage({
                processId: this.operatorRegistryProcessId,
                signer: this.signer as any, // NB: types, lol
                tags: [
                    { name: 'Action', value: 'List-Fingerprint-Certificates' }
                ]
            })
    
            if (!result.Error) {
                this.logger.log(
                    `List-Fingerprint-Certificates: ${messageId ?? 'no-message-id'}`
                )

                const data: { [key: string]: string } = JSON.parse(result.Messages[0].Data)
        
                return data
            } else {
                this.logger.error(
                    `Failed fetching List-Fingerprint-Certificates: ${result.Error}`,
                )
            }
        } catch (error) {
            this.logger.error(`Exception in fetchVerifiedOperators`, error.stack)
        }
        return {}
    }

    public async fetchHardwareFingerprints(): Promise<{ [key: string]: boolean }> {
        try {
            const { messageId, result } = await sendAosMessage({
                processId: this.operatorRegistryProcessId,
                signer: this.signer as any, // NB: types, lol
                tags: [
                    { name: 'Action', value: 'List-Verified-Hardware' }
                ]
            })
    
            if (!result.Error) {
                this.logger.log(
                    `List-Verified-Hardware: ${messageId ?? 'no-message-id'}`
                )

                const data: { [key: string]: boolean } = JSON.parse(result.Messages[0].Data)
        
                return data
            } else {
                this.logger.error(
                    `Failed fetching List-Verified-Hardware: ${result.Error}`,
                )
            }
        } catch (error) {
            this.logger.error(`Exception in fetchHardwareFingerprints`, error.stack)
        }
        return {}
    }
}
