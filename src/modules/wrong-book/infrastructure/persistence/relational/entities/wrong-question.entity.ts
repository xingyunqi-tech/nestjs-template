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
import { QuestionEntity } from '../../../../../questions/infrastructure/persistence/relational/entities/question.entity';
import { WrongQuestionStatus } from '../../../../domain/wrong-question';

@Entity({ name: 'wrong_question' })
@Index('UQ_wrong_question_userId_questionId', ['userId', 'questionId'], { unique: true })
@Index('IDX_wrong_question_userId_status_lastWrongAt', ['userId', 'status', 'lastWrongAt'])
@Index('IDX_wrong_question_userId_subjectId_status', ['userId', 'subjectId', 'status'])
export class WrongQuestionEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_wrong_question' })
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_wrong_question_user' })
  user?: UserEntity;

  @Index('IDX_wrong_question_questionId')
  @Column({ type: 'uuid' })
  questionId: string;

  @ManyToOne(() => QuestionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'questionId', foreignKeyConstraintName: 'FK_wrong_question_question' })
  question?: QuestionEntity;

  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_wrong_question_subject' })
  subject?: SubjectEntity;

  @Column({ type: 'int', default: 0 })
  wrongCount: number;

  @Column({ type: 'int', default: 0 })
  consecutiveCorrect: number;

  @Column({ type: 'date', nullable: true })
  lastCorrectDate: string | null;

  @Column({ type: 'jsonb', nullable: true })
  lastWrongAnswer: Record<string, unknown> | null;

  @Column({ type: 'timestamptz' })
  firstWrongAt: Date;

  @Column({ type: 'timestamptz' })
  lastWrongAt: Date;

  @Column({ type: 'varchar', length: 20, default: WrongQuestionStatus.ACTIVE })
  status: WrongQuestionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  masteredAt: Date | null;

  @Column({ type: 'text', nullable: true })
  aiAnalysis: string | null;

  @Column({ type: 'int', nullable: true })
  aiAnalysisVersion: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
