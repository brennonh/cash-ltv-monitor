export default () => ({
  rpc: {
    scrollRpcUrl: process.env.SCROLL_RPC_URL || 'https://rpc.scroll.io',
  },
  contracts: {
    cashLensAddress: process.env.CASH_LENS_ADDRESS as `0x${string}`,
    debtManagerAddress: process.env.DEBT_MANAGER_ADDRESS as `0x${string}`,
    safeFactoryAddress: process.env.SAFE_FACTORY_ADDRESS as `0x${string}`,
  },
  polling: {
    intervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
    batchSize: parseInt(process.env.POLL_BATCH_SIZE || '50', 10),
    indexFromBlock: BigInt(process.env.INDEX_FROM_BLOCK || '0'),
  },
  thresholds: {
    warning: parseFloat(process.env.HF_WARNING_THRESHOLD || '1.3'),
    critical: parseFloat(process.env.HF_CRITICAL_THRESHOLD || '1.1'),
    liquidatable: parseFloat(process.env.HF_LIQUIDATABLE_THRESHOLD || '1.0'),
  },
  alerts: {
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    cooldownMs: parseInt(process.env.ALERT_COOLDOWN_MS || '3600000', 10),
  },
  db: {
    path: process.env.DB_PATH || './data/ltv_monitor.sqlite',
  },
  api: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
});
