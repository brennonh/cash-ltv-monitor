import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskTier } from '../db/safe-snapshot.entity';

const DECIMALS = 1e18; // CashLens returns USD values in 18-decimal fixed point

export interface SafeCashData {
  mode: number;
  totalCollateralUsd: bigint;
  totalBorrowedUsd: bigint;
  maxBorrowCapacityUsd: bigint;
  availableCredit: bigint;
  maxSpendDebit: bigint;
  collateralTokens: string[];
  collateralAmounts: bigint[];
  collateralAmountsUsd: bigint[];
  collateralLtvs: bigint[];
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
    const totalCollateralUsd = Number(data.totalCollateralUsd) / DECIMALS;
    const totalBorrowedUsd = Number(data.totalBorrowedUsd) / DECIMALS;
    const maxBorrowCapacityUsd = Number(data.maxBorrowCapacityUsd) / DECIMALS;
    // mode 1 = Credit/Borrow mode
    const isInBorrowMode = data.mode === 1;

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
