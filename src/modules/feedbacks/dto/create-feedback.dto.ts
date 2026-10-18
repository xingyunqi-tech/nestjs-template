import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';
import { FeedbackType, GENERAL_FEEDBACK_TYPES } from '../domain/feedback';

export class CreateFeedbackDto {
  @ApiProperty({
    enum: GENERAL_FEEDBACK_TYPES,
    example: FeedbackType.SUGGESTION,
    description: 'Type of feedback',
  })
  @IsIn(GENERAL_FEEDBACK_TYPES)
  @IsNotEmpty()
  type: FeedbackType;

  @ApiProperty({
    type: String,
    example: 'I found a bug in the checkout process',
    description: 'Feedback content',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://example.com/image1.jpg'],
    description: 'Screenshot URLs (max 5)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @ArrayMaxSize(5)
  images?: string[];

  @ApiPropertyOptional({
    type: String,
    example: '13800138000',
    description: 'Contact information for follow-up',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact?: string;
}
