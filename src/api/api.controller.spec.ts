import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApiController } from './api.controller';
import { SafeSnapshot, RiskTier } from '../db/safe-snapshot.entity';
import { SafeRegistry } from '../db/safe-registry.entity';
import { SafeIndexerService } from '../indexer/safe-indexer.service';
import { MonitorService } from '../health/monitor.service';

const SAFE_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SAFE_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const makeSnapshot = (overrides = {}): SafeSnapshot =>
  ({
    id: 1,
    safeAddress: SAFE_A,
    capturedAt: new Date('2026-01-01'),
    blockNumber: '1000',
    totalCollateralUsd: 10000,
    totalBorrowedUsd: 5000,
    maxBorrowCapacityUsd: 8000,
    healthFactor: 1.6,
    riskTier: RiskTier.HEALTHY,
    isInBorrowMode: true,
    rawLensData: '{}',
    ...overrides,
  } as SafeSnapshot);

const makeRegistry = (overrides = {}): SafeRegistry =>
  ({
    safeAddress: SAFE_A,
    ownerAddress: '0x1234',
    active: true,
    firstSeenBlock: '100',
    createdAt: new Date(),
    lastCheckedAt: new Date(),
    ...overrides,
  } as SafeRegistry);

describe('ApiController', () => {
  let controller: ApiController;
  let mockSnapshotRepo: any;
  let mockRegistryRepo: any;
  let mockIndexer: any;
  let mockMonitor: any;

  beforeEach(async () => {
    mockSnapshotRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    mockRegistryRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    mockIndexer = {
      registerSafe: jest.fn(),
    };

    mockMonitor = {
      runNow: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        { provide: getRepositoryToken(SafeSnapshot), useValue: mockSnapshotRepo },
        { provide: getRepositoryToken(SafeRegistry), useValue: mockRegistryRepo },
        { provide: SafeIndexerService, useValue: mockIndexer },
        { provide: MonitorService, useValue: mockMonitor },
      ],
    }).compile();

    controller = module.get<ApiController>(ApiController);
  });

  // ── GET /health ─────────────────────────────────────────────────
  describe('ping (GET /health)', () => {
    it('returns status ok with a timestamp', () => {
      const result = controller.ping();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });

  // ── GET /safes ───────────────────────────────────────────────────
  describe('listSafes (GET /safes)', () => {
    it('returns all active safes with their latest snapshots', async () => {
      const safes = [makeRegistry(), makeRegistry({ safeAddress: SAFE_B })];
      mockRegistryRepo.find.mockResolvedValue(safes);
      mockSnapshotRepo.findOne
        .mockResolvedValueOnce(makeSnapshot())
        .mockResolvedValueOnce(null);

      const result = await controller.listSafes('100', '0');

      expect(result.total).toBe(2);
      expect(result.safes[0].latestSnapshot).not.toBeNull();
      expect(result.safes[1].latestSnapshot).toBeNull();
    });

    it('passes limit and offset to the repo query', async () => {
      mockRegistryRepo.find.mockResolvedValue([]);
      await controller.listSafes('10', '20');
      expect(mockRegistryRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
    });

    it('returns empty list when no safes registered', async () => {
      mockRegistryRepo.find.mockResolvedValue([]);
      const result = await controller.listSafes();
      expect(result.total).toBe(0);
      expect(result.safes).toEqual([]);
    });
  });

  // ── GET /safes/at-risk ───────────────────────────────────────────
  describe('atRiskSafes (GET /safes/at-risk)', () => {
    const mockQb = (snapshots: SafeSnapshot[]) => ({
      distinctOn: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(snapshots),
    });

    it('returns at-risk safes sorted by healthFactor ascending', async () => {
      const snaps = [
        makeSnapshot({ safeAddress: SAFE_A, healthFactor: 1.25, riskTier: RiskTier.WARNING }),
        makeSnapshot({ safeAddress: SAFE_B, healthFactor: 0.9, riskTier: RiskTier.LIQUIDATABLE }),
      ];
      mockSnapshotRepo.createQueryBuilder.mockReturnValue(mockQb(snaps));

      const result = await controller.atRiskSafes();

      expect(result.count).toBe(2);
      // sorted ascending by HF: LIQUIDATABLE (0.9) first
      expect(result.safes[0].riskTier).toBe(RiskTier.LIQUIDATABLE);
      expect(result.safes[1].riskTier).toBe(RiskTier.WARNING);
    });

    it('returns empty when no at-risk safes', async () => {
      mockSnapshotRepo.createQueryBuilder.mockReturnValue(mockQb([]));
      const result = await controller.atRiskSafes();
      expect(result.count).toBe(0);
      expect(result.safes).toEqual([]);
    });

    it('handles null healthFactor gracefully in sort (treats as 99)', async () => {
      const snaps = [
        makeSnapshot({ healthFactor: null, riskTier: RiskTier.LIQUIDATABLE }),
        makeSnapshot({ safeAddress: SAFE_B, healthFactor: 1.2, riskTier: RiskTier.WARNING }),
      ];
      mockSnapshotRepo.createQueryBuilder.mockReturnValue(mockQb(snaps));

      const result = await controller.atRiskSafes();
      // null HF (→ 99) sorts after 1.2
      expect(result.safes[0].healthFactor).toBe(1.2);
    });
  });

  // ── GET /safes/:address ──────────────────────────────────────────
  describe('getSafe (GET /safes/:address)', () => {
    it('returns registry, latest snapshot, and history for a known safe', async () => {
      mockRegistryRepo.findOne.mockResolvedValue(makeRegistry());
      mockSnapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      mockSnapshotRepo.find.mockResolvedValue([makeSnapshot()]);

      const result = await controller.getSafe(SAFE_A);

      expect(result.registry.safeAddress).toBe(SAFE_A);
      expect(result.latestSnapshot).not.toBeNull();
      expect(result.history).toHaveLength(1);
    });

    it('normalises address to lowercase before querying', async () => {
      mockRegistryRepo.findOne.mockResolvedValue(makeRegistry());
      mockSnapshotRepo.findOne.mockResolvedValue(null);
      mockSnapshotRepo.find.mockResolvedValue([]);

      await controller.getSafe(SAFE_A.toUpperCase());

      expect(mockRegistryRepo.findOne).toHaveBeenCalledWith({
        where: { safeAddress: SAFE_A.toLowerCase() },
      });
    });

    it('throws NotFoundException for an unregistered safe', async () => {
      mockRegistryRepo.findOne.mockResolvedValue(null);

      await expect(controller.getSafe(SAFE_A)).rejects.toThrow(NotFoundException);
    });

    it('respects historyLimit query param', async () => {
      mockRegistryRepo.findOne.mockResolvedValue(makeRegistry());
      mockSnapshotRepo.findOne.mockResolvedValue(null);
      mockSnapshotRepo.find.mockResolvedValue([]);

      await controller.getSafe(SAFE_A, '5');

      expect(mockSnapshotRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  // ── POST /safes/register ─────────────────────────────────────────
  describe('registerSafe (POST /safes/register)', () => {
    it('registers a valid safe address and returns it', async () => {
      const saved = makeRegistry();
      mockIndexer.registerSafe.mockResolvedValue(saved);

      const result = await controller.registerSafe({ safeAddress: SAFE_A });

      expect(mockIndexer.registerSafe).toHaveBeenCalledWith(SAFE_A, undefined);
      expect(result.message).toBe('Safe registered');
      expect(result.safe).toBe(saved);
    });

    it('passes ownerAddress through to the indexer', async () => {
      mockIndexer.registerSafe.mockResolvedValue(makeRegistry());
      const owner = '0x1234567890123456789012345678901234567890';

      await controller.registerSafe({ safeAddress: SAFE_A, ownerAddress: owner });

      expect(mockIndexer.registerSafe).toHaveBeenCalledWith(SAFE_A, owner);
    });

    it('throws BadRequestException for an invalid address', async () => {
      await expect(
        controller.registerSafe({ safeAddress: 'not-an-address' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when safeAddress is missing', async () => {
      await expect(
        controller.registerSafe({ safeAddress: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── POST /monitor/run-now ────────────────────────────────────────
  describe('runNow (POST /monitor/run-now)', () => {
    it('triggers monitor.runNow() and returns 202 message', async () => {
      const result = await controller.runNow();

      // fire-and-forget — just check message returned immediately
      expect(result).toEqual({ message: 'Poll triggered' });
    });

    it('does not await monitor.runNow() — returns before poll finishes', async () => {
      let pollFinished = false;
      mockMonitor.runNow.mockImplementation(
        () => new Promise<void>((res) => setTimeout(() => { pollFinished = true; res(); }, 100)),
      );

      const result = await controller.runNow();

      // Response returned before the poll completed
      expect(result).toEqual({ message: 'Poll triggered' });
      expect(pollFinished).toBe(false);
    });
  });
});
