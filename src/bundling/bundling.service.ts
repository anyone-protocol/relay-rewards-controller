import {
  EthereumSigner,
  TurboAuthenticatedClient,
  TurboFactory
} from '@ardrive/turbo-sdk'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class BundlingService {
  private readonly logger = new Logger(BundlingService.name)

  private readonly bundler: TurboAuthenticatedClient

  constructor(
    readonly config: ConfigService<{
      BUNDLER_CONTROLLER_KEY: string
      BUNDLER_NODE: string
      BUNDLER_NETWORK: string
    }>
  ) {
    this.logger.log('Initializing bundling service')

    const bundlerControllerKey = config.get<string>(
      'BUNDLER_CONTROLLER_KEY',
      { infer: true }
    )
    if (!bundlerControllerKey) {
      throw new Error('BUNDLER_CONTROLLER_KEY is not set!')
    }

    const bundlerNode = config.get<string>('BUNDLER_NODE', { infer: true })
    if (!bundlerNode) {
      throw new Error('BUNDLER_NODE is not set!')
    }

    const bundlerGateway = config.get<string>(
      'BUNDLER_GATEWAY',
      { infer: true }
    )
    if (!bundlerNode) {
      throw new Error('BUNDLER_GATEWAY is not set!')
    }

    const bundlerNetwork = config.get<string>(
      'BUNDLER_NETWORK',
      { infer: true }
    )
    if (!bundlerNetwork) {
      throw new Error('BUNDLER_NETWORK is not set!')
    }

    const signer = new EthereumSigner(bundlerControllerKey)
    this.bundler = TurboFactory.authenticated({
      signer,
      gatewayUrl: bundlerGateway,
      uploadServiceConfig: { url: bundlerNode }
    })
    this.bundler.signer.getNativeAddress().then((address) => {
      this.logger.log(`Bundler controller address: ${address}`)
    })    
    
    this.logger.log(
      `Initialized bundling service` +
        ` [${bundlerGateway}, ${bundlerNode}, ${bundlerNetwork}]`
    )
  }

  async upload(
    data: Buffer,
    dataItemOpts: { tags?: { name: string, value: string }[] }
  ) {
    const signed = await this.bundler.signer.signDataItem({
      fileSizeFactory: () => data.length,
      fileStreamFactory: () => Buffer.from(data),
      dataItemOpts
    })

    return this.bundler.uploadSignedDataItem(signed)
  }
}
