import { ApiProperty } from '@nestjs/swagger';
import { isUUID } from 'class-validator';

export enum FavoriteTargetType {
  PRODUCT = 'product',
  ARTICLE = 'article',
  STORE = 'store',
  QUESTION = 'question',
  PAPER = 'paper',
}

const UUID_TARGET_TYPES: ReadonlySet<FavoriteTargetType> = new Set([
  FavoriteTargetType.QUESTION,
  FavoriteTargetType.PAPER,
]);

/** 题目与试卷的 UUID 转为小写 */
export function normalizeTargetId(targetType: FavoriteTargetType, targetId: string): string {
  return UUID_TARGET_TYPES.has(targetType) && isUUID(targetId) ? targetId.toLowerCase() : targetId;
}

export class Favorite {
  @ApiProperty({ type: Number })
  id: number;

  @ApiProperty({ type: Number, description: 'User ID who owns this favorite' })
  userId: number;

  @ApiProperty({ enum: FavoriteTargetType, description: 'Type of the favorited item' })
  targetType: FavoriteTargetType;

  @ApiProperty({ type: String, description: 'ID of the favorited item' })
  targetId: string;

  @ApiProperty({ type: String, description: 'Title/name of the favorited item', required: false })
  title?: string;

  @ApiProperty({ type: String, description: 'Image URL of the favorited item', required: false })
  image?: string;

  @ApiProperty({ type: String, description: 'Additional data in JSON format', required: false })
  extra?: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '题目、试卷所属科目' })
  subjectId: string | null;

  @ApiProperty()
  createdAt: Date;
}
