/** 统计事件入队：答完即判与自评按记录，模考交卷按会话，每日一练主观题作答按用户与日期判定打卡 */
export abstract class StatsEventPublisher {
  abstract publishRecord(recordId: string): Promise<void>;

  abstract publishSession(sessionId: string): Promise<void>;

  abstract publishCheckIn(userId: number, date: string): Promise<void>;
}
