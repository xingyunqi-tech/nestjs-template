import { NullableType } from '../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../common/types/pagination-options';
import { AdminAlert } from '../../domain/admin-alert';
import { QueryAdminAlertDto } from '../../dto/query-admin-alert.dto';

export type CreateAdminAlertData = Pick<AdminAlert, 'type' | 'level' | 'message' | 'payload' | 'dedupKey'>;

export abstract class AdminAlertRepository {
  /** 已有同一 dedupKey 的未确认告警时返回 null */
  abstract createIfNoOpen(data: CreateAdminAlertData): Promise<NullableType<AdminAlert>>;

  abstract findById(id: AdminAlert['id']): Promise<NullableType<AdminAlert>>;

  abstract findManyWithPaginationAndCount(options: {
    filterOptions?: Pick<QueryAdminAlertDto, 'acknowledged' | 'level' | 'type'> | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: AdminAlert[]; total: number }>;

  /** 告警不存在时返回 null */
  abstract acknowledge(id: AdminAlert['id']): Promise<NullableType<AdminAlert>>;
}
