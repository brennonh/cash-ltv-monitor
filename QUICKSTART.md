# Quick Start Guide

## Prerequisites

- Node.js 20+ and pnpm
- (Optional) Docker & Docker Compose for containerised deployment

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

All Scroll mainnet contract addresses are pre-filled in `.env.example`. The only value you need to add is optional:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/... # optional — omit to log alerts to stdout only
```

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

The indexer discovers safes automatically, but you can add one immediately without waiting:

```bash
curl -X POST http://localhost:3000/safes/register \
  -H 'Content-Type: application/json' \
  -d '{"safeAddress": "0x8227464552bc4b4b9bc8e633d377c0309fe65501"}'
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
