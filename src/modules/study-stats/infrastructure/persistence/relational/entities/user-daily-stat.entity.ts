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

@Entity({ name: 'user_daily_stat' })
@Index('UQ_user_daily_stat_userId_date_subjectId', ['userId', 'date', 'subjectId'], { unique: true })
export class UserDailyStatEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_user_daily_stat' })
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_user_daily_stat_user' })
  user?: UserEntity;

  @Column({ type: 'date' })
  date: string;

  @Index('IDX_user_daily_stat_subjectId')
  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_user_daily_stat_subject' })
  subject?: SubjectEntity;

  @Column({ type: 'int', default: 0 })
  answered: number;

  @Column({ type: 'int', default: 0 })
  correct: number;

  @Column({ type: 'int', default: 0 })
  durationSec: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
