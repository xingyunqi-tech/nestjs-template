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
import { AiConversationEntity } from './ai-conversation.entity';
import { AiMessageFeedback, AiMessageRole, AiMessageStatus, AiMessageUsage } from '../../../../domain/ai-message';

@Entity({ name: 'ai_message' })
@Index('IDX_ai_message_conversationId_createdAt', ['conversationId', 'createdAt'])
@Index('IDX_ai_message_streaming_createdAt', ['createdAt'], { where: `"status" = 'STREAMING'` })
export class AiMessageEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ai_message' })
  id: string;

  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => AiConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId', foreignKeyConstraintName: 'FK_ai_message_conversation' })
  conversation?: AiConversationEntity;

  @Column({ type: 'varchar', length: 20 })
  role: AiMessageRole;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'text', nullable: true })
  reasoning: string | null;

  @Column({ type: 'jsonb', nullable: true })
  suggestions: string[] | null;

  @Column({ type: 'varchar', length: 20 })
  status: AiMessageStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  feedback: AiMessageFeedback | null;

  @Column({ type: 'jsonb', nullable: true })
  usage: AiMessageUsage | null;

  @Column({ type: 'date', nullable: true })
  quotaDate: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
