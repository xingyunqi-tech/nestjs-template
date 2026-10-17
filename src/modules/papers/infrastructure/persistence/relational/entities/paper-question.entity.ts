import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { QuestionEntity } from '../../../../../questions/infrastructure/persistence/relational/entities/question.entity';
import { PaperEntity } from './paper.entity';

@Entity({ name: 'paper_question' })
export class PaperQuestionEntity extends EntityRelationalHelper {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_paper_question' })
  paperId: string;

  @Index('IDX_paper_question_questionId')
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_paper_question' })
  questionId: string;

  @ManyToOne(() => PaperEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paperId', foreignKeyConstraintName: 'FK_paper_question_paper' })
  paper?: PaperEntity;

  @ManyToOne(() => QuestionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'questionId', foreignKeyConstraintName: 'FK_paper_question_question' })
  question?: QuestionEntity;

  @Column({ type: 'smallint' })
  sectionIndex: number;

  @Column({ type: 'int' })
  questionVersion: number;

  @Column({ type: 'int' })
  sort: number;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  score: string;

  @CreateDateColumn()
  createdAt: Date;
}
