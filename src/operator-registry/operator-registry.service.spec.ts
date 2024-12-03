import { Test, TestingModule } from '@nestjs/testing';
import { OperatorRegistryService } from './operator-registry.service';

describe('OperatorRegistryService', () => {
  let service: OperatorRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OperatorRegistryService],
    }).compile();

    service = module.get<OperatorRegistryService>(OperatorRegistryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
