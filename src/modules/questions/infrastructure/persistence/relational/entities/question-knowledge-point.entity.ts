import { CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { KnowledgePointEntity } from '../../../../../exams/infrastructure/persistence/relational/entities/knowledge-point.entity';
import { QuestionEntity } from './question.entity';

@Entity({ name: 'question_knowledge_point' })
export class QuestionKnowledgePointEntity extends EntityRelationalHelper {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_question_knowledge_point' })
  questionId: string;

  @Index('IDX_question_knowledge_point_knowledgePointId')
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_question_knowledge_point' })
  knowledgePointId: string;

  @ManyToOne(() => QuestionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'questionId', foreignKeyConstraintName: 'FK_question_knowledge_point_question' })
  question?: QuestionEntity;

  @ManyToOne(() => KnowledgePointEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'knowledgePointId', foreignKeyConstraintName: 'FK_question_knowledge_point_knowledge_point' })
  knowledgePoint?: KnowledgePointEntity;

  @CreateDateColumn()
  createdAt: Date;
}
