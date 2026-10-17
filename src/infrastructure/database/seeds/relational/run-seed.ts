import { NestFactory } from '@nestjs/core';
import { RoleSeedService } from './role/role-seed.service';
import { SeedModule } from './seed.module';
import { StatusSeedService } from './status/status-seed.service';
import { UserSeedService } from './user/user-seed.service';
import { PermissionSeedService } from './permission/permission-seed.service';
import { RegionSeedService } from './region/region-seed.service';
import { ConfigSeedService } from './config/config-seed.service';

const runSeed = async (): Promise<void> => {
  const app = await NestFactory.create(SeedModule);

  // run seeds in order (role must be created before permission)
  await app.get(RoleSeedService).run();
  await app.get(StatusSeedService).run();
  await app.get(PermissionSeedService).run();
  await app.get(RegionSeedService).run();
  await app.get(UserSeedService).run();
  await app.get(ConfigSeedService).run();

  await app.close();
};

void runSeed();
