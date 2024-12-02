import { Test, TestingModule } from '@nestjs/testing';
import { RelayRewardsService } from './relay-rewards.service';

describe('RelayRewardsService', () => {
  let service: RelayRewardsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RelayRewardsService],
    }).compile();

    service = module.get<RelayRewardsService>(RelayRewardsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
