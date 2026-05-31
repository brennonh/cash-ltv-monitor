import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  HealthCalculatorService,
  SafeCashData,
} from './health-calculator.service';
import { RiskTier } from '../db/safe-snapshot.entity';

const DECIMALS = BigInt(1e18);

const mockConfig = {
  get: (key: string) => {
    const map = {
      'thresholds.warning': 1.3,
      'thresholds.critical': 1.1,
      'thresholds.liquidatable': 1.0,
    };
    return map[key];
  },
};

const makeData = (
  totalBorrowedUsd: number,
  maxBorrowCapacityUsd: number,
  totalCollateralUsd: number,
  mode = 1,
): SafeCashData => ({
  mode,
  totalCollateralUsd: BigInt(Math.floor(totalCollateralUsd)) * DECIMALS,
  totalBorrowedUsd: BigInt(Math.floor(totalBorrowedUsd)) * DECIMALS,
  maxBorrowCapacityUsd: BigInt(Math.floor(maxBorrowCapacityUsd)) * DECIMALS,
  availableCredit: 0n,
  maxSpendDebit: 0n,
  collateralTokens: [],
  collateralAmounts: [],
  collateralAmountsUsd: [],
  collateralLtvs: [],
});

describe('HealthCalculatorService', () => {
  let service: HealthCalculatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCalculatorService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<HealthCalculatorService>(HealthCalculatorService);
  });

  it('returns NO_DEBT tier when borrowed is 0', () => {
    const result = service.compute(makeData(0, 10000, 20000));
    expect(result.riskTier).toBe(RiskTier.NO_DEBT);
    expect(result.healthFactor).toBeNull();
  });

  it('classifies HEALTHY when HF > 1.3', () => {
    // borrow 1000, capacity 2000 → HF = 2.0
    const result = service.compute(makeData(1000, 2000, 10000));
    expect(result.riskTier).toBe(RiskTier.HEALTHY);
    expect(result.healthFactor).toBeCloseTo(2.0);
  });

  it('classifies WARNING when HF between 1.1 and 1.3', () => {
    // borrow 1000, capacity 1200 → HF = 1.2
    const result = service.compute(makeData(1000, 1200, 10000));
    expect(result.riskTier).toBe(RiskTier.WARNING);
    expect(result.healthFactor).toBeCloseTo(1.2);
  });

  it('classifies CRITICAL when HF between 1.0 and 1.1', () => {
    // borrow 1000, capacity 1050 → HF = 1.05
    const result = service.compute(makeData(1000, 1050, 10000));
    expect(result.riskTier).toBe(RiskTier.CRITICAL);
    expect(result.healthFactor).toBeCloseTo(1.05);
  });

  it('classifies LIQUIDATABLE when HF <= 1.0', () => {
    // borrow 1000, capacity 900 → HF = 0.9
    const result = service.compute(makeData(1000, 900, 10000));
    expect(result.riskTier).toBe(RiskTier.LIQUIDATABLE);
    expect(result.healthFactor).toBeCloseTo(0.9);
  });

  it('classifies LIQUIDATABLE when capacity is zero', () => {
    const result = service.compute(makeData(1000, 0, 10000));
    expect(result.riskTier).toBe(RiskTier.LIQUIDATABLE);
    expect(result.healthFactor).toBe(0);
  });

  it('correctly identifies borrow mode from mode field', () => {
    const credit = service.compute(makeData(0, 0, 0, 1));
    expect(credit.isInBorrowMode).toBe(true);

    const direct = service.compute(makeData(0, 0, 0, 0));
    expect(direct.isInBorrowMode).toBe(false);
  });

  it('correctly converts 18-decimal USD values', () => {
    // 10_000 USD collateral, 5_000 USD borrowed, 8_000 capacity
    const result = service.compute(makeData(5000, 8000, 10000));
    expect(result.totalCollateralUsd).toBeCloseTo(10000);
    expect(result.totalBorrowedUsd).toBeCloseTo(5000);
    expect(result.maxBorrowCapacityUsd).toBeCloseTo(8000);
  });
});
