import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MonitorService } from './monitor.service';
import { SafeSnapshot, RiskTier } from '../db/safe-snapshot.entity';
import { SafeIndexerService } from '../indexer/safe-indexer.service';
import { LensClientService } from './lens-client.service';
import { HealthCalculatorService } from './health-calculator.service';
import { AlertService } from '../alerts/alert.service';

const DECIMALS = BigInt(1e18);

const mockRawData = (borrowed: number, capacity: number, collateral: number, mode = 1) => ({
  mode,
  totalCollateralUsd: BigInt(collateral) * DECIMALS,
  totalBorrowedUsd: BigInt(borrowed) * DECIMALS,
  maxBorrowCapacityUsd: BigInt(capacity) * DECIMALS,
  availableCredit: 0n,
  maxSpendDebit: 0n,
  collateralTokens: [],
  collateralAmounts: [],
  collateralAmountsUsd: [],
  collateralLtvs: [],
});

const SAFE_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const SAFE_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;

describe('MonitorService', () => {
  let service: MonitorService;
  let mockSnapshotRepo: any;
  let mockIndexer: any;
  let mockLensClient: any;
  let mockCalculator: any;
  let mockAlertService: any;

  beforeEach(async () => {
    mockSnapshotRepo = {
      create: jest.fn((data) => data),
      save: jest.fn().mockResolvedValue({}),
    };

    mockIndexer = {
      getActiveSafeAddresses: jest.fn().mockResolvedValue([SAFE_A, SAFE_B]),
      updateLastChecked: jest.fn().mockResolvedValue(undefined),
    };

    mockLensClient = {
      getCurrentBlock: jest.fn().mockResolvedValue(BigInt(1000)),
      batchGetSafeCashData: jest.fn().mockResolvedValue([
        mockRawData(1000, 2000, 5000),
        mockRawData(900, 900, 3000),
      ]),
    };

    mockCalculator = {
      compute: jest.fn()
        .mockReturnValueOnce({
          totalCollateralUsd: 5000,
          totalBorrowedUsd: 1000,
          maxBorrowCapacityUsd: 2000,
          healthFactor: 2.0,
          riskTier: RiskTier.HEALTHY,
          isInBorrowMode: true,
        })
        .mockReturnValueOnce({
          totalCollateralUsd: 3000,
          totalBorrowedUsd: 900,
          maxBorrowCapacityUsd: 900,
          healthFactor: 1.0,
          riskTier: RiskTier.LIQUIDATABLE,
          isInBorrowMode: true,
        }),
    };

    mockAlertService = {
      maybeAlert: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(50) } },
        { provide: SafeIndexerService, useValue: mockIndexer },
        { provide: LensClientService, useValue: mockLensClient },
        { provide: HealthCalculatorService, useValue: mockCalculator },
        { provide: AlertService, useValue: mockAlertService },
        { provide: getRepositoryToken(SafeSnapshot), useValue: mockSnapshotRepo },
      ],
    }).compile();

    service = module.get<MonitorService>(MonitorService);
  });

  describe('pollAllSafes', () => {
    it('fetches active addresses and processes each safe', async () => {
      await service.pollAllSafes();

      expect(mockIndexer.getActiveSafeAddresses).toHaveBeenCalledTimes(1);
      expect(mockLensClient.batchGetSafeCashData).toHaveBeenCalledWith([SAFE_A, SAFE_B]);
      expect(mockCalculator.compute).toHaveBeenCalledTimes(2);
      expect(mockSnapshotRepo.save).toHaveBeenCalledTimes(2);
      expect(mockIndexer.updateLastChecked).toHaveBeenCalledTimes(2);
    });

    it('saves snapshot with correct fields for each safe', async () => {
      await service.pollAllSafes();

      const firstSave = mockSnapshotRepo.create.mock.calls[0][0];
      expect(firstSave.safeAddress).toBe(SAFE_A);
      expect(firstSave.totalBorrowedUsd).toBe(1000);
      expect(firstSave.healthFactor).toBe(2.0);
      expect(firstSave.riskTier).toBe(RiskTier.HEALTHY);
      expect(firstSave.blockNumber).toBe('1000');
    });

    it('calls maybeAlert for safes with debt', async () => {
      await service.pollAllSafes();

      expect(mockAlertService.maybeAlert).toHaveBeenCalledTimes(2);
      expect(mockAlertService.maybeAlert).toHaveBeenCalledWith(SAFE_A, RiskTier.HEALTHY, 2.0);
      expect(mockAlertService.maybeAlert).toHaveBeenCalledWith(SAFE_B, RiskTier.LIQUIDATABLE, 1.0);
    });

    it('does not call maybeAlert when healthFactor is null (no debt)', async () => {
      mockCalculator.compute
        .mockReset()
        .mockReturnValue({
          totalCollateralUsd: 5000,
          totalBorrowedUsd: 0,
          maxBorrowCapacityUsd: 0,
          healthFactor: null,
          riskTier: RiskTier.NO_DEBT,
          isInBorrowMode: false,
        });

      await service.pollAllSafes();

      expect(mockAlertService.maybeAlert).not.toHaveBeenCalled();
    });

    it('skips safes where lens call returned null', async () => {
      mockLensClient.batchGetSafeCashData.mockResolvedValue([null, mockRawData(900, 900, 3000)]);
      mockCalculator.compute.mockReset().mockReturnValue({
        totalCollateralUsd: 3000,
        totalBorrowedUsd: 900,
        maxBorrowCapacityUsd: 900,
        healthFactor: 1.0,
        riskTier: RiskTier.LIQUIDATABLE,
        isInBorrowMode: true,
      });

      await service.pollAllSafes();

      // only one safe processed (SAFE_A was null)
      expect(mockCalculator.compute).toHaveBeenCalledTimes(1);
      expect(mockSnapshotRepo.save).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no active safes are registered', async () => {
      mockIndexer.getActiveSafeAddresses.mockResolvedValue([]);

      await service.pollAllSafes();

      expect(mockLensClient.batchGetSafeCashData).not.toHaveBeenCalled();
      expect(mockSnapshotRepo.save).not.toHaveBeenCalled();
    });

    it('prevents overlapping poll runs', async () => {
      // Simulate a slow first run still in progress
      let resolveFirst: () => void;
      const firstRun = new Promise<void>((res) => { resolveFirst = res; });
      mockIndexer.getActiveSafeAddresses.mockReturnValueOnce(firstRun.then(() => []));

      const first = service.pollAllSafes();
      const second = service.pollAllSafes(); // should be skipped

      resolveFirst!();
      await Promise.all([first, second]);

      // getActiveSafeAddresses called only once (second run was blocked)
      expect(mockIndexer.getActiveSafeAddresses).toHaveBeenCalledTimes(1);
    });

    it('resets isRunning flag after an error', async () => {
      mockIndexer.getActiveSafeAddresses.mockRejectedValue(new Error('RPC timeout'));

      await service.pollAllSafes();

      // Should not throw, and a second run should be allowed
      mockIndexer.getActiveSafeAddresses.mockResolvedValue([]);
      await expect(service.pollAllSafes()).resolves.not.toThrow();
    });

    it('batches safes according to batchSize config', async () => {
      const addresses = Array.from(
        { length: 5 },
        (_, i) => `0x${i.toString().padStart(40, '0')}` as `0x${string}`,
      );
      mockIndexer.getActiveSafeAddresses.mockResolvedValue(addresses);
      mockLensClient.batchGetSafeCashData.mockResolvedValue(
        Array(addresses.length).fill(null),
      );

      // batchSize = 2 → expect 3 batches: [2, 2, 1]
      const configMock = { get: jest.fn().mockReturnValue(2) };
      const module = await Test.createTestingModule({
        providers: [
          MonitorService,
          { provide: ConfigService, useValue: configMock },
          { provide: SafeIndexerService, useValue: mockIndexer },
          { provide: LensClientService, useValue: mockLensClient },
          { provide: HealthCalculatorService, useValue: mockCalculator },
          { provide: AlertService, useValue: mockAlertService },
          { provide: getRepositoryToken(SafeSnapshot), useValue: mockSnapshotRepo },
        ],
      }).compile();

      const batchedService = module.get<MonitorService>(MonitorService);
      await batchedService.pollAllSafes();

      expect(mockLensClient.batchGetSafeCashData).toHaveBeenCalledTimes(3);
      expect(mockLensClient.batchGetSafeCashData.mock.calls[0][0]).toHaveLength(2);
      expect(mockLensClient.batchGetSafeCashData.mock.calls[2][0]).toHaveLength(1);
    });
  });

  describe('runNow', () => {
    it('delegates directly to pollAllSafes', async () => {
      const spy = jest.spyOn(service, 'pollAllSafes').mockResolvedValue();
      await service.runNow();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
