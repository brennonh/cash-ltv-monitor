import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { scroll } from 'viem/chains';
import { SafeCashData } from './health-calculator.service';

const CASH_LENS_ABI = [
  {
    name: 'getSafeCashData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'vault', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'totalCollateralUsd', type: 'uint256' },
          { name: 'totalBorrowedUsd', type: 'uint256' },
          { name: 'maxBorrowCapacityUsd', type: 'uint256' },
          { name: 'availableCredit', type: 'uint256' },
          { name: 'maxSpendDebit', type: 'uint256' },
          { name: 'collateralTokens', type: 'address[]' },
          { name: 'collateralAmounts', type: 'uint256[]' },
          { name: 'collateralAmountsUsd', type: 'uint256[]' },
          { name: 'collateralLtvs', type: 'uint256[]' },
        ],
      },
    ],
  },
  {
    name: 'getMaxSpendCredit',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'vault', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'canSpend',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'tokens', type: 'address[]' },
      { name: 'amountsInUsd', type: 'uint256[]' },
      { name: 'txId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

@Injectable()
export class LensClientService implements OnModuleInit {
  private readonly logger = new Logger(LensClientService.name);

  // Typed as `any` intentionally: viem 2.21.x triggers TS2589 infinite
  // recursion on both `PublicClient` and `ReturnType<typeof createPublicClient>`.
  // All public method signatures remain fully typed — `any` is private.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  private cashLensAddress: `0x${string}`;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const rpcUrl = this.config.get<string>('rpc.scrollRpcUrl');
    this.cashLensAddress = this.config.get<string>(
      'contracts.cashLensAddress',
    ) as `0x${string}`;

    this.client = createPublicClient({
      chain: scroll,
      transport: http(rpcUrl),
    });

    this.logger.log(`LensClient ready. CashLens: ${this.cashLensAddress}`);
  }

  async getSafeCashData(safeAddress: `0x${string}`): Promise<SafeCashData> {
    const result = await this.client.readContract({
      address: this.cashLensAddress,
      abi: CASH_LENS_ABI,
      functionName: 'getSafeCashData',
      args: [safeAddress],
    });
    return result as unknown as SafeCashData;
  }

  /**
   * Batch-fetch health data for multiple safes via multicall.
   * Returns null for any safe whose call reverts (e.g. not in borrow mode).
   */
  async batchGetSafeCashData(
    safeAddresses: `0x${string}`[],
  ): Promise<(SafeCashData | null)[]> {
    const calls = safeAddresses.map((addr) => ({
      address: this.cashLensAddress,
      abi: CASH_LENS_ABI,
      functionName: 'getSafeCashData' as const,
      args: [addr] as const,
    }));

    const results = await this.client.multicall({
      contracts: calls,
      allowFailure: true,
    });

    return results.map((res: any, i: number) => {
      if (res.status === 'failure') {
        this.logger.warn(
          `getSafeCashData failed for ${safeAddresses[i]}: ${(res.error as Error)?.message}`,
        );
        return null;
      }
      return res.result as unknown as SafeCashData;
    });
  }

  async getCurrentBlock(): Promise<bigint> {
    return this.client.getBlockNumber() as Promise<bigint>;
  }

  getViemClient(): any {
    return this.client;
  }
}
