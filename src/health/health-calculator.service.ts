import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskTier } from '../db/safe-snapshot.entity';

const DECIMALS = 1e6; // CashLens returns USD values in 6-decimal fixed point (USDC scale)

// Mode enum: Credit = 0 (borrow against collateral), Debit = 1 (spend held tokens)
const MODE_CREDIT = 0;

export interface TokenData {
  token: string;
  amount: bigint;
}

export interface SafeCashData {
  mode: number;
  collateralBalances: TokenData[];
  borrows: TokenData[];
  tokenPrices: TokenData[];
  totalCollateral: bigint;
  totalBorrow: bigint;
  maxBorrow: bigint;
  creditMaxSpend: bigint;
  spendingLimitAllowance: bigint;
  totalCashbackEarnedInUsd: bigint;
  incomingModeStartTime: bigint;
}

export interface HealthResult {
  totalCollateralUsd: number;
  totalBorrowedUsd: number;
  maxBorrowCapacityUsd: number;
  healthFactor: number | null;
  riskTier: string;
  isInBorrowMode: boolean;
}

@Injectable()
export class HealthCalculatorService {
  private readonly warningThreshold: number;
  private readonly criticalThreshold: number;
  private readonly liquidatableThreshold: number;

  constructor(private readonly config: ConfigService) {
    this.warningThreshold = config.get<number>('thresholds.warning');
    this.criticalThreshold = config.get<number>('thresholds.critical');
    this.liquidatableThreshold = config.get<number>('thresholds.liquidatable');
  }

  compute(data: SafeCashData): HealthResult {
    const totalCollateralUsd = Number(data.totalCollateral) / DECIMALS;
    const totalBorrowedUsd = Number(data.totalBorrow) / DECIMALS;
    const maxBorrowCapacityUsd = Number(data.maxBorrow) / DECIMALS;
    // Mode.Credit = 0 means the safe is in borrow/credit mode
    const isInBorrowMode = data.mode === MODE_CREDIT;

    let healthFactor: number | null = null;
    let riskTier: string = RiskTier.NO_DEBT;

    if (totalBorrowedUsd > 0) {
      healthFactor =
        maxBorrowCapacityUsd > 0
          ? maxBorrowCapacityUsd / totalBorrowedUsd
          : 0;

      riskTier = this.classifyTier(healthFactor);
    }

    return {
      totalCollateralUsd,
      totalBorrowedUsd,
      maxBorrowCapacityUsd,
      healthFactor,
      riskTier,
      isInBorrowMode,
    };
  }

  classifyTier(healthFactor: number): string {
    if (healthFactor <= this.liquidatableThreshold) return RiskTier.LIQUIDATABLE;
    if (healthFactor <= this.criticalThreshold) return RiskTier.CRITICAL;
    if (healthFactor <= this.warningThreshold) return RiskTier.WARNING;
    return RiskTier.HEALTHY;
  }
}
