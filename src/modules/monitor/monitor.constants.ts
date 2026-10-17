import { MAIL_QUEUE } from '../../infrastructure/queue/mail-queue/mail-queue.constants';
import { NOTIFICATION_QUEUE } from '../../infrastructure/queue/notification-queue/notification-queue.constants';

export const MONITORED_QUEUES: readonly string[] = [MAIL_QUEUE, NOTIFICATION_QUEUE];

/** 接收告警站内通知的管理员数量上限 */
export const ALERT_RECIPIENT_LIMIT = 50;
