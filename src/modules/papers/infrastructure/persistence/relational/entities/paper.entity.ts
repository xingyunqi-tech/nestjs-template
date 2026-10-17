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
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
import { ContentStatus } from '../../../../../exams/domain/content-status';
import { PaperType } from '../../../../domain/paper-type';
import { MultiScoringRule } from '../../../../domain/multi-scoring-rule';
import { PaperSection } from '../../../../domain/paper-section';

@Entity({ name: 'paper' })
@Index('IDX_paper_subjectId_status_type', ['subjectId', 'status', 'type'])
export class PaperEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_paper' })
  id: string;

  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_paper_subject' })
  subject?: SubjectEntity;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 20 })
  type: PaperType;

  @Column({ type: 'smallint', nullable: true })
  year: number | null;

  @Index('IDX_paper_ownerUserId')
  @Column({ type: 'int', nullable: true })
  ownerUserId: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerUserId', foreignKeyConstraintName: 'FK_paper_owner_user' })
  ownerUser?: UserEntity | null;

  @Column({ type: 'int' })
  durationMin: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sections: PaperSection[];

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  totalScore: string;

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  objectiveScore: string;

  @Column({ type: 'varchar', length: 20, default: MultiScoringRule.ALL_OR_NOTHING })
  multiScoringRule: MultiScoringRule;

  @Column({ type: 'varchar', length: 20, default: ContentStatus.DRAFT })
  status: ContentStatus;

  @Column({ type: 'boolean', default: true })
  isFree: boolean;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
