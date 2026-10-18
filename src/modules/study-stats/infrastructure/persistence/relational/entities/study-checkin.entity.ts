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
import { CheckinReason } from '../../../../domain/study-checkin';

@Entity({ name: 'study_checkin' })
@Index('UQ_study_checkin_userId_date', ['userId', 'date'], { unique: true })
export class StudyCheckinEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_study_checkin' })
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_study_checkin_user' })
  user?: UserEntity;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 20 })
  reason: CheckinReason;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
