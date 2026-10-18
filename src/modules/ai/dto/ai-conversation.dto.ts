import { ApiProperty } from '@nestjs/swagger';
import { AiContextType } from '../domain/ai-conversation';

export class AiConversationDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, description: '首轮问题截断，尚未提问时为题干截断' })
  title: string;

  @ApiProperty({ enum: AiContextType, enumName: 'AiContextType' })
  contextType: AiContextType;

  @ApiProperty({ type: String, nullable: true, description: 'QUESTION 为题目 id' })
  contextId: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'QUESTION 为题目版本' })
  contextVersion: number | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
