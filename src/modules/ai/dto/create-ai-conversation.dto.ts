import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AiContextType } from '../domain/ai-conversation';

export class CreateAiConversationDto {
  @ApiProperty({ enum: [AiContextType.QUESTION], enumName: 'AiContextType', description: '当前只支持 QUESTION' })
  @IsIn([AiContextType.QUESTION])
  contextType: AiContextType;

  @ApiProperty({ type: String, format: 'uuid', description: '题目 id' })
  @IsUUID()
  contextId: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '从练习会话发起时携带，题目须属于该会话' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
