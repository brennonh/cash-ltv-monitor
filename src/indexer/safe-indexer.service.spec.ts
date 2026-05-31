import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SafeIndexerService } from './safe-indexer.service';
import { SafeRegistry } from '../db/safe-registry.entity';
import { LensClientService } from '../health/lens-client.service';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const FACTORY_ADDRESS = '0xfactoryfactoryfactoryfactoryfactoryfact00' as `0x${string}`;
const SAFE_1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SAFE_2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OWNER_1 = '0x1111111111111111111111111111111111111111';

// Builds a fresh module with a new set of mocks each call to prevent state leakage
const buildService = async (factoryAddress: string | undefined = FACTORY_ADDRESS) => {
  const mockSafeRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((data: any) => data),
    save: jest.fn().mockImplementation((data: any) => Promise.resolve({ ...data, id: 1 })),
    update: jest.fn().mockResolvedValue({}),
  };

  const mockGetLogs = jest.fn().mockResolvedValue([]);
  const mockLensClient = {
    getViemClient: jest.fn().mockReturnValue({ getLogs: mockGetLogs }),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      const map: Record<string, any> = {
        'contracts.safeFactoryAddress': factoryAddress,
        'polling.indexFromBlock': BigInt(0),
      };
      return map[key];
    }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SafeIndexerService,
      { provide: ConfigService, useValue: mockConfig },
      { provide: LensClientService, useValue: mockLensClient },
      { provide: getRepositoryToken(SafeRegistry), useValue: mockSafeRepo },
    ],
  }).compile();

  const service = module.get<SafeIndexerService>(SafeIndexerService);

  return { service, mockSafeRepo, mockLensClient, mockGetLogs, mockConfig };
};

describe('SafeIndexerService', () => {
  describe('indexHistoricalSafes', () => {
    it('skips indexing when factory address is zero address', async () => {
      const { service, mockLensClient } = await buildService(ZERO_ADDRESS);
      await service.indexHistoricalSafes();
      expect(mockLensClient.getViemClient).not.toHaveBeenCalled();
    });

    // it('skips indexing when factory address is undefined', async () => {
    //   const { service, mockLensClient } = await buildService(undefined);
    //   await service.indexHistoricalSafes();
    //   expect(mockLensClient.getViemClient).not.toHaveBeenCalled();
    // });

    it('skips indexing when factory address is empty string', async () => {
      const { service, mockLensClient } = await buildService('');
      await service.indexHistoricalSafes();
      expect(mockLensClient.getViemClient).not.toHaveBeenCalled();
    });

    it('calls getLogs with correct factory address and fromBlock', async () => {
      const { service, mockGetLogs } = await buildService(FACTORY_ADDRESS);
      await service.indexHistoricalSafes();
      expect(mockGetLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          address: FACTORY_ADDRESS,
          fromBlock: BigInt(0),
          toBlock: 'latest',
        }),
      );
    });

    it('persists newly discovered safes from SafeCreated events', async () => {
      const { service, mockSafeRepo, mockGetLogs } = await buildService(FACTORY_ADDRESS);
      mockGetLogs.mockResolvedValue([
        { args: { safe: SAFE_1, owner: OWNER_1 }, blockNumber: BigInt(500) },
        { args: { safe: SAFE_2, owner: OWNER_1 }, blockNumber: BigInt(600) },
      ]);
      mockSafeRepo.findOne.mockResolvedValue(null); // both are new

      await service.indexHistoricalSafes();

      expect(mockSafeRepo.save).toHaveBeenCalledTimes(2);
      expect(mockSafeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          safeAddress: SAFE_1,
          ownerAddress: OWNER_1,
          firstSeenBlock: '500',
          active: true,
        }),
      );
    });

    it('does not re-save a safe that already exists in the registry', async () => {
      const { service, mockSafeRepo, mockGetLogs } = await buildService(FACTORY_ADDRESS);
      mockGetLogs.mockResolvedValue([
        { args: { safe: SAFE_1, owner: OWNER_1 }, blockNumber: BigInt(500) },
      ]);
      mockSafeRepo.findOne.mockResolvedValue({ safeAddress: SAFE_1 }); // already exists

      await service.indexHistoricalSafes();

      expect(mockSafeRepo.save).not.toHaveBeenCalled();
    });

    it('handles getLogs RPC errors gracefully without throwing', async () => {
      const { service, mockGetLogs } = await buildService(FACTORY_ADDRESS);
      mockGetLogs.mockRejectedValue(new Error('RPC error'));

      await expect(service.indexHistoricalSafes()).resolves.not.toThrow();
    });

    it('uses blockNumber "0" when log has no blockNumber', async () => {
      const { service, mockSafeRepo, mockGetLogs } = await buildService(FACTORY_ADDRESS);
      mockGetLogs.mockResolvedValue([
        { args: { safe: SAFE_1, owner: OWNER_1 }, blockNumber: null },
      ]);

      await service.indexHistoricalSafes();

      expect(mockSafeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ firstSeenBlock: '0' }),
      );
    });
  });

  describe('getActiveSafeAddresses', () => {
    it('returns only active safe addresses as hex strings', async () => {
      const { service, mockSafeRepo } = await buildService();
      mockSafeRepo.find.mockResolvedValue([
        { safeAddress: SAFE_1, active: true },
        { safeAddress: SAFE_2, active: true },
      ]);

      const result = await service.getActiveSafeAddresses();

      expect(result).toEqual([SAFE_1, SAFE_2]);
      expect(mockSafeRepo.find).toHaveBeenCalledWith({ where: { active: true } });
    });

    it('returns empty array when no safes are registered', async () => {
      const { service } = await buildService();
      const result = await service.getActiveSafeAddresses();
      expect(result).toEqual([]);
    });
  });

  describe('registerSafe', () => {
    it('creates and saves a new safe when not already registered', async () => {
      const { service, mockSafeRepo } = await buildService();
      const saved = { safeAddress: SAFE_1.toLowerCase(), ownerAddress: OWNER_1, active: true };
      mockSafeRepo.save.mockResolvedValue(saved);

      const result = await service.registerSafe(SAFE_1, OWNER_1);

      expect(mockSafeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          safeAddress: SAFE_1.toLowerCase(),
          ownerAddress: OWNER_1.toLowerCase(),
          active: true,
        }),
      );
      expect(mockSafeRepo.save).toHaveBeenCalledTimes(1);
      expect(result).toEqual(saved);
    });

    it('returns existing safe without saving if already registered', async () => {
      const { service, mockSafeRepo } = await buildService();
      const existing = { safeAddress: SAFE_1, active: true };
      mockSafeRepo.findOne.mockResolvedValue(existing);

      const result = await service.registerSafe(SAFE_1);

      expect(mockSafeRepo.save).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('normalises address to lowercase before lookup and save', async () => {
      const { service, mockSafeRepo } = await buildService();

      await service.registerSafe(SAFE_1.toUpperCase());

      expect(mockSafeRepo.findOne).toHaveBeenCalledWith({
        where: { safeAddress: SAFE_1.toLowerCase() },
      });
    });

    it('registers safe without ownerAddress when omitted', async () => {
      const { service, mockSafeRepo } = await buildService();

      await service.registerSafe(SAFE_1);

      expect(mockSafeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerAddress: undefined }),
      );
    });
  });

  describe('updateLastChecked', () => {
    it('calls repo.update with lowercased address and a Date', async () => {
      const { service, mockSafeRepo } = await buildService();

      await service.updateLastChecked(SAFE_1.toUpperCase());

      expect(mockSafeRepo.update).toHaveBeenCalledWith(
        { safeAddress: SAFE_1.toLowerCase() },
        expect.objectContaining({ lastCheckedAt: expect.any(Date) }),
      );
    });
  });
});
