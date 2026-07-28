import { createData, EthereumSigner } from '@dha-team/arbundles'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Wallet } from 'ethers'

/**
 * Publishes data to Arweave as a signed ANS-104 DataItem.
 *
 * Replaces @ardrive/turbo-sdk. ArDrive left Arweave, and the SDK was doing very little
 * for us here — sign an item, POST it — while dragging in a Solana payment stack
 * (@solana/spl-token -> bigint-buffer, a critical advisory) and its own bundled copy of
 * @permaweb/aoconnect 0.0.57, which is older than any pin this migration removed and
 * carries third-party default endpoints.
 *
 * The wire format is the same one publish-module.ts proved: POST the raw signed item to
 * `<bundler>/~bundler@1.0/tx`. That path is served BOTH by up.arweave.net (it is
 * HyperBEAM's own default `bundler_ans104` target — see dev_arweave.erl post_tx/4) and by
 * our own node, so moving to self-hosted bundling later is a BUNDLER_NODE config change,
 * not a code change.
 */
@Injectable()
export class BundlingService {
  private readonly logger = new Logger(BundlingService.name)

  private readonly signer: EthereumSigner
  private readonly bundlerNode: string

  constructor(
    readonly config: ConfigService<{
      BUNDLER_CONTROLLER_KEY: string
      BUNDLER_NODE: string
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
    this.bundlerNode = bundlerNode.replace(/\/+$/, '')

    // arbundles wants the raw hex; a 0x prefix silently produces a different key.
    this.signer = new EthereumSigner(bundlerControllerKey.replace(/^0x/, ''))

    this.logger.log(
      `Initialized bundling service [${this.bundlerNode}]` +
        ` as ${new Wallet(bundlerControllerKey).address}`
    )
  }

  async upload(
    data: string | Buffer,
    dataItemOpts: { tags?: { name: string, value: string }[] }
  ): Promise<{ id: string }> {
    const item = createData(
      typeof data === 'string' ? data : Buffer.from(data),
      this.signer,
      { tags: dataItemOpts.tags }
    )
    await item.sign(this.signer)

    const response = await fetch(`${this.bundlerNode}/~bundler@1.0/tx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ans104',
        'codec-device': 'ans104@1.0',
        // Required. Without it a HyperBEAM bundler answers with the Hyperbuddy HTML UI
        // and HTTP 200, which reads as success and is not.
        'Accept': 'application/json'
      },
      // getRaw() hands back a Node Buffer, which does not satisfy BodyInit under the DOM
      // lib types even though it is a Uint8Array at runtime.
      body: new Uint8Array(item.getRaw()),
      signal: AbortSignal.timeout(300_000)
    })

    const body = (await response.text()).replace(/\s+/g, ' ')
    if (!response.ok || !body.includes('"id"')) {
      // A 400 against our own node almost always means this signer is not on the
      // bundler's faff allow-list, which is config rather than a code fault.
      throw new Error(
        `Bundler refused item ${item.id} with HTTP ${response.status}: ` +
          body.slice(0, 200)
      )
    }

    // The id that settles on Arweave is the SIGNED item id — NOT any id the node may
    // report from its local cache. Callers persist this as the summary tx.
    return { id: item.id }
  }
}
