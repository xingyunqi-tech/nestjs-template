import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PracticeSessionEntity } from './entities/practice-session.entity';
import { AnswerRecordEntity } from './entities/answer-record.entity';
import { PracticeSessionRepository } from '../practice-session.repository';
import { PracticeSessionRelationalRepository } from './repositories/practice-session.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PracticeSessionEntity, AnswerRecordEntity])],
  providers: [{ provide: PracticeSessionRepository, useClass: PracticeSessionRelationalRepository }],
  exports: [PracticeSessionRepository],
})
export class RelationalPracticePersistenceModule {}
