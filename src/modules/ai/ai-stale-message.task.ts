import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { AiMessageRepository, StaleAiMessage } from './infrastructure/persistence/ai-message.repository';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiQuotaService } from './ai-quota.service';
import { AiGenerationService } from './ai-generation.service';
import { AiMessageStatus } from './domain/ai-message';
import { AiStreamEventName } from './domain/ai-stream-event';

const TASK_NAME = 'ai-stale-message';
const LOCK_TTL_MS = 50_000;
const BATCH_SIZE = 100;
const MAX_BATCHES = 20;

export const AI_STALE_STREAMING_MS = 5 * 60_000;

/** STREAMING 超过 5 分钟的回答置为 FAILED，并退还扣减日期的额度 */
@Injectable()
export class AiStaleMessageTask {
  private readonly logger = new Logger(AiStaleMessageTask.name);

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly messageRepository: AiMessageRepository,
    private readonly streamService: AiMessageStreamService,
    private readonly quotaService: AiQuotaService,
    private readonly generationService: AiGenerationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: TASK_NAME })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, () =>
        this.failStaleMessages(new Date()),
      );
      if (run.executed && run.result > 0) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} stale AI messages failed`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** 返回本次置为 FAILED 的消息数 */
  async failStaleMessages(now: Date): Promise<number> {
    const createdBefore = new Date(now.getTime() - AI_STALE_STREAMING_MS);
    let failed = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const messages = await this.messageRepository.findStaleStreaming(createdBefore, BATCH_SIZE);
      let errors = 0;
      for (const message of messages) {
        try {
          if (await this.fail(message)) {
            failed += 1;
          }
        } catch (error) {
          errors += 1;
          this.logger.error(`Fail stale message ${message.id} failed: ${this.messageOf(error)}`);
        }
      }
      if (messages.length < BATCH_SIZE || errors === messages.length) {
        break;
      }
    }
    return failed;
  }

  /** 仅当本任务把消息置为 FAILED 时退还额度，消息已被其他收尾结束时不处理 */
  private async fail(message: StaleAiMessage): Promise<boolean> {
    const snapshot = await this.streamService.snapshot(message.id).catch(() => null);
    const finished = await this.messageRepository.finish(message.id, {
      content: snapshot?.content ?? '',
      reasoning: snapshot?.reasoning ?? null,
      suggestions: null,
      status: AiMessageStatus.FAILED,
      usage: null,
    });
    if (!finished) {
      return false;
    }
    if (message.quotaDate) {
      await this.quotaService
        .refund(message.userId, 'chat', message.quotaDate)
        .catch((error: unknown) => this.logger.error(`Refund quota of ${message.id} failed: ${this.messageOf(error)}`));
    }
    await this.streamService
      .append(message.id, AiStreamEventName.ERROR, { code: 'aiGenerationFailed' })
      .catch((error: unknown) => this.logger.warn(`Append error to ${message.id} failed: ${this.messageOf(error)}`));
    await this.generationService
      .requestStop(message.id)
      .catch((error: unknown) => this.logger.warn(`Stop ${message.id} failed: ${this.messageOf(error)}`));
    return true;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
