import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class BatchPublishQuestionsDto {
  @ApiProperty({ type: String, format: 'uuid', isArray: true, description: '小题按所属材料整组发布' })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((item: unknown) => (typeof item === 'string' ? item.toLowerCase() : item)) : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}

export class BatchPublishQuestionsResultDto {
  @ApiProperty({ type: Number, description: '变为已发布的题目数，含小题' })
  count: number;
}
