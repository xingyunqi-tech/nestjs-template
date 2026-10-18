import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import type { AiUsageKind } from '../../../../domain/ai-usage-daily';

@Entity({ name: 'ai_usage_daily' })
@Index('UQ_ai_usage_daily_date_model_kind', ['date', 'model', 'kind'], { unique: true })
export class AiUsageDailyEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_ai_usage_daily' })
  id: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'varchar', length: 20 })
  kind: AiUsageKind;

  @Column({ type: 'int', default: 0 })
  requests: number;

  @Column({ type: 'int', default: 0 })
  failures: number;

  @Column({ type: 'bigint', default: 0 })
  inputTokens: string;

  @Column({ type: 'bigint', default: 0 })
  outputTokens: string;

  @Column({ type: 'numeric', precision: 14, scale: 6, default: 0 })
  cost: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
