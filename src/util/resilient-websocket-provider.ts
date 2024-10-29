/**
 * Modified from:
 *  https://github.com/ethers-io/ethers.js/issues/1053#issuecomment-2402226658
 * Thanks to @blacklistholder @trixobird
 */
import { Logger } from '@nestjs/common'
import { Listener, Networkish, ProviderEvent, WebSocketProvider } from 'ethers'
import WebSocket from 'ws'

const EXPECTED_PONG_BACK = 15000
const KEEP_ALIVE_CHECK_INTERVAL = 60 * 1000
const MAX_RECONNECTION_ATTEMPTS = 10
const RECONNECTION_DELAY = 5000

interface Subscription {
  type: ProviderEvent
  listener: Listener
}

class ResilientWebsocketProvider {
  private readonly url: string
  private readonly network: Networkish
  private terminate: boolean
  private pingTimeout: NodeJS.Timeout | null
  private keepAliveInterval: NodeJS.Timeout | null
  private ws: WebSocket | null
  private provider: WebSocketProvider | null
  readonly subscriptions: Set<Subscription>
  private reconnectionAttempts: number
  private name: string
  private maxRetriesCallback: (...args: any[]) => void
  private logger: Logger

  constructor(
    url: string,
    network: Networkish,
    name: string,
    maxRetriesCallback: (...args: any[]) => void
  ) {
    this.url = url
    this.network = network
    this.terminate = false
    this.pingTimeout = null
    this.keepAliveInterval = null
    this.ws = null
    this.provider = null
    this.subscriptions = new Set()
    this.reconnectionAttempts = 0
    this.name = name
    this.maxRetriesCallback = maxRetriesCallback
    this.logger = new Logger(`${ResilientWebsocketProvider.name}(${this.name})`)
  }

  async connect(): Promise<WebSocketProvider | null> {
    return new Promise((resolve) => {
      const startConnection = () => {
        if (this.reconnectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
          this.logger.error(
            `Max reconnection attempts (${MAX_RECONNECTION_ATTEMPTS}) reached` +
              ` for ${this.name}. Stopping reconnection.`
          )
          this.terminate = true
          this.maxRetriesCallback(this.name)
          resolve(null)
          return
        }

        this.ws = new WebSocket(this.url)

        this.ws.on('open', async () => {
          this.reconnectionAttempts = 0
          this.setupKeepAlive()

          try {
            const wsp = new WebSocketProvider(() => this.ws, this.network)

            while (this.ws?.readyState !== WebSocket.OPEN) {
              // this.logger.debug('Waiting for websocket to be open')
              await this.sleep(1000)
            }

            wsp._start()

            while (!wsp.ready) {
              // this.logger.debug('Waiting for websocket provider to be ready')
              await this.sleep(1000)
            }

            this.provider = wsp
            await this.resubscribe()
            resolve(this.provider)
          } catch (error) {
            this.logger.error(
              `Error initializing WebSocketProvider for ${this.name}:`,
              error
            )
            this.cleanupConnection()
            this.reconnectionAttempts++
            setTimeout(startConnection, RECONNECTION_DELAY)
          }
        })

        this.ws.on('close', () => {
          this.logger.error(
            `The websocket connection was closed for ${this.name}`
          )
          this.cleanupConnection()
          if (!this.terminate) {
            this.reconnectionAttempts++
            this.logger.debug(
              `Attempting to reconnect... ` +
                `(Attempt ${this.reconnectionAttempts})`
            )
            setTimeout(startConnection, RECONNECTION_DELAY)
          }
        })

        this.ws.on('error', (error) => {
          this.logger.error(`WebSocket error for ${this.name}:`, error)
        })

        this.ws.on('pong', () => {
          // this.logger.debug(
          //   'Received pong, so connection is alive, clearing the timeout'
          // )
          if (this.pingTimeout) clearTimeout(this.pingTimeout)
        })
      }

      startConnection()
    })
  }

  private setupKeepAlive() {
    this.keepAliveInterval = setInterval(() => {
      if (!this.ws) {
        // this.logger.debug('No websocket, exiting keep alive interval')
        return
      }
      // this.logger.debug('Checking if the connection is alive, sending a ping')

      this.ws.ping()

      this.pingTimeout = setTimeout(() => {
        if (this.ws) this.ws.terminate()
      }, EXPECTED_PONG_BACK)
    }, KEEP_ALIVE_CHECK_INTERVAL)
  }

  private cleanupConnection() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval)
    if (this.pingTimeout) clearTimeout(this.pingTimeout)
  }

  private async resubscribe() {
    this.logger.debug('Resubscribing to topics...')
    for (const subscription of this.subscriptions) {
      try {
        await this.provider?.on(subscription.type, subscription.listener)
        this.logger.debug(
          `Resubscribed to ${JSON.stringify(subscription.type)}`
        )
      } catch (error) {
        this.logger.error(
          error,
          `Failed to resubscribe to ${subscription.type}:`
        )
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

async function createResilientProviders(
  urls: { url: string; name: string }[],
  network: Networkish,
  maxRetriesCallback: (...args: any[]) => void
): Promise<WebSocketProvider[]> {
  const providers = await Promise.all(
    urls.map(async ({ url, name }) => {
      try {
        const resilientProvider = new ResilientWebsocketProvider(
          url,
          network,
          name,
          maxRetriesCallback
        )
        const provider = await resilientProvider.connect()
        if (provider) {
          // Wrap the provider's 'on' method to track subscriptions
          const originalOn = provider.on.bind(provider)
          provider.on = (eventName: ProviderEvent, listener: Listener) => {
            resilientProvider.subscriptions.add({ type: eventName, listener })
            return originalOn(eventName, listener)
          }
        }
        return provider
      } catch (error) {
        this.logger.error(
          `Failed to create ResilientWebsocketProvider for ${url}:`,
          error
        )
        return null
      }
    })
  )

  // Filter out any null providers (failed connections)
  return providers.filter(
    (provider) => provider !== null
  ) as WebSocketProvider[]
}

export { createResilientProviders, ResilientWebsocketProvider }
