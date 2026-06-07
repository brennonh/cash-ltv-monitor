import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { RiskTier } from '../db/safe-snapshot.entity';

// ── Request DTOs ──────────────────────────────────────────────────

export class RegisterSafeDto {
  @ApiProperty({
    description: 'EVM address of the EtherFiSafe to register (checksum or lowercase)',
    example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  })
  @IsString()
  @IsNotEmpty()
  safeAddress: string;

  @ApiPropertyOptional({
    description: 'EOA address of the safe owner (informational only)',
    example: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
  })
  @IsString()
  @IsOptional()
  ownerAddress?: string;
}

// ── Response DTOs ─────────────────────────────────────────────────

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status: string;

  @ApiProperty({ example: '2026-05-28T10:00:00.000Z' })
  timestamp: string;
}

export class SafeSnapshotDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' })
  safeAddress: string;

  @ApiProperty({ example: '2026-05-28T10:00:00.000Z' })
  capturedAt: Date;

  @ApiPropertyOptional({ example: '8500000' })
  blockNumber: string;

  @ApiProperty({ description: 'Total USD value of all collateral assets', example: 25000.5 })
  totalCollateralUsd: number;

  @ApiProperty({ description: 'Total outstanding USDC debt in USD', example: 9768.92 })
  totalBorrowedUsd: number;

  @ApiProperty({ description: 'Max borrowable based on weighted LTV of all assets', example: 17646.85 })
  maxBorrowCapacityUsd: number;

  @ApiPropertyOptional({
    description: 'Health Factor = maxBorrowCapacity / totalBorrowed. Null when no debt.',
    example: 1.806,
  })
  healthFactor: number | null;

  @ApiProperty({
    enum: RiskTier,
    description: 'Risk classification based on Health Factor thresholds',
    example: RiskTier.HEALTHY,
  })
  riskTier: string;

  @ApiProperty({ description: 'Whether the safe is currently in Credit (Borrow) Mode', example: true })
  isInBorrowMode: boolean;
}

export class SafeRegistryDto {
  @ApiProperty({ example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' })
  safeAddress: string;

  @ApiPropertyOptional({ example: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B' })
  ownerAddress: string;

  @ApiPropertyOptional({ example: '7800000' })
  firstSeenBlock: string;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-05-28T10:00:00.000Z' })
  lastCheckedAt: Date;
}

export class SafeWithSnapshotDto extends SafeRegistryDto {
  @ApiPropertyOptional({ type: SafeSnapshotDto, nullable: true })
  latestSnapshot: SafeSnapshotDto | null;
}

export class ListSafesResponseDto {
  @ApiProperty({ description: 'Total number of active safes returned', example: 42 })
  total: number;

  @ApiProperty({ type: [SafeWithSnapshotDto] })
  safes: SafeWithSnapshotDto[];
}

export class AtRiskResponseDto {
  @ApiProperty({ description: 'Number of at-risk safes', example: 3 })
  count: number;

  @ApiProperty({
    type: [SafeSnapshotDto],
    description: 'At-risk safes sorted by Health Factor ascending (most critical first)',
  })
  safes: SafeSnapshotDto[];
}

export class SafeDetailResponseDto {
  @ApiProperty({ type: SafeRegistryDto })
  registry: SafeRegistryDto;

  @ApiPropertyOptional({ type: SafeSnapshotDto, nullable: true })
  latestSnapshot: SafeSnapshotDto | null;

  @ApiProperty({
    type: [SafeSnapshotDto],
    description: 'Recent health snapshots, newest first',
  })
  history: Partial<SafeSnapshotDto>[];
}

export class RegisterSafeResponseDto {
  @ApiProperty({ example: 'Safe registered' })
  message: string;

  @ApiProperty({ type: SafeRegistryDto })
  safe: SafeRegistryDto;
}

export class PollTriggeredResponseDto {
  @ApiProperty({ example: 'Poll triggered' })
  message: string;
}
