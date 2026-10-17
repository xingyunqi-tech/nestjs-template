import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { SubjectEntity } from '../../../../../exams/infrastructure/persistence/relational/entities/subject.entity';
import { ContentStatus } from '../../../../../exams/domain/content-status';
import { MultiScoringRule } from '../../../../domain/multi-scoring-rule';
import { PaperRuleItem } from '../../../../domain/paper-rule';

@Entity({ name: 'paper_rule' })
export class PaperRuleEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_paper_rule' })
  id: string;

  @Index('IDX_paper_rule_subjectId')
  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_paper_rule_subject' })
  subject?: SubjectEntity;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'int' })
  durationMin: number;

  @Column({ type: 'varchar', length: 20, default: MultiScoringRule.ALL_OR_NOTHING })
  multiScoringRule: MultiScoringRule;

  @Column({ type: 'jsonb' })
  items: PaperRuleItem[];

  @Column({ type: 'varchar', length: 20, default: ContentStatus.DRAFT })
  status: ContentStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
