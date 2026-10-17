import { ConflictException } from '@nestjs/common';
import { isForeignKeyViolation } from '../../common/utils/exceptions.util';

export async function conflictOnForeignKeyViolation<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ConflictException({ error: 'conflict' });
    }
    throw error;
  }
}
