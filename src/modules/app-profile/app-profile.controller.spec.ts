import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AppProfileController } from './app-profile.controller';

describe('AppProfileController', () => {
  it('should expose the profile without authentication', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AppProfileController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, AppProfileController.prototype.get)).toBeUndefined();
  });
});
