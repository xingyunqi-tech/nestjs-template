import { PracticeSession, SubmitType } from './practice-session';
import { AnswerRecord } from './answer-record';

export const DEFAULT_OFFLINE_SYNC_WINDOW_MIN = 5;

const MINUTE_MS = 60_000;

export type MockTimingSession = Pick<PracticeSession, 'startedAt' | 'deadlineAt' | 'autoSubmitAt'>;

export function mockTiming(
  startedAt: Date,
  durationMin: number,
  offlineSyncWindowMin: number,
): { deadlineAt: Date; autoSubmitAt: Date } {
  const deadlineAt = new Date(startedAt.getTime() + durationMin * MINUTE_MS);
  return { deadlineAt, autoSubmitAt: new Date(deadlineAt.getTime() + offlineSyncWindowMin * MINUTE_MS) };
}

export type MockWriteRejection = 'sessionClosed' | 'sessionTakenOver';

/** 截止前正常写入；截止到自动交卷之间只接受当前设备的离线补交；之后拒绝 */
export function checkMockWrite(
  session: Pick<PracticeSession, 'deadlineAt' | 'autoSubmitAt' | 'activeDeviceId'>,
  deviceId: string,
  offline: boolean,
  now: Date,
): { phase: 'normal' | 'offlineSync' } | { rejection: MockWriteRejection } {
  if (!session.deadlineAt || !session.autoSubmitAt || now >= session.autoSubmitAt) {
    return { rejection: 'sessionClosed' };
  }
  if (session.activeDeviceId !== deviceId) {
    return { rejection: 'sessionTakenOver' };
  }
  if (now < session.deadlineAt) {
    return { phase: 'normal' };
  }
  return offline ? { phase: 'offlineSync' } : { rejection: 'sessionClosed' };
}

/** 同一设备只接受更大的 clientSeq；记录属于其他设备时直接覆盖 */
export function acceptsMockOverwrite(
  record: Pick<AnswerRecord, 'deviceId' | 'clientSeq'> | undefined,
  deviceId: string,
  clientSeq: number,
): boolean {
  return record?.deviceId !== deviceId || clientSeq > record.clientSeq;
}

export function canTakeOver(session: Pick<PracticeSession, 'deadlineAt'>, now: Date): boolean {
  return session.deadlineAt !== null && now < session.deadlineAt;
}

export function mockSubmitType(session: Pick<PracticeSession, 'autoSubmitAt'>, manual: boolean, now: Date): SubmitType {
  return manual && session.autoSubmitAt !== null && now < session.autoSubmitAt
    ? SubmitType.MANUAL
    : SubmitType.AUTO_TIMEOUT;
}

export function mockDurationSec(session: MockTimingSession, submittedAt: Date): number {
  const end = session.deadlineAt && session.deadlineAt < submittedAt ? session.deadlineAt : submittedAt;
  return Math.max(0, Math.floor((end.getTime() - session.startedAt.getTime()) / 1000));
}
