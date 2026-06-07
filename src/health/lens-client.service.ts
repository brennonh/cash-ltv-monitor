import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { scroll } from 'viem/chains';
import { SafeCashData } from './health-calculator.service';

const TOKEN_DATA_COMPONENTS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const;

const CASH_LENS_ABI = [
  {
    name: 'getSafeCashData',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'debtServiceTokenPreference', type: 'address[]' },
    ],
    outputs: [
      {
        name: 'safeCashData',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'collateralBalances', type: 'tuple[]', components: TOKEN_DATA_COMPONENTS },
          { name: 'borrows', type: 'tuple[]', components: TOKEN_DATA_COMPONENTS },
          { name: 'tokenPrices', type: 'tuple[]', components: TOKEN_DATA_COMPONENTS },
          {
            name: 'withdrawalRequest',
            type: 'tuple',
            components: [
              { name: 'tokens', type: 'address[]' },
              { name: 'amounts', type: 'uint256[]' },
              { name: 'recipient', type: 'address' },
              { name: 'finalizeTime', type: 'uint96' },
            ],
          },
          { name: 'totalCollateral', type: 'uint256' },
          { name: 'totalBorrow', type: 'uint256' },
          { name: 'maxBorrow', type: 'uint256' },
          { name: 'creditMaxSpend', type: 'uint256' },
          { name: 'spendingLimitAllowance', type: 'uint256' },
          { name: 'totalCashbackEarnedInUsd', type: 'uint256' },
          { name: 'incomingModeStartTime', type: 'uint256' },
          {
            name: 'debitMaxSpend',
            type: 'tuple',
            components: [
              { name: 'spendableTokens', type: 'address[]' },
              { name: 'spendableAmounts', type: 'uint256[]' },
              { name: 'amountsInUsd', type: 'uint256[]' },
              { name: 'totalSpendableInUsd', type: 'uint256' },
            ],
          },
        ],
      },
    ],
  },
] as const;

@Injectable()
export class LensClientService {
  private readonly logger = new Logger(LensClientService.name);

  // Typed as `any` intentionally: viem 2.21.x triggers TS2589 infinite
  // recursion on both `PublicClient` and `ReturnType<typeof createPublicClient>`.
  // All public method signatures remain fully typed — `any` is private.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  private cashLensAddress: `0x${string}`;

  constructor(private readonly config: ConfigService) {
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
      args: [safeAddress, []],
    });
    return result as unknown as SafeCashData;
  }

  /**
   * Batch-fetch health data for multiple safes via multicall.
   * Returns null for any safe whose call reverts (e.g. not a Cash safe).
   */
  async batchGetSafeCashData(
    safeAddresses: `0x${string}`[],
  ): Promise<(SafeCashData | null)[]> {
    const calls = safeAddresses.map((addr) => ({
      address: this.cashLensAddress,
      abi: CASH_LENS_ABI,
      functionName: 'getSafeCashData' as const,
      args: [addr, []] as const,
    }));

    const results = await this.client.multicall({
      contracts: calls,
      allowFailure: true,
    });

    // 0xfc799379 = StalePrice custom error thrown by the ether.fi price oracle
    let stalePriceWarned = false;
    return results.map((res: any, i: number) => {
      if (res.status === 'failure') {
        const errData: string = res.error?.cause?.data ?? res.error?.data ?? '';
        if (errData === '0xfc799379') {
          if (!stalePriceWarned) {
            stalePriceWarned = true;
            this.logger.warn(
              `getSafeCashData reverted: stale oracle price data. ` +
              `Snapshots cannot be created until ether.fi updates their price feeds.`,
            );
          }
        } else {
          this.logger.debug(
            `getSafeCashData skipped ${safeAddresses[i]}: no CashModule data (safe has no borrows)`,
          );
        }
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
