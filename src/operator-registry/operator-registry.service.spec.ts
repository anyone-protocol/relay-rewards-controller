/**
 * INTEGRATION test — reads a real operator-registry process on a real node.
 *
 * Requires: HB_URL, OPERATOR_REGISTRY_PROCESS_ID.
 */
import { Logger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { getAddress } from 'ethers'

import { OperatorRegistryService } from './operator-registry.service'

const HAVE_NODE = !!process.env.OPERATOR_REGISTRY_PROCESS_ID && !!process.env.HB_URL
const itNode = HAVE_NODE ? it : it.skip

describe('OperatorRegistryService', () => {
  let module: TestingModule
  let service: OperatorRegistryService

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [OperatorRegistryService]
    })
      .setLogger(new Logger())
      .compile()
    service = module.get<OperatorRegistryService>(OperatorRegistryService)
    service.onApplicationBootstrap()
  })

  afterEach(async () => {
    await module.close()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  itNode('reads the scoring slice', async () => {
    const scoring = await service.getOperatorRegistryScoring()

    // The `scoring` view, not the whole registry: exactly `verified` + `hardware`.
    expect(Object.keys(scoring).sort()).toEqual(['hardware', 'verified'])
    for (const key of ['verified', 'hardware'] as const) {
      // Lua serializes an EMPTY table as a JSON array; the service normalizes those back to
      // objects, so no caller ever sees an array here.
      expect(Array.isArray(scoring[key])).toBe(false)
      expect(typeof scoring[key]).toBe('object')
    }

    const [firstVerified] = Object.values(scoring.verified)
    if (firstVerified) {
      // Addresses are EIP-55 post-migration, not legacynet ALLCAPS. getAddress is the oracle:
      // a canonical address is its own checksum.
      expect(firstVerified).toBe(getAddress(firstVerified))
    }
  }, 60_000)
})
