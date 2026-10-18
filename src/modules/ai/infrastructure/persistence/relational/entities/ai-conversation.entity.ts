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
import { AiContextType } from '../../../../domain/ai-conversation';

@Entity({ name: 'ai_conversation' })
@Index('IDX_ai_conversation_userId_updatedAt', ['userId', 'updatedAt'])
@Index('UQ_ai_conversation_user_context', ['userId', 'contextType', 'contextId', 'contextVersion'], {
  unique: true,
  where: '"contextId" IS NOT NULL',
})
export class AiConversationEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ai_conversation' })
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_ai_conversation_user' })
  user?: UserEntity;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 20 })
  contextType: AiContextType;

  @Column({ type: 'varchar', length: 64, nullable: true })
  contextId: string | null;

  @Column({ type: 'int', nullable: true })
  contextVersion: number | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'uuid', nullable: true })
  summaryUpToMessageId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
