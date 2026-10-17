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
import { QuestionType } from '../../../../domain/question-type';
import { QuestionAnswer, QuestionOption } from '../../../../domain/question-answer';
import { QuestionChangeType } from '../../../../domain/question-version';
import { QuestionEntity } from './question.entity';

@Entity({ name: 'question_version' })
@Index('UQ_question_version_questionId_version', ['questionId', 'version'], { unique: true })
export class QuestionVersionEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_question_version' })
  id: string;

  @Column({ type: 'uuid' })
  questionId: string;

  @ManyToOne(() => QuestionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'questionId', foreignKeyConstraintName: 'FK_question_version_question' })
  question?: QuestionEntity;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 20 })
  type: QuestionType;

  @Column({ type: 'text' })
  stem: string;

  @Column({ type: 'jsonb', nullable: true })
  options: QuestionOption[] | null;

  @Column({ type: 'jsonb', nullable: true })
  answer: QuestionAnswer | null;

  @Column({ type: 'text', nullable: true })
  analysis: string | null;

  @Column({ type: 'text', nullable: true })
  material: string | null;

  @Column({ type: 'uuid', nullable: true })
  audioFileId: string | null;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  knowledgePointIds: string[];

  @Column({ type: 'int', nullable: true })
  materialVersion: number | null;

  @Column({ type: 'varchar', length: 10 })
  changeType: QuestionChangeType;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
