import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrataEntity } from './entities/errata.entity';
import { ErrataUserEntity } from './entities/errata-user.entity';
import { ErrataRepository } from '../errata.repository';
import { ErrataRelationalRepository } from './repositories/errata.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ErrataEntity, ErrataUserEntity])],
  providers: [{ provide: ErrataRepository, useClass: ErrataRelationalRepository }],
  exports: [ErrataRepository],
})
export class RelationalErrataPersistenceModule {}
