import { ConfigService } from '@nestjs/config'

import { BundlingService } from './bundling.service'

/**
 * The bundler refuses items over 5 MiB. This guard is the only thing in the path that says so
 * before we spend a signature and a 300s POST on an item that cannot be accepted.
 *
 * It matters because we are already close: the relay `distribution/summary` measures ~541 B per
 * scored relay, which puts 6,010 relays at ~62% of the cap and the ceiling near 9,691.
 */
describe('BundlingService size guard', () => {
  const CAP = 5 * 1024 * 1024
  // A marked throwaway test key. Never used to sign anything but these local assertions.
  const TEST_KEY =
    '0123456789012345678901234567890123456789012345678901234567890123'

  const service = () =>
    new BundlingService(
      new ConfigService({
        BUNDLER_CONTROLLER_KEY: TEST_KEY,
        BUNDLER_NODE: 'http://localhost:1'
      }) as any
    )

  it('refuses an item over the cap, naming the size and the limit', async () => {
    await expect(
      service().upload(Buffer.alloc(CAP + 1), { tags: [] })
    ).rejects.toThrow(/over the 5MiB bundler limit/)
  })

  it('refuses before signing or posting, so the failure is fast and self-explaining', async () => {
    // The bundler node points at a closed port: if the guard did not fire first, this would
    // surface as a connection error instead of the size message.
    await expect(
      service().upload(Buffer.alloc(CAP + 1), { tags: [] })
    ).rejects.toThrow(/cannot be uploaded as a single item/)
  })

  // These two DO reach the network (the guard's job is to let them past), and the bundler node
  // points at a closed port, so they fail on transport after the retries back off. The
  // assertion is on WHICH error: anything but the size guard means the guard passed it on.
  const failureFrom = async (bytes: number) => {
    const error = await service()
      .upload(Buffer.alloc(bytes), { tags: [] })
      .then(() => null, (e: Error) => e)

    return String(error?.message ?? '')
  }

  it('lets an item just under the cap through to the network', async () => {
    expect(await failureFrom(CAP - 1024)).not.toMatch(/bundler limit/)
  }, 30_000)

  it('passes a realistic live-sized summary (6,010 relays at ~541 B)', async () => {
    expect(await failureFrom(541 * 6010)).not.toMatch(/bundler limit/)
  }, 30_000)
})
