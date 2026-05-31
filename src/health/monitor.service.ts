import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SafeSnapshot } from '../db/safe-snapshot.entity';
import { SafeIndexerService } from '../indexer/safe-indexer.service';
import { LensClientService } from '../health/lens-client.service';
import { HealthCalculatorService } from '../health/health-calculator.service';
import { AlertService } from '../alerts/alert.service';

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);
  private readonly batchSize: number;
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly indexer: SafeIndexerService,
    private readonly lensClient: LensClientService,
    private readonly calculator: HealthCalculatorService,
    private readonly alertService: AlertService,
    @InjectRepository(SafeSnapshot)
    private readonly snapshotRepo: Repository<SafeSnapshot>,
  ) {
    this.batchSize = config.get<number>('polling.batchSize');
  }

  /**
   * Main poll loop — runs on a schedule defined by POLL_INTERVAL_MS.
   * Uses a simple guard to avoid overlapping runs.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollAllSafes(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Poll already in progress, skipping this tick.');
      return;
    }

    this.isRunning = true;
    const start = Date.now();

    try {
      const addresses = await this.indexer.getActiveSafeAddresses();

      if (addresses.length === 0) {
        this.logger.warn(
          'No active safes to monitor. Register safes via POST /safes/register or configure SAFE_FACTORY_ADDRESS.',
        );
        return;
      }

      this.logger.log(`Polling ${addresses.length} safes in batches of ${this.batchSize}...`);

      const blockNumber = (await this.lensClient.getCurrentBlock()).toString();
      let processed = 0;
      let alerted = 0;

      for (let i = 0; i < addresses.length; i += this.batchSize) {
        const batch = addresses.slice(i, i + this.batchSize);
        const results = await this.lensClient.batchGetSafeCashData(batch);

        for (let j = 0; j < batch.length; j++) {
          const safeAddress = batch[j];
          const raw = results[j];

          if (!raw) continue;

          const health = this.calculator.compute(raw);
          const snapshot = this.snapshotRepo.create({
            safeAddress,
            blockNumber,
            totalCollateralUsd: health.totalCollateralUsd,
            totalBorrowedUsd: health.totalBorrowedUsd,
            maxBorrowCapacityUsd: health.maxBorrowCapacityUsd,
            healthFactor: health.healthFactor,
            riskTier: health.riskTier,
            isInBorrowMode: health.isInBorrowMode,
            rawLensData: JSON.stringify(raw, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          });

          await this.snapshotRepo.save(snapshot);
          await this.indexer.updateLastChecked(safeAddress);

          if (health.healthFactor !== null) {
            await this.alertService.maybeAlert(
              safeAddress,
              health.riskTier,
              health.healthFactor,
            );
            if (['WARNING', 'CRITICAL', 'LIQUIDATABLE'].includes(health.riskTier)) {
              alerted++;
            }
          }

          processed++;
        }
      }

      const elapsed = Date.now() - start;
      this.logger.log(
        `Poll complete: ${processed} safes processed, ${alerted} alerts fired in ${elapsed}ms`,
      );
    } catch (err) {
      this.logger.error(`Poll loop error: ${err.message}`, err.stack);
    } finally {
      this.isRunning = false;
    }
  }

  /** Run a single poll immediately (e.g. for /monitor/run-now endpoint). */
  async runNow(): Promise<void> {
    await this.pollAllSafes();
  }
}
