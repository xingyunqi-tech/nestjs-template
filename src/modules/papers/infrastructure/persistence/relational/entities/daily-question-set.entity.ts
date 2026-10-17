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

@Entity({ name: 'daily_question_set' })
@Index('UQ_daily_question_set_subjectId_date', ['subjectId', 'date'], { unique: true })
export class DailyQuestionSetEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_daily_question_set' })
  id: string;

  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_daily_question_set_subject' })
  subject?: SubjectEntity;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'uuid', array: true })
  questionIds: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
