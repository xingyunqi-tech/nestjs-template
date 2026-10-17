import { MonitorController } from './monitor.controller';
import { PERMISSIONS_KEY } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';

describe('MonitorController', () => {
  it('should require the system metrics permission on every route', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MonitorController)).toEqual([Permission.SYSTEM_METRICS]);
  });
});
