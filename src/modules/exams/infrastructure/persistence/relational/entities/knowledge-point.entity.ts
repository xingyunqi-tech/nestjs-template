import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { SubjectEntity } from './subject.entity';

@Entity({ name: 'knowledge_point' })
export class KnowledgePointEntity extends EntityRelationalHelper {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_knowledge_point' })
  id: string;

  @Index('IDX_knowledge_point_subjectId')
  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => SubjectEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectId', foreignKeyConstraintName: 'FK_knowledge_point_subject' })
  subject?: SubjectEntity;

  @Index('IDX_knowledge_point_parentId')
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => KnowledgePointEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parentId', foreignKeyConstraintName: 'FK_knowledge_point_parent' })
  parent?: KnowledgePointEntity | null;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'smallint' })
  level: number;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'varchar', length: 120 })
  path: string;

  @Column({ type: 'boolean', default: true })
  isLeaf: boolean;

  @Column({ type: 'int', default: 0 })
  questionCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
