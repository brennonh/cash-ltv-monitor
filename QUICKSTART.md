# Quick Start Guide

## Prerequisites

- Node.js 20+ and npm
- (Optional) Docker & Docker Compose for containerised deployment

---

## Prerequisites

Make sure pnpm is available. The project uses pnpm v9 declared via `packageManager` in `package.json`, so Node 20's built-in corepack can activate it automatically:

```bash
corepack enable        # one-time setup — ships with Node 16+
```

Or install pnpm directly:

```bash
npm install -g pnpm
```

---

## Option 1 — Local development (recommended to start)

### 1. Install dependencies

```bash
cd cash-ltv-monitor
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

```bash
SCROLL_RPC_URL=https://rpc.scroll.io        # or your own Scroll node
CASH_LENS_ADDRESS=0x...                      # from cash-v3 deployments/mainnet/534352/deployments.json
DEBT_MANAGER_ADDRESS=0x...
SAFE_FACTORY_ADDRESS=0x...
SLACK_WEBHOOK_URL=https://hooks.slack.com/... # optional — omit to log alerts only
```

Contract addresses can be found in the [cash-v3 repo](https://github.com/etherfi-protocol/cash-v3/tree/master/deployments/mainnet/534352).

### 3. Start the service

```bash
pnpm run start:dev
```

The API is available at `http://localhost:3000`.

### 4. Verify it's running

```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"..."}
```

### 5. Register a safe manually (for quick testing)

If `SAFE_FACTORY_ADDRESS` is not yet configured, you can add individual safes:

```bash
curl -X POST http://localhost:3000/safes/register \
  -H 'Content-Type: application/json' \
  -d '{"safeAddress": "0xYourSafeAddressHere"}'
```

### 6. Trigger an immediate poll

```bash
curl -X POST http://localhost:3000/monitor/run-now
```

### 7. Check at-risk safes

```bash
curl http://localhost:3000/safes/at-risk | jq
```

---

## Option 2 — Docker Compose

### 1. Configure `.env` as above, then:

```bash
docker compose up --build
```

The SQLite database is persisted in `./data/ltv_monitor.sqlite` on your host.

### 2. Check logs

```bash
docker compose logs -f monitor
```

---

## Running tests

```bash
pnpm test              # run all unit tests
pnpm run test:cov      # with coverage report
```

---

## Project structure

```
src/
  config/         App configuration (env → typed config)
  db/             TypeORM entities + DatabaseModule
  indexer/        SafeIndexerService (event-based safe discovery)
  health/         LensClientService, HealthCalculatorService, MonitorService
  alerts/         AlertService (Slack + cooldown)
  api/            REST controller
abis/             CashLens.json, SafeFactory.json
data/             SQLite database (git-ignored)
```

---

## Updating contract ABIs

If the `CashLens` or `SafeFactory` interface changes, replace the relevant JSON files in `abis/` with the updated ABI from the [cash-v3 repo](https://github.com/etherfi-protocol/cash-v3/tree/master/out).
