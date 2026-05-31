import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('alert_log')
export class AlertLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'text' })
  safeAddress: string;

  @Column({ type: 'text' })
  riskTier: string;

  @Column({ type: 'real', nullable: true })
  healthFactor: number;

  @CreateDateColumn()
  sentAt: Date;
}
