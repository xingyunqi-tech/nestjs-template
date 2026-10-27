/** 订阅消息模板：模板 ID 与「业务字段 → 模板字段 key」映射 */
export type WechatSubscribeTemplate = {
  templateId: string;
  fields: Record<string, string>;
};

export type WechatMiniProgramState = 'developer' | 'trial' | 'formal';

export type WechatConfig = {
  // 微信小程序
  miniAppId: string;
  miniAppSecret: string;
  // 微信小游戏
  miniGameAppId: string;
  miniGameAppSecret: string;
  // 订阅消息跳转的小程序版本
  miniProgramState: WechatMiniProgramState;
  // 订阅消息模板，按场景配置
  subscribeTemplates: {
    orderPaid: WechatSubscribeTemplate;
  };
  // 微信开放平台（APP登录）
  appId: string;
  appSecret: string;
  // 微信支付配置
  pay: {
    mchId: string; // 商户号
    apiV3Key: string; // API v3 密钥
    serialNo: string; // 证书序列号
    privateKey: string; // 商户私钥
    notifyUrl: string; // 支付回调地址
    publicKeyId: string; // 微信支付公钥 ID（公钥模式，与平台证书二选一）
    publicKey: string; // 微信支付公钥
  };
};
