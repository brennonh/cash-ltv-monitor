import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('safe_registry')
export class SafeRegistry {
  @PrimaryColumn({ type: 'text' })
  safeAddress: string;

  @Column({ type: 'text', nullable: true })
  ownerAddress: string;

  @Column({ type: 'bigint', nullable: true })
  firstSeenBlock: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastCheckedAt: Date;
}
