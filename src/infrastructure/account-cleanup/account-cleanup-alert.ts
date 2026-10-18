import { Logger } from '@nestjs/common';
import { AlertLevel, AlertReporter } from '../alerting/alert-reporter';

export const ACCOUNT_CLEANUP_FAILED_ALERT = 'accountCleanupFailed';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function raiseAccountCleanupFailure(
  alertReporter: AlertReporter | undefined,
  logger: Logger,
  userId: number,
  error: unknown,
  failedCleaners?: string[],
): Promise<void> {
  const reason = messageOf(error);
  logger.error(`Account cleanup for user ${userId} failed: ${reason}`);
  try {
    await alertReporter?.raise(
      ACCOUNT_CLEANUP_FAILED_ALERT,
      AlertLevel.WARN,
      `用户 ${userId} 的注销数据清理失败：${reason}`,
      { userId, reason, ...(failedCleaners && { failedCleaners }) },
      `${ACCOUNT_CLEANUP_FAILED_ALERT}:${userId}`,
    );
  } catch (alertError) {
    logger.error(`Failed to raise alert for account cleanup of user ${userId}: ${messageOf(alertError)}`);
  }
}
