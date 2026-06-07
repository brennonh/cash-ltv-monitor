# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install dependencies (uses pnpm v9)
pnpm run start:dev    # dev server with watch mode
pnpm run build        # compile TypeScript via nest build
pnpm run start:prod   # run compiled output
pnpm test             # run all unit tests
pnpm run test:watch   # run tests in watch mode
pnpm run test:cov     # run tests with coverage
pnpm run lint         # eslint src/ and test/
```

Run a single test file:
```bash
pnpm test -- --testPathPattern=health-calculator
```

## Architecture

NestJS monolith that monitors LTV health of ether.fi Cash user safes on Scroll mainnet (chain ID 534352).

**Boot sequence:**
1. `SafeIndexerService.onModuleInit` fires in background — replays `BeaconProxyDeployed` events from `SafeFactory` in 5,000-block chunks, validates each proxy via `isEtherFiSafe` multicall, persists to `safe_registry`.
2. `MonitorService` cron (`@Cron EVERY_30_SECONDS`) polls all active safes. Batches them (default 50) into multicall requests to `CashLens.getSafeCashData`, computes health via `HealthCalculatorService`, saves a `SafeSnapshot`, then calls `AlertService.maybeAlert`.
3. `AlertService` skips if safe+tier is in cooldown (default 1h), otherwise posts to Slack webhook and logs to `alert_log`.
4. `ApiController` exposes REST endpoints — all read directly from SQLite via TypeORM.

**Key data flows:**
- `LensClientService` wraps viem's `createPublicClient` on Scroll. USD values from `CashLens` are 6-decimal fixed point (USDC scale) — divide by `1e6` before storing/displaying.
- Health Factor = `maxBorrow / totalBorrow`. `null` when no debt (`NO_DEBT` tier). Mode `0` = Credit (borrow), Mode `1` = Debit (spend held tokens).
- `batchGetSafeCashData` returns `null` for reverted calls. The stale oracle error `0xfc799379` means ether.fi's price feed hasn't been updated — no snapshots can be created until they do.

## Configuration

All config flows through `src/config/config.ts` and is consumed via NestJS `ConfigService` with dot-notation keys (`rpc.scrollRpcUrl`, `contracts.cashLensAddress`, etc.). Copy `.env.example` to `.env` to start.

Contract addresses for Scroll mainnet live in the [cash-v3 repo](https://github.com/etherfi-protocol/cash-v3) at `deployments/mainnet/534352/deployments.json` (keys: `cashLens`, `debtManager`, `etherFiSafeFactory`).

`INDEX_FROM_BLOCK` should be set to the SafeFactory deployment block to avoid scanning from block 0 on first run.

## Database

SQLite via TypeORM at `./data/ltv_monitor.sqlite` (created automatically). Three entities:
- `safe_registry` — known safes, `active` flag, `lastCheckedAt`
- `safe_snapshot` — every poll result; stores raw `CashLens` response as JSON string in `rawLensData`
- `alert_log` — alert history used for cooldown deduplication (keyed on `safeAddress + riskTier`)

TypeORM is configured with `synchronize: true` (see `src/db/database.module.ts`) — schema changes apply automatically on startup.

## Important quirks

- `LensClientService.client` is typed as `any` intentionally — viem 2.21.x causes TS2589 infinite recursion on the full `PublicClient` type.
- The public Scroll RPC rejects `getLogs` spans > ~5,000 blocks, hence `LOG_CHUNK_SIZE = 5000n` in `SafeIndexerService`.
- `POLL_BATCH_SIZE` defaults to 50 for public RPC; raise to 100–200 on a dedicated node.
- Swagger UI is available at `/api` when running locally.
