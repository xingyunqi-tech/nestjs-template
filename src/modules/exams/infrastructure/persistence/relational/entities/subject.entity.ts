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
import { ContentStatus } from '../../../../domain/content-status';
import { ExamEntity } from './exam.entity';

@Entity({ name: 'subject' })
export class SubjectEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_subject_examId')
  @Column({ type: 'uuid' })
  examId: string;

  @ManyToOne(() => ExamEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'examId', foreignKeyConstraintName: 'FK_subject_exam' })
  exam?: ExamEntity;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'varchar', length: 20, default: ContentStatus.DRAFT })
  status: ContentStatus;

  @Column({ type: 'boolean', default: false })
  hasSubjective: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
