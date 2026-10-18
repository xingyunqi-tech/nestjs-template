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
import { ErrataStatus } from '../../../../domain/errata';

@Entity({ name: 'errata' })
@Index('UQ_errata_questionId_active', ['questionId'], {
  unique: true,
  where: `"status" IN ('PENDING', 'RUNNING')`,
})
export class ErrataEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_errata' })
  id: string;

  @Index('IDX_errata_questionId')
  @Column({ type: 'uuid' })
  questionId: string;

  @ManyToOne(() => QuestionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'questionId', foreignKeyConstraintName: 'FK_errata_question' })
  question?: QuestionEntity;

  @Column({ type: 'int' })
  fromVersion: number;

  @Column({ type: 'int' })
  toVersion: number;

  @Column({ type: 'boolean' })
  answerChanged: boolean;

  @Index('IDX_errata_status')
  @Column({ type: 'varchar', length: 10, default: ErrataStatus.PENDING })
  status: ErrataStatus;

  @Column({ type: 'int', default: 0 })
  affectedUsers: number;

  @Column({ type: 'int', default: 0 })
  processedUsers: number;

  @Column({ type: 'text' })
  reply: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  failureReason: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdBy', foreignKeyConstraintName: 'FK_errata_user' })
  creator?: UserEntity | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Index('IDX_errata_createdAt')
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
