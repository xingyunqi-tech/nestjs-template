import { NullableType } from '../../../../common/types/nullable.type';
import { GamePlatform, GamePlayer } from '../../domain/game-player';

export abstract class GamePlayerRepository {
  /** 按平台与 openId 写入玩家，已存在时更新刷新哈希与登录时间 */
  abstract upsertLogin(data: {
    platform: GamePlatform;
    openId: string;
    unionId: string | null;
    refreshHash: string;
  }): Promise<GamePlayer>;

  abstract findById(id: GamePlayer['id']): Promise<NullableType<GamePlayer>>;

  /** 仅当当前哈希仍为 from 时替换为 to */
  abstract rotateRefreshHash(id: GamePlayer['id'], from: string, to: string): Promise<boolean>;
}
