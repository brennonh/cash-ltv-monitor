import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  NotFoundException,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SafeSnapshot, RiskTier } from '../db/safe-snapshot.entity';
import { SafeRegistry } from '../db/safe-registry.entity';
import { SafeIndexerService } from '../indexer/safe-indexer.service';
import { MonitorService } from '../health/monitor.service';
import { isAddress } from 'viem';
import {
  RegisterSafeDto,
  HealthResponseDto,
  ListSafesResponseDto,
  AtRiskResponseDto,
  SafeDetailResponseDto,
  RegisterSafeResponseDto,
  PollTriggeredResponseDto,
} from './api.dto';

@ApiTags('Cash Safe LTV Monitor')
@Controller()
export class ApiController {
  constructor(
    @InjectRepository(SafeSnapshot)
    private readonly snapshotRepo: Repository<SafeSnapshot>,
    @InjectRepository(SafeRegistry)
    private readonly registryRepo: Repository<SafeRegistry>,
    private readonly indexer: SafeIndexerService,
    private readonly monitor: MonitorService,
  ) {}

  // ── GET /health ────────────────────────────────────────────────

  @Get('health')
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns 200 when the service is running. Use for Docker/k8s health checks.',
  })
  @ApiResponse({ status: 200, description: 'Service is healthy', type: HealthResponseDto })
  ping(): HealthResponseDto {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // ── GET /safes ─────────────────────────────────────────────────

  @Get('safes')
  @ApiOperation({
    summary: 'List all tracked safes',
    description:
      'Returns all active safes in the registry with their most recent LTV health snapshot. ' +
      'Safes without any snapshot yet will have `latestSnapshot: null`.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Max safes to return' })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0, description: 'Pagination offset' })
  @ApiResponse({ status: 200, description: 'List of safes with latest health data', type: ListSafesResponseDto })
  async listSafes(
    @Query('limit') limit = '100',
    @Query('offset') offset = '0',
  ): Promise<ListSafesResponseDto> {
    const safes = await this.registryRepo.find({
      where: { active: true },
      take: parseInt(limit),
      skip: parseInt(offset),
      order: { lastCheckedAt: 'DESC' },
    });

    const result = await Promise.all(
      safes.map(async (safe) => {
        const latest = await this.snapshotRepo.findOne({
          where: { safeAddress: safe.safeAddress },
          order: { capturedAt: 'DESC' },
        });
        return { ...safe, latestSnapshot: latest ?? null };
      }),
    );

    return { total: safes.length, safes: result as any };
  }

  // ── GET /safes/at-risk ─────────────────────────────────────────

  @Get('safes/at-risk')
  @ApiOperation({
    summary: 'List at-risk safes',
    description:
      'Returns safes whose latest snapshot is in WARNING, CRITICAL, or LIQUIDATABLE tier, ' +
      'sorted by Health Factor ascending so the most critical safes appear first. ' +
      'Health Factor = maxBorrowCapacity / totalBorrowed. ' +
      'Thresholds: WARNING ≤ 1.3, CRITICAL ≤ 1.1, LIQUIDATABLE ≤ 1.0.',
  })
  @ApiResponse({ status: 200, description: 'At-risk safes sorted by Health Factor', type: AtRiskResponseDto })
  async atRiskSafes(): Promise<AtRiskResponseDto> {
    const snapshots = await this.snapshotRepo
      .createQueryBuilder('s')
      .distinctOn(['s.safeAddress'])
      .where('s.riskTier IN (:...tiers)', {
        tiers: [RiskTier.WARNING, RiskTier.CRITICAL, RiskTier.LIQUIDATABLE],
      })
      .orderBy('s.safeAddress')
      .addOrderBy('s.capturedAt', 'DESC')
      .getMany();

    return {
      count: snapshots.length,
      safes: snapshots.sort((a, b) => (a.healthFactor ?? 99) - (b.healthFactor ?? 99)) as any,
    };
  }

  // ── GET /safes/:address ────────────────────────────────────────

  @Get('safes/:address')
  @ApiOperation({
    summary: 'Get safe health detail',
    description:
      'Returns the registry entry, latest health snapshot, and recent snapshot history for a single safe. ' +
      'Address lookup is case-insensitive.',
  })
  @ApiParam({
    name: 'address',
    description: 'EVM address of the EtherFiSafe',
    example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  })
  @ApiQuery({
    name: 'historyLimit',
    required: false,
    type: Number,
    example: 20,
    description: 'Number of historical snapshots to return (newest first)',
  })
  @ApiResponse({ status: 200, description: 'Safe detail with snapshot history', type: SafeDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Safe not found in registry' })
  async getSafe(
    @Param('address') address: string,
    @Query('historyLimit') historyLimit = '20',
  ): Promise<SafeDetailResponseDto> {
    const addr = address.toLowerCase();
    const registry = await this.registryRepo.findOne({ where: { safeAddress: addr } });

    if (!registry) throw new NotFoundException(`Safe ${address} not found in registry`);

    const latest = await this.snapshotRepo.findOne({
      where: { safeAddress: addr },
      order: { capturedAt: 'DESC' },
    });

    const history = await this.snapshotRepo.find({
      where: { safeAddress: addr },
      order: { capturedAt: 'DESC' },
      take: parseInt(historyLimit),
      select: ['id', 'capturedAt', 'healthFactor', 'riskTier', 'totalBorrowedUsd', 'totalCollateralUsd'],
    });

    return { registry: registry as any, latestSnapshot: latest as any, history: history as any };
  }

  // ── POST /safes/register ───────────────────────────────────────

  @Post('safes/register')
  @ApiOperation({
    summary: 'Manually register a safe',
    description:
      'Adds a safe address to the monitoring registry. Useful when SAFE_FACTORY_ADDRESS is not ' +
      'configured or for adding safes created before the indexer start block. ' +
      'Re-registering an existing safe is a no-op.',
  })
  @ApiBody({ type: RegisterSafeDto })
  @ApiResponse({ status: 201, description: 'Safe registered successfully', type: RegisterSafeResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or missing safeAddress' })
  async registerSafe(@Body() body: RegisterSafeDto): Promise<RegisterSafeResponseDto> {
    if (!body.safeAddress || !isAddress(body.safeAddress)) {
      throw new BadRequestException('Invalid safeAddress');
    }
    const safe = await this.indexer.registerSafe(body.safeAddress, body.ownerAddress);
    return { message: 'Safe registered', safe: safe as any };
  }

  // ── POST /monitor/run-now ──────────────────────────────────────

  @Post('monitor/run-now')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Trigger immediate poll',
    description:
      'Kicks off a full poll cycle immediately outside of the normal schedule. ' +
      'Returns 202 straight away — the poll runs asynchronously in the background.',
  })
  @ApiResponse({ status: 202, description: 'Poll triggered (runs in background)', type: PollTriggeredResponseDto })
  async runNow(): Promise<PollTriggeredResponseDto> {
    this.monitor.runNow().catch(() => {});
    return { message: 'Poll triggered' };
  }
}
