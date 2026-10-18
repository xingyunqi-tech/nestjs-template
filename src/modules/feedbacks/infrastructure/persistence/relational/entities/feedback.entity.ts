import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
import { QuestionEntity } from '../../../../../questions/infrastructure/persistence/relational/entities/question.entity';
import { ErrataEntity } from '../../../../../errata/infrastructure/persistence/relational/entities/errata.entity';
import { FeedbackType, FeedbackStatus, QuestionReportReason } from '../../../../domain/feedback';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';

@Entity({ name: 'feedback' })
export class FeedbackEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  @Index('IDX_feedback_userId')
  userId: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_feedback_user' })
  user?: UserEntity | null;

  @Column({ type: 'varchar', length: 20 })
  @Index('IDX_feedback_type')
  type: FeedbackType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  images?: string[] | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contact?: string | null;

  @Column({ type: 'varchar', length: 20, default: FeedbackStatus.PENDING })
  @Index('IDX_feedback_status')
  status: FeedbackStatus;

  @Column({ type: 'text', nullable: true })
  reply?: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_feedback_questionId')
  questionId: string | null;

  @ManyToOne(() => QuestionEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'questionId', foreignKeyConstraintName: 'FK_feedback_question' })
  question?: QuestionEntity | null;

  @Column({ type: 'int', nullable: true })
  questionVersion: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  reason: QuestionReportReason | null;

  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_feedback_errataId')
  errataId: string | null;

  @ManyToOne(() => ErrataEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'errataId', foreignKeyConstraintName: 'FK_feedback_errata' })
  errata?: ErrataEntity | null;

  @Column({ type: 'uuid', nullable: true })
  messageId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
