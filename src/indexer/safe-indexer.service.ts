import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SafeRegistry } from '../db/safe-registry.entity';
import { LensClientService } from '../health/lens-client.service';
import { parseAbiItem } from 'viem';

const SAFE_CREATED_EVENT = parseAbiItem(
  'event BeaconProxyDeployed(bytes32 salt, address indexed proxy)',
);

const IS_ETHER_FI_SAFE_ABI = [
  {
    name: 'isEtherFiSafe',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'safeAddr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// Public Scroll RPC rejects getLogs calls spanning more than ~5000 blocks.
const LOG_CHUNK_SIZE = 5000n;

@Injectable()
export class SafeIndexerService implements OnModuleInit {
  private readonly logger = new Logger(SafeIndexerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly lensClient: LensClientService,
    @InjectRepository(SafeRegistry)
    private readonly safeRepo: Repository<SafeRegistry>,
  ) {}

  onModuleInit() {
    // Run in background so HTTP server starts immediately.
    // The monitor poll loop will find safes as they are discovered.
    this.indexHistoricalSafes().catch((err) =>
      this.logger.error(`Background indexer failed: ${err.message}`),
    );
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

    const client = this.lensClient.getViemClient();
    const latestBlock: bigint = await client.getBlockNumber();
    const totalBlocks = latestBlock - fromBlock;
    const chunks = Math.ceil(Number(totalBlocks) / Number(LOG_CHUNK_SIZE));

    this.logger.log(
      `Indexing SafeCreated events from block ${fromBlock} to ${latestBlock} ` +
      `(${chunks} chunks of ${LOG_CHUNK_SIZE} blocks) on factory ${factoryAddress}...`,
    );

    let totalFound = 0;

    try {
      for (let chunkStart = fromBlock; chunkStart <= latestBlock; chunkStart += LOG_CHUNK_SIZE) {
        const chunkEnd = chunkStart + LOG_CHUNK_SIZE - 1n < latestBlock
          ? chunkStart + LOG_CHUNK_SIZE - 1n
          : latestBlock;

        const logs = await client.getLogs({
          address: factoryAddress,
          event: SAFE_CREATED_EVENT,
          fromBlock: chunkStart,
          toBlock: chunkEnd,
        });

        if (logs.length === 0) continue;

        // Batch-verify which proxies are actual EtherFiSafes before persisting.
        const proxies = logs.map((log) => ({
          address: (log.args.proxy as string).toLowerCase(),
          blockNumber: log.blockNumber?.toString() ?? '0',
        }));

        const checks = await client.multicall({
          contracts: proxies.map((p) => ({
            address: factoryAddress,
            abi: IS_ETHER_FI_SAFE_ABI,
            functionName: 'isEtherFiSafe',
            args: [p.address as `0x${string}`],
          })),
          allowFailure: true,
        });

        let chunkSaved = 0;
        for (let k = 0; k < proxies.length; k++) {
          if (checks[k].status !== 'success' || !checks[k].result) continue;

          const { address: safeAddress, blockNumber } = proxies[k];
          const existing = await this.safeRepo.findOne({ where: { safeAddress } });
          if (!existing) {
            await this.safeRepo.save({ safeAddress, firstSeenBlock: blockNumber, active: true });
            totalFound++;
            chunkSaved++;
          }
        }

        this.logger.log(
          `Chunk ${chunkStart}–${chunkEnd}: ${logs.length} proxies, ` +
          `${chunkSaved} confirmed Cash safes (${totalFound} total so far)`,
        );
      }

      this.logger.log(`Historical indexing complete. Discovered ${totalFound} new safes.`);
    } catch (err) {
      this.logger.error(`Failed to index historical safes: ${(err as Error).message}`);
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
