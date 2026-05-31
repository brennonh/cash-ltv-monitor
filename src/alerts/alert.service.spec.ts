import { Test, TestingModule } from '@nestjs/testing';
import { AlertService } from './alert.service';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertLog } from '../db/alert-log.entity';
import { RiskTier } from '../db/safe-snapshot.entity';

const mockConfig = {
  get: (key: string) => {
    const map = {
      'alerts.slackWebhookUrl': '',
      'alerts.cooldownMs': 3600000,
    };
    return map[key];
  },
};

describe('AlertService', () => {
  let service: AlertService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: getRepositoryToken(AlertLog), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<AlertService>(AlertService);
  });

  it('does not alert for HEALTHY tier', async () => {
    await service.maybeAlert('0xabc', RiskTier.HEALTHY, 2.0);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('does not alert for NO_DEBT tier', async () => {
    await service.maybeAlert('0xabc', RiskTier.NO_DEBT, null);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('fires alert for CRITICAL when not in cooldown', async () => {
    mockRepo.findOne.mockResolvedValue(null); // no recent alert
    await service.maybeAlert('0xabc', RiskTier.CRITICAL, 1.05);
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ riskTier: RiskTier.CRITICAL }),
    );
  });

  it('suppresses alert when in cooldown', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 1, sentAt: new Date() }); // recent alert exists
    await service.maybeAlert('0xabc', RiskTier.CRITICAL, 1.05);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('fires alert for LIQUIDATABLE tier', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.maybeAlert('0xabc', RiskTier.LIQUIDATABLE, 0.8);
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ riskTier: RiskTier.LIQUIDATABLE }),
    );
  });
});
