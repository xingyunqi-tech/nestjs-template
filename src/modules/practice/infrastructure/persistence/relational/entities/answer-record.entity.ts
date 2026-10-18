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
import { QuestionEntity } from '../../../../../questions/infrastructure/persistence/relational/entities/question.entity';
import { GradingStatus, SelfAssessment } from '../../../../domain/answer-record';
import { PracticeSessionEntity } from './practice-session.entity';

@Entity({ name: 'answer_record' })
@Index('UQ_answer_record_sessionId_questionId', ['sessionId', 'questionId'], { unique: true })
@Index('UQ_answer_record_userId_questionId_first', ['userId', 'questionId'], {
  unique: true,
  where: '"firstForQuestion"',
})
@Index('IDX_answer_record_userId_questionId', ['userId', 'questionId'])
@Index('IDX_answer_record_questionId_gradedAt', ['questionId', 'gradedAt'])
@Index('IDX_answer_record_gradedAt_stats_pending', ['gradedAt'], {
  where: '"statsAppliedAt" IS NULL AND "isCorrect" IS NOT NULL',
})
export class AnswerRecordEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_answer_record' })
  id: string;

  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => PracticeSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId', foreignKeyConstraintName: 'FK_answer_record_session' })
  session?: PracticeSessionEntity;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_answer_record_user' })
  user?: UserEntity;

  @Column({ type: 'uuid' })
  questionId: string;

  @ManyToOne(() => QuestionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'questionId', foreignKeyConstraintName: 'FK_answer_record_question' })
  question?: QuestionEntity;

  @Column({ type: 'int' })
  questionVersion: number;

  @Column({ type: 'jsonb', nullable: true })
  answer: Record<string, unknown> | null;

  @Column({ type: 'boolean', nullable: true })
  isCorrect: boolean | null;

  @Column({ type: 'boolean', default: false })
  isPartial: boolean;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  selfAssessment: SelfAssessment | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gradingStatus: GradingStatus | null;

  @Column({ type: 'uuid', nullable: true })
  gradingTaskId: string | null;

  @Column({ type: 'int', default: 0 })
  durationSec: number;

  @Column({ type: 'boolean', default: false })
  markedForReview: boolean;

  @Column({ type: 'varchar', length: 64 })
  deviceId: string;

  @Column({ type: 'int', default: 0 })
  clientSeq: number;

  @Column({ type: 'timestamptz' })
  clientAnsweredAt: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  answeredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  gradedAt: Date | null;

  @Column({ type: 'date', nullable: true })
  statDate: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  statsAppliedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  firstForQuestion: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
