import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';

@Entity({ name: 'admin_alert' })
@Index('UQ_admin_alert_dedupKey_open', ['dedupKey'], { unique: true, where: '"acknowledgedAt" IS NULL' })
export class AdminAlertEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_admin_alert_type')
  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 20 })
  level: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 200 })
  dedupKey: string;

  @Column({ type: 'timestamp', nullable: true })
  acknowledgedAt: Date | null;

  @Index('IDX_admin_alert_createdAt')
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
