/**
 * Audit action types
 */
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  SUBMIT = 'SUBMIT',
  PUBLISH = 'PUBLISH',
  OFFLINE = 'OFFLINE',
  REJECT = 'REJECT',
  COPY = 'COPY',
  MOVE = 'MOVE',
}

/**
 * AuditLog domain model representing an audit trail entry
 */
export class AuditLog {
  id: number;

  /**
   * ID of the user who performed the action (null for anonymous actions)
   */
  userId: string | number | null;

  /**
   * The type of action performed
   */
  action: AuditAction;

  /**
   * The type of entity that was affected (e.g., 'User', 'Address')
   */
  entityType: string;

  /**
   * The ID of the entity that was affected
   */
  entityId: string | number;

  /**
   * The previous state of the entity (for UPDATE and DELETE actions)
   */
  oldValue: Record<string, unknown> | null;

  /**
   * The new state of the entity (for CREATE and UPDATE actions)
   */
  newValue: Record<string, unknown> | null;

  /**
   * IP address of the client that performed the action
   */
  ipAddress: string | null;

  /**
   * User agent string of the client
   */
  userAgent: string | null;

  /**
   * Request ID for tracing
   */
  requestId: string | null;

  /**
   * When the action was performed
   */
  createdAt: Date;
}
