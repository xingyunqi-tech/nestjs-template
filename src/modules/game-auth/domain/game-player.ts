export enum GamePlatform {
  WECHAT = 'wechat',
}

export class GamePlayer {
  id: number;

  platform: GamePlatform;

  openId: string;

  unionId: string | null;

  /** 当前有效刷新令牌对应的哈希，新登录会使旧刷新令牌失效 */
  refreshHash: string;

  lastLoginAt: Date;

  createdAt: Date;
}
