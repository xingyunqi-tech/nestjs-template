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
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
import { SubjectEntity } from '../../../../../exams/infrastructure/persistence/relational/entities/subject.entity';
import { QuestionType } from '../../../../domain/question-type';
import { QuestionStatus } from '../../../../domain/question-status';
import { QuestionSource } from '../../../../domain/question-source';
import { QuestionAnswer, QuestionOption } from '../../../../domain/question-answer';
import { REJECT_REASON_MAX_LENGTH } from '../../../../domain/question';

@Entity({ name: 'question' })
@Index('UQ_question_subjectId_contentHash', ['subjectId', 'contentHash'], { unique: true })
export class QuestionEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_question' })
  id: string;

  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_question_subject' })
  subject?: SubjectEntity;

  @Index('IDX_question_parentId')
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => QuestionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parentId', foreignKeyConstraintName: 'FK_question_parent' })
  parent?: QuestionEntity | null;

  @Column({ type: 'varchar', length: 20 })
  type: QuestionType;

  @Column({ type: 'int', default: 0 })
  currentVersion: number;

  @Column({ type: 'text' })
  stem: string;

  @Column({ type: 'jsonb', nullable: true })
  options: QuestionOption[] | null;

  @Column({ type: 'jsonb', nullable: true })
  answer: QuestionAnswer | null;

  @Column({ type: 'text', nullable: true })
  analysis: string | null;

  @Column({ type: 'smallint', default: 3 })
  difficulty: number;

  @Column({ type: 'text', nullable: true })
  material: string | null;

  @Column({ type: 'uuid', nullable: true })
  audioFileId: string | null;

  @Column({ type: 'varchar', length: 20, default: QuestionSource.ORIGINAL })
  source: QuestionSource;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceNote: string | null;

  @Index('IDX_question_status')
  @Column({ type: 'varchar', length: 20, default: QuestionStatus.DRAFT })
  status: QuestionStatus;

  @Column({ type: 'boolean', default: true })
  isFree: boolean;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'char', length: 64 })
  contentHash: string;

  @Column({ type: 'int', default: 0 })
  statAnswered: number;

  @Column({ type: 'int', default: 0 })
  statCorrect: number;

  @Column({ type: 'int', nullable: true })
  createdBy: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdBy', foreignKeyConstraintName: 'FK_question_creator' })
  creator?: UserEntity | null;

  @Column({ type: 'int', nullable: true })
  submittedBy: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'submittedBy', foreignKeyConstraintName: 'FK_question_submitter' })
  submitter?: UserEntity | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  reviewedBy: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewedBy', foreignKeyConstraintName: 'FK_question_reviewer' })
  reviewer?: UserEntity | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'varchar', length: REJECT_REASON_MAX_LENGTH, nullable: true })
  rejectReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
