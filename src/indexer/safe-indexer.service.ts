import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SafeRegistry } from '../db/safe-registry.entity';
import { LensClientService } from '../health/lens-client.service';
import { parseAbiItem } from 'viem';

const SAFE_CREATED_EVENT = parseAbiItem(
  'event SafeCreated(address indexed safe, address indexed owner, address cashModule)',
);

@Injectable()
export class SafeIndexerService implements OnModuleInit {
  private readonly logger = new Logger(SafeIndexerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly lensClient: LensClientService,
    @InjectRepository(SafeRegistry)
    private readonly safeRepo: Repository<SafeRegistry>,
  ) {}

  async onModuleInit() {
    await this.indexHistoricalSafes();
  }

  /**
   * Replay SafeCreated logs from the configured start block to discover
   * all existing user safes and persist them to safe_registry.
   */
  async indexHistoricalSafes(): Promise<void> {
    const factoryAddress = this.config.get<string>('contracts.safeFactoryAddress') as `0x${string}`;
    const fromBlock = this.config.get<bigint>('polling.indexFromBlock');

    if (
      !factoryAddress ||
      factoryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      this.logger.warn(
        'SAFE_FACTORY_ADDRESS not configured — skipping historical indexing. ' +
          'Add safes manually via POST /safes/register or set the env var.',
      );
      return;
    }

    this.logger.log(
      `Indexing SafeCreated events from block ${fromBlock} on factory ${factoryAddress}...`,
    );

    try {
      const client = this.lensClient.getViemClient();
      const logs = await client.getLogs({
        address: factoryAddress,
        event: SAFE_CREATED_EVENT,
        fromBlock,
        toBlock: 'latest',
      });

      this.logger.log(`Found ${logs.length} SafeCreated events.`);

      for (const log of logs) {
        const safeAddress = (log.args.safe as string).toLowerCase();
        const ownerAddress = (log.args.owner as string).toLowerCase();
        const blockNumber = log.blockNumber?.toString() ?? '0';

        const existing = await this.safeRepo.findOne({ where: { safeAddress } });
        if (!existing) {
          await this.safeRepo.save({
            safeAddress,
            ownerAddress,
            firstSeenBlock: blockNumber,
            active: true,
          });
        }
      }

      this.logger.log('Historical indexing complete.');
    } catch (err) {
      this.logger.error(`Failed to index historical safes: ${err.message}`);
    }
  }

  /** Returns all active safe addresses to poll. */
  async getActiveSafeAddresses(): Promise<`0x${string}`[]> {
    const safes = await this.safeRepo.find({ where: { active: true } });
    return safes.map((s) => s.safeAddress as `0x${string}`);
  }

  /** Manually register a safe (useful for testing or bootstrapping). */
  async registerSafe(safeAddress: string, ownerAddress?: string): Promise<SafeRegistry> {
    const addr = safeAddress.toLowerCase();
    let safe = await this.safeRepo.findOne({ where: { safeAddress: addr } });
    if (!safe) {
      safe = this.safeRepo.create({
        safeAddress: addr,
        ownerAddress: ownerAddress?.toLowerCase(),
        active: true,
      });
      await this.safeRepo.save(safe);
      this.logger.log(`Registered safe ${addr}`);
    }
    return safe;
  }

  async updateLastChecked(safeAddress: string): Promise<void> {
    await this.safeRepo.update(
      { safeAddress: safeAddress.toLowerCase() },
      { lastCheckedAt: new Date() },
    );
  }
}
