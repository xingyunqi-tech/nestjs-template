import { AdminAlert, AlertLevel } from '../../../../domain/admin-alert';
import { AdminAlertEntity } from '../entities/admin-alert.entity';

export class AdminAlertMapper {
  static toDomain(raw: AdminAlertEntity): AdminAlert {
    const domain = new AdminAlert();
    domain.id = raw.id;
    domain.type = raw.type;
    domain.level = raw.level as AlertLevel;
    domain.message = raw.message;
    domain.payload = raw.payload;
    domain.dedupKey = raw.dedupKey;
    domain.acknowledgedAt = raw.acknowledgedAt;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: Partial<AdminAlert>): AdminAlertEntity {
    const entity = new AdminAlertEntity();
    if (domain.id !== undefined) {
      entity.id = domain.id;
    }
    entity.type = domain.type as string;
    entity.level = domain.level as string;
    entity.message = domain.message as string;
    entity.payload = domain.payload ?? null;
    entity.dedupKey = domain.dedupKey as string;
    entity.acknowledgedAt = domain.acknowledgedAt ?? null;
    return entity;
  }
}
