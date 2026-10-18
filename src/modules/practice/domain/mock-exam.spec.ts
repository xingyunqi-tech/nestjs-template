import { SubmitType } from './practice-session';
import {
  acceptsMockOverwrite,
  canTakeOver,
  checkMockWrite,
  mockDurationSec,
  mockSubmitType,
  mockTiming,
} from './mock-exam';

const at = (minutes: number): Date => new Date(Date.UTC(2026, 9, 1, 0, minutes));

describe('mock exam rules', () => {
  const session = { deadlineAt: at(60), autoSubmitAt: at(65), activeDeviceId: 'd1', startedAt: at(0) };

  it('should derive the deadline and the auto submit time', () => {
    expect(mockTiming(at(0), 60, 5)).toEqual({ deadlineAt: at(60), autoSubmitAt: at(65) });
  });

  it('should accept writes of the active device before the deadline', () => {
    expect(checkMockWrite(session, 'd1', false, at(59))).toEqual({ phase: 'normal' });
    expect(checkMockWrite(session, 'd2', false, at(59))).toEqual({ rejection: 'sessionTakenOver' });
  });

  it('should accept only offline sync between the deadline and the auto submit time', () => {
    expect(checkMockWrite(session, 'd1', true, at(60))).toEqual({ phase: 'offlineSync' });
    expect(checkMockWrite(session, 'd1', false, at(61))).toEqual({ rejection: 'sessionClosed' });
    expect(checkMockWrite(session, 'd2', true, at(61))).toEqual({ rejection: 'sessionTakenOver' });
    expect(checkMockWrite(session, 'd1', true, at(65))).toEqual({ rejection: 'sessionClosed' });
  });

  it('should compare client sequences only within the same device', () => {
    expect(acceptsMockOverwrite(undefined, 'd1', 0)).toBe(true);
    expect(acceptsMockOverwrite({ deviceId: 'd1', clientSeq: 5 }, 'd1', 5)).toBe(false);
    expect(acceptsMockOverwrite({ deviceId: 'd1', clientSeq: 5 }, 'd1', 6)).toBe(true);
    expect(acceptsMockOverwrite({ deviceId: 'd1', clientSeq: 5 }, 'd2', 1)).toBe(true);
  });

  it('should allow taking over only before the deadline', () => {
    expect(canTakeOver(session, at(59))).toBe(true);
    expect(canTakeOver(session, at(60))).toBe(false);
  });

  it('should record manual submissions after the auto submit time as timeouts', () => {
    expect(mockSubmitType(session, true, at(64))).toBe(SubmitType.MANUAL);
    expect(mockSubmitType(session, true, at(65))).toBe(SubmitType.AUTO_TIMEOUT);
    expect(mockSubmitType(session, false, at(30))).toBe(SubmitType.AUTO_TIMEOUT);
  });

  it('should cap the duration at the deadline', () => {
    expect(mockDurationSec(session, at(30))).toBe(1800);
    expect(mockDurationSec(session, at(64))).toBe(3600);
  });
});
