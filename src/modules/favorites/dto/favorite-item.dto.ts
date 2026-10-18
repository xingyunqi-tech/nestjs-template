import { ApiProperty } from '@nestjs/swagger';
import { Favorite } from '../domain/favorite';

export class FavoriteItemDto extends Favorite {
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: '题目或所属材料、试卷已不是发布状态；其他类型为 null',
  })
  targetOffline: boolean | null;
}
