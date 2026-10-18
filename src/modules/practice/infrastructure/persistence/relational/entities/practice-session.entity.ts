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
import { PaperEntity } from '../../../../../papers/infrastructure/persistence/relational/entities/paper.entity';
import { PracticeMode } from '../../../../domain/practice-mode';
import { PracticeScope, PracticeSessionStatus, ScoringScheme, SubmitType } from '../../../../domain/practice-session';

@Entity({ name: 'practice_session' })
@Index('UQ_practice_session_userId_paperId_in_progress_mock', ['userId', 'paperId'], {
  unique: true,
  where: `"status" = 'IN_PROGRESS' AND "mode" = 'MOCK'`,
})
@Index('UQ_practice_session_userId_paperId_first_attempt', ['userId', 'paperId'], {
  unique: true,
  where: '"isFirstAttempt"',
})
@Index('UQ_practice_session_userId_subjectId_dailyDate', ['userId', 'subjectId', 'dailyDate'], {
  unique: true,
  where: `"mode" = 'DAILY'`,
})
@Index('IDX_practice_session_questionIds', ['questionIds'], { type: 'gin' })
@Index('IDX_practice_session_status_autoSubmitAt', ['status', 'autoSubmitAt'])
@Index('IDX_practice_session_status_lastActiveAt', ['status', 'lastActiveAt'])
@Index('IDX_practice_session_percentile', ['paperId', 'scoringScheme', 'isFirstAttempt', 'status', 'score'])
@Index('IDX_practice_session_userId_status_lastActiveAt', ['userId', 'status', 'lastActiveAt'])
@Index('IDX_practice_session_userId_startedAt', ['userId', 'startedAt'])
export class PracticeSessionEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_practice_session' })
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_practice_session_user' })
  user?: UserEntity;

  @Index('IDX_practice_session_subjectId')
  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_practice_session_subject' })
  subject?: SubjectEntity;

  @Column({ type: 'varchar', length: 20 })
  mode: PracticeMode;

  @Column({ type: 'uuid', nullable: true })
  paperId: string | null;

  @ManyToOne(() => PaperEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paperId', foreignKeyConstraintName: 'FK_practice_session_paper' })
  paper?: PaperEntity | null;

  @Column({ type: 'date', nullable: true })
  dailyDate: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  scope: PracticeScope;

  @Column({ type: 'uuid', array: true })
  questionIds: string[];

  @Column({ type: 'jsonb' })
  questionVersions: Record<string, number>;

  @Column({ type: 'varchar', length: 20, default: PracticeSessionStatus.IN_PROGRESS })
  status: PracticeSessionStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  activeDeviceId: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deadlineAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  autoSubmitAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  submitType: SubmitType | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastActiveAt: Date;

  @Column({ type: 'boolean', default: false })
  isFirstAttempt: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  scoringScheme: ScoringScheme | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  totalScore: string | null;

  @Column({ type: 'int', default: 0 })
  correctCount: number;

  @Column({ type: 'int', default: 0 })
  answeredCount: number;

  @Column({ type: 'int', default: 0 })
  durationSec: number;

  @Column({ type: 'int', default: 0 })
  lastIndex: number;

  @Column({ type: 'boolean', default: false })
  pendingGrading: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
