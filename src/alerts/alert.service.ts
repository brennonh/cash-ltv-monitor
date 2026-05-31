import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { AlertLog } from '../db/alert-log.entity';
import axios from 'axios';
import { RiskTier } from '../db/safe-snapshot.entity';

const ALERT_TIERS = new Set([
  RiskTier.WARNING,
  RiskTier.CRITICAL,
  RiskTier.LIQUIDATABLE,
]);

const TIER_EMOJI: Record<string, string> = {
  [RiskTier.WARNING]: '⚠️',
  [RiskTier.CRITICAL]: '🔴',
  [RiskTier.LIQUIDATABLE]: '💀',
};

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly slackWebhookUrl: string;
  private readonly cooldownMs: number;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AlertLog)
    private readonly alertLogRepo: Repository<AlertLog>,
  ) {
    this.slackWebhookUrl = config.get<string>('alerts.slackWebhookUrl');
    this.cooldownMs = config.get<number>('alerts.cooldownMs');
  }

  async maybeAlert(
    safeAddress: string,
    riskTier: string,
    healthFactor: number | null,
  ): Promise<void> {
    if (!ALERT_TIERS.has(riskTier as RiskTier)) return;

    if (await this.isInCooldown(safeAddress, riskTier)) {
      this.logger.debug(`Alert suppressed for ${safeAddress} (cooldown active)`);
      return;
    }

    await this.sendSlackAlert(safeAddress, riskTier, healthFactor);
    await this.alertLogRepo.save({ safeAddress, riskTier, healthFactor });
  }

  private async isInCooldown(safeAddress: string, riskTier: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - this.cooldownMs);
    const recent = await this.alertLogRepo.findOne({
      where: {
        safeAddress,
        riskTier,
        sentAt: MoreThan(cutoff),
      },
    });
    return !!recent;
  }

  private async sendSlackAlert(
    safeAddress: string,
    riskTier: string,
    healthFactor: number | null,
  ): Promise<void> {
    if (!this.slackWebhookUrl) {
      this.logger.warn(
        `[ALERT] ${riskTier} — Safe: ${safeAddress} HF: ${healthFactor?.toFixed(4) ?? 'N/A'} (no Slack webhook configured)`,
      );
      return;
    }

    const emoji = TIER_EMOJI[riskTier] || '❗';
    const hfDisplay = healthFactor != null ? healthFactor.toFixed(4) : 'N/A';
    const scrollScanUrl = `https://scrollscan.com/address/${safeAddress}`;

    const message = {
      text: `${emoji} *Cash Safe LTV Alert — ${riskTier}*`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${emoji} Safe LTV Alert: ${riskTier}` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Safe Address:*\n<${scrollScanUrl}|${safeAddress}>` },
            { type: 'mrkdwn', text: `*Health Factor:*\n${hfDisplay}` },
            { type: 'mrkdwn', text: `*Risk Tier:*\n${riskTier}` },
            { type: 'mrkdwn', text: `*Time:*\n${new Date().toISOString()}` },
          ],
        },
      ],
    };

    try {
      await axios.post(this.slackWebhookUrl, message);
      this.logger.log(`Slack alert sent: ${riskTier} for ${safeAddress}`);
    } catch (err) {
      this.logger.error(`Failed to send Slack alert: ${err.message}`);
    }
  }
}
