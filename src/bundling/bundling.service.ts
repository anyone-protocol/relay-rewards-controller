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

  /**
   * up.arweave.net rejects a data item over 5 MiB. Nothing else in the path notices how close we
   * are, so this is where it gets said.
   *
   * This is not hypothetical headroom: the relay `distribution/summary` measured 541 B per scored
   * relay, so 6,010 relays is already ~62% of the cap and the ceiling is ~9,691. The seed carries
   * 9,750 lifetime fingerprints. Crossing it does not lose rewards (those settle on-chain in
   * `Complete-Round`) but it does lose that round's published archive, and today the only trace
   * would be one error line.
   */
  private static readonly ITEM_SIZE_LIMIT = 5 * 1024 * 1024
  private static readonly WARN_AT = 0.8

  async upload(
    data: string | Buffer,
    dataItemOpts: { tags?: { name: string, value: string }[] }
  ): Promise<{ id: string }> {
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length
    const pct = Math.round((size / BundlingService.ITEM_SIZE_LIMIT) * 100)
    if (size > BundlingService.ITEM_SIZE_LIMIT) {
      // Fail here rather than burn a signature and a 300s POST on an item the bundler will
      // refuse, and name the real cause instead of leaving an opaque HTTP error.
      throw new Error(
        `Item is ${Math.round(size / 1024)}KB, over the ${
          BundlingService.ITEM_SIZE_LIMIT / 1024 / 1024
        }MiB bundler limit (${pct}%). It cannot be uploaded as a single item.`
      )
    }
    if (size > BundlingService.ITEM_SIZE_LIMIT * BundlingService.WARN_AT) {
      this.logger.warn(
        `Item is ${Math.round(size / 1024)}KB, ${pct}% of the bundler's ` +
          `${BundlingService.ITEM_SIZE_LIMIT / 1024 / 1024}MiB limit. ` +
          `Uploads will start failing as this grows.`
      )
    }

    const item = createData(
      typeof data === 'string' ? data : Buffer.from(data),
      this.signer,
      { tags: dataItemOpts.tags }
    )
    await item.sign(this.signer)

    // Retry the POST, not the signing: the item is signed once and keeps its id, so re-posting
    // it is idempotent. Only worth doing for conditions that can clear on their own. A 4xx is
    // config (typically this signer missing from the bundler's faff allow-list) and a size
    // rejection is deterministic, so both fail on the first attempt rather than three times
    // slower. Round cadence is 15 minutes, so a few seconds of backoff costs nothing and turns
    // a transient blip into a round that still gets archived.
    const ATTEMPTS = 3
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let response: Response
      try {
        response = await fetch(`${this.bundlerNode}/~bundler@1.0/tx`, {
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
      } catch (error) {
        // Network failure or timeout: no response at all, always worth another try.
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < ATTEMPTS) {
          this.logger.warn(
            `Bundler POST for item ${item.id} failed (attempt ${attempt}/${ATTEMPTS}): ` +
              `${lastError.message}. Retrying.`
          )
          await new Promise(r => setTimeout(r, attempt * 2000))
          continue
        }
        throw lastError
      }

      const body = (await response.text()).replace(/\s+/g, ' ')
      if (response.ok && body.includes('"id"')) {
        if (attempt > 1) {
          this.logger.log(`Bundler accepted item ${item.id} on attempt ${attempt}`)
        }
        break
      }

      // A 400 against our own node almost always means this signer is not on the
      // bundler's faff allow-list, which is config rather than a code fault.
      lastError = new Error(
        `Bundler refused item ${item.id} with HTTP ${response.status}: ` +
          body.slice(0, 200)
      )
      const worthRetrying = response.status >= 500 || response.status === 429
      if (!worthRetrying || attempt === ATTEMPTS) {
        throw lastError
      }
      this.logger.warn(
        `${lastError.message} (attempt ${attempt}/${ATTEMPTS}). Retrying.`
      )
      await new Promise(r => setTimeout(r, attempt * 2000))
    }

    // The id that settles on Arweave is the SIGNED item id — NOT any id the node may
    // report from its local cache. Callers persist this as the summary tx.
    return { id: item.id }
  }
}
