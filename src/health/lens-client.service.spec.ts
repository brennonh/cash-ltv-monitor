import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LensClientService } from './lens-client.service';

const SAFE_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const LENS_ADDRESS = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;

const mockRawLensResult = {
  mode: 1,
  totalCollateralUsd: BigInt('10000000000000000000000'),
  totalBorrowedUsd: BigInt('5000000000000000000000'),
  maxBorrowCapacityUsd: BigInt('8000000000000000000000'),
  availableCredit: BigInt('3000000000000000000000'),
  maxSpendDebit: 0n,
  collateralTokens: ['0xtoken1'],
  collateralAmounts: [BigInt('1000000000000000000')],
  collateralAmountsUsd: [BigInt('10000000000000000000000')],
  collateralLtvs: [BigInt('800000000000000000')],
};

describe('LensClientService', () => {
  let service: LensClientService;
  let mockReadContract: jest.Mock;
  let mockMulticall: jest.Mock;
  let mockGetBlockNumber: jest.Mock;
  let mockGetLogs: jest.Mock;

  beforeEach(async () => {
    mockReadContract = jest.fn().mockResolvedValue(mockRawLensResult);
    mockMulticall = jest.fn();
    mockGetBlockNumber = jest.fn().mockResolvedValue(BigInt(9999));
    mockGetLogs = jest.fn().mockResolvedValue([]);

    // Mock createPublicClient so the service wires up without a real RPC
    jest.mock('viem', () => ({
      ...jest.requireActual('viem'),
      createPublicClient: jest.fn(() => ({
        readContract: mockReadContract,
        multicall: mockMulticall,
        getBlockNumber: mockGetBlockNumber,
        getLogs: mockGetLogs,
      })),
      http: jest.fn(() => ({})),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LensClientService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, any> = {
                'rpc.scrollRpcUrl': 'https://rpc.scroll.io',
                'contracts.cashLensAddress': LENS_ADDRESS,
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LensClientService>(LensClientService);
    // Manually inject mock client (bypasses createPublicClient module mock issues in jest)
    (service as any).client = {
      readContract: mockReadContract,
      multicall: mockMulticall,
      getBlockNumber: mockGetBlockNumber,
      getLogs: mockGetLogs,
    };
    (service as any).cashLensAddress = LENS_ADDRESS;
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('getSafeCashData', () => {
    it('calls readContract with correct address, ABI functionName, and args', async () => {
      await service.getSafeCashData(SAFE_A);

      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: LENS_ADDRESS,
          functionName: 'getSafeCashData',
          args: [SAFE_A],
        }),
      );
    });

    it('returns the result cast as SafeCashData', async () => {
      const result = await service.getSafeCashData(SAFE_A);
      expect(result).toBe(mockRawLensResult);
    });

    it('propagates errors from readContract', async () => {
      mockReadContract.mockRejectedValue(new Error('RPC timeout'));
      await expect(service.getSafeCashData(SAFE_A)).rejects.toThrow('RPC timeout');
    });
  });

  describe('batchGetSafeCashData', () => {
    const SAFE_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;

    it('calls multicall with one contract call per address', async () => {
      mockMulticall.mockResolvedValue([
        { status: 'success', result: mockRawLensResult },
        { status: 'success', result: mockRawLensResult },
      ]);

      await service.batchGetSafeCashData([SAFE_A, SAFE_B]);

      expect(mockMulticall).toHaveBeenCalledWith(
        expect.objectContaining({
          allowFailure: true,
          contracts: expect.arrayContaining([
            expect.objectContaining({ functionName: 'getSafeCashData', args: [SAFE_A] }),
            expect.objectContaining({ functionName: 'getSafeCashData', args: [SAFE_B] }),
          ]),
        }),
      );
    });

    it('returns SafeCashData for successful calls', async () => {
      mockMulticall.mockResolvedValue([
        { status: 'success', result: mockRawLensResult },
      ]);

      const results = await service.batchGetSafeCashData([SAFE_A]);

      expect(results).toHaveLength(1);
      expect(results[0]).toBe(mockRawLensResult);
    });

    it('returns null for failed calls without throwing', async () => {
      mockMulticall.mockResolvedValue([
        { status: 'failure', error: new Error('reverted') },
        { status: 'success', result: mockRawLensResult },
      ]);

      const results = await service.batchGetSafeCashData([SAFE_A, SAFE_B]);

      expect(results[0]).toBeNull();
      expect(results[1]).toBe(mockRawLensResult);
    });

    it('returns all nulls if every multicall entry fails', async () => {
      mockMulticall.mockResolvedValue([
        { status: 'failure', error: new Error('reverted') },
        { status: 'failure', error: new Error('reverted') },
      ]);

      const results = await service.batchGetSafeCashData([SAFE_A, SAFE_B]);

      expect(results).toEqual([null, null]);
    });

    it('returns empty array for empty input', async () => {
      mockMulticall.mockResolvedValue([]);
      const results = await service.batchGetSafeCashData([]);
      expect(results).toEqual([]);
    });
  });

  describe('getCurrentBlock', () => {
    it('returns the current block number as bigint', async () => {
      const block = await service.getCurrentBlock();
      expect(block).toBe(BigInt(9999));
    });
  });

  describe('getViemClient', () => {
    it('returns the internal viem client', () => {
      const client = service.getViemClient();
      expect(client).toBeDefined();
      expect(typeof client.getLogs).toBe('function');
    });
  });
});
