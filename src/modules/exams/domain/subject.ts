import { ApiProperty } from '@nestjs/swagger';
import { ContentStatus } from './content-status';

export class Subject {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  examId: string;

  @ApiProperty({ type: String, example: '行测' })
  name: string;

  @ApiProperty({ type: Number, example: 0 })
  sort: number;

  @ApiProperty({ enum: ContentStatus, enumName: 'ContentStatus' })
  status: ContentStatus;

  @ApiProperty({ type: Boolean, description: '是否包含主观题' })
  hasSubjective: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
