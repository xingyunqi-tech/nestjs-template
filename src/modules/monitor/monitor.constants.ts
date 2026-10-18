import { MAIL_QUEUE } from '../../infrastructure/queue/mail-queue/mail-queue.constants';
import { NOTIFICATION_QUEUE } from '../../infrastructure/queue/notification-queue/notification-queue.constants';
import { IMPORT_QUEUE } from '../../infrastructure/queue/import-queue/import-queue.constants';
import { MOCK_SUBMIT_QUEUE } from '../../infrastructure/queue/mock-submit-queue/mock-submit-queue.constants';
import { STUDY_STATS_QUEUE } from '../../infrastructure/queue/study-stats-queue/study-stats-queue.constants';

export const MONITORED_QUEUES: readonly string[] = [
  MAIL_QUEUE,
  NOTIFICATION_QUEUE,
  IMPORT_QUEUE,
  MOCK_SUBMIT_QUEUE,
  STUDY_STATS_QUEUE,
];

/** 接收告警站内通知的管理员数量上限 */
export const ALERT_RECIPIENT_LIMIT = 50;
