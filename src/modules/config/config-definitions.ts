export type ConfigValueType = 'boolean' | 'number' | 'string' | 'json';

export interface ConfigDefinition {
  key: string;
  type: ConfigValueType;
  /** undefined 表示无默认值 */
  defaultValue?: unknown;
  isPublic: boolean;
  description: string;
}

/** 远程配置项登记表，配置值统一存为 `{ value: <配置值> }` */
export const CONFIG_DEFINITIONS = [
  { key: 'ai.enabled', type: 'boolean', defaultValue: true, isPublic: true, description: 'AI 功能总开关' },
  { key: 'ai.dailyBudget', type: 'number', isPublic: false, description: '全站每日成本上限（元），超过即熔断' },
  { key: 'ai.quota.chat', type: 'number', defaultValue: 20, isPublic: true, description: '用户每日讲题/对话次数' },
  { key: 'ai.quota.grading', type: 'number', defaultValue: 3, isPublic: true, description: '用户每日批改次数' },
  {
    key: 'ai.ratePerMinute',
    type: 'number',
    defaultValue: 10,
    isPublic: false,
    description: '每用户每分钟 AI 请求上限',
  },
  {
    key: 'ai.paperGradingLimit',
    type: 'number',
    defaultValue: 5,
    isPublic: false,
    description: '每份试卷自动批改主观题上限',
  },
  { key: 'ai.model', type: 'string', isPublic: false, description: '当前使用的模型标识' },
  {
    key: 'wrongBook.masterThreshold',
    type: 'number',
    defaultValue: 3,
    isPublic: true,
    description: '错题连续答对阈值',
  },
  {
    key: 'practice.offlineSyncWindowMin',
    type: 'number',
    defaultValue: 5,
    isPublic: false,
    description: '模考离线补交窗口（分钟）',
  },
  { key: 'practice.dailySetSize', type: 'number', defaultValue: 10, isPublic: false, description: '每日一练题量' },
  { key: 'practice.trialSize', type: 'number', defaultValue: 3, isPublic: true, description: '游客试做题数' },
  {
    key: 'paper.generateDailyLimit',
    type: 'number',
    defaultValue: 5,
    isPublic: true,
    description: '每用户每日按规则生成试卷次数',
  },
  { key: 'consent.privacyPolicyVersion', type: 'string', isPublic: true, description: '隐私政策当前版本' },
  { key: 'consent.userAgreementVersion', type: 'string', isPublic: true, description: '用户协议当前版本' },
  { key: 'consent.aiServiceVersion', type: 'string', isPublic: true, description: 'AI 服务声明当前版本' },
  { key: 'alert.thresholds', type: 'json', isPublic: false, description: '各监控项告警阈值' },
] as const satisfies readonly ConfigDefinition[];

export type ConfigKey = (typeof CONFIG_DEFINITIONS)[number]['key'];

export function findConfigDefinition(key: string): ConfigDefinition | undefined {
  return (CONFIG_DEFINITIONS as readonly ConfigDefinition[]).find((definition) => definition.key === key);
}
