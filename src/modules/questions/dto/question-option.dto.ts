import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class QuestionOptionDto {
  @ApiProperty({ type: String, example: 'A' })
  @IsString()
  @Matches(/^[A-Z]$/)
  key: string;

  @ApiProperty({ type: String, example: '选项内容' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}
