import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum RiskTier {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  LIQUIDATABLE = 'LIQUIDATABLE',
  NO_DEBT = 'NO_DEBT',
}

@Entity('safe_snapshot')
export class SafeSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'text' })
  safeAddress: string;

  @CreateDateColumn()
  capturedAt: Date;

  @Column({ type: 'bigint', nullable: true })
  blockNumber: string;

  @Column({ type: 'real', default: 0 })
  totalCollateralUsd: number;

  @Column({ type: 'real', default: 0 })
  totalBorrowedUsd: number;

  @Column({ type: 'real', default: 0 })
  maxBorrowCapacityUsd: number;

  @Column({ type: 'real', nullable: true })
  healthFactor: number;

  @Column({ type: 'text', default: RiskTier.NO_DEBT })
  riskTier: string;

  @Column({ type: 'boolean', default: false })
  isInBorrowMode: boolean;

  @Column({ type: 'text', nullable: true })
  rawLensData: string;
}
