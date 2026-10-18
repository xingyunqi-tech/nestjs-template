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
import { KnowledgePointEntity } from '../../../../../exams/infrastructure/persistence/relational/entities/knowledge-point.entity';

@Entity({ name: 'user_knowledge_stat' })
@Index('UQ_user_knowledge_stat_userId_knowledgePointId', ['userId', 'knowledgePointId'], { unique: true })
export class UserKnowledgeStatEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_user_knowledge_stat' })
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_user_knowledge_stat_user' })
  user?: UserEntity;

  @Index('IDX_user_knowledge_stat_knowledgePointId')
  @Column({ type: 'uuid' })
  knowledgePointId: string;

  @ManyToOne(() => KnowledgePointEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledgePointId', foreignKeyConstraintName: 'FK_user_knowledge_stat_knowledge_point' })
  knowledgePoint?: KnowledgePointEntity;

  @Column({ type: 'int', default: 0 })
  answered: number;

  @Column({ type: 'int', default: 0 })
  correct: number;

  @Column({ type: 'smallint', array: true, default: () => "'{}'" })
  recentResults: number[];

  @Column({ type: 'timestamptz', nullable: true })
  lastAnsweredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
