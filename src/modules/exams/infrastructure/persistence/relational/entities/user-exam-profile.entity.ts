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
import { ExamEntity } from './exam.entity';

@Entity({ name: 'user_exam_profile' })
@Index('UQ_user_exam_profile_userId_examId', ['userId', 'examId'], { unique: true })
@Index('UQ_user_exam_profile_userId_current', ['userId'], { unique: true, where: '"isCurrent"' })
export class UserExamProfileEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_user_exam_profile_user' })
  user?: UserEntity;

  @Index('IDX_user_exam_profile_examId')
  @Column({ type: 'uuid' })
  examId: string;

  @ManyToOne(() => ExamEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'examId', foreignKeyConstraintName: 'FK_user_exam_profile_exam' })
  exam?: ExamEntity;

  @Column({ type: 'boolean', default: false })
  isCurrent: boolean;

  @Column({ type: 'date', nullable: true })
  examDate: string | null;

  @Column({ type: 'int', default: 30 })
  dailyGoal: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
