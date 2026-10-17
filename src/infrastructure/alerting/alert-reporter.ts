import { AlertLevel } from '../../common/enums/alert-level.enum';

export { AlertLevel };

/** 运营告警上报端口，由监控模块提供实现 */
export abstract class AlertReporter {
  abstract raise(
    type: string,
    level: AlertLevel,
    message: string,
    payload?: Record<string, unknown> | null,
    dedupKey?: string,
  ): Promise<unknown>;
}
