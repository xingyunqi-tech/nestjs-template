import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PracticeSessionEntity } from './entities/practice-session.entity';
import { AnswerRecordEntity } from './entities/answer-record.entity';
import { PracticeSessionRepository } from '../practice-session.repository';
import { PracticeSessionRelationalRepository } from './repositories/practice-session.repository';
import { AnswerRegradeRepository } from '../answer-regrade.repository';
import { AnswerRegradeRelationalRepository } from './repositories/answer-regrade.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PracticeSessionEntity, AnswerRecordEntity])],
  providers: [
    { provide: PracticeSessionRepository, useClass: PracticeSessionRelationalRepository },
    { provide: AnswerRegradeRepository, useClass: AnswerRegradeRelationalRepository },
  ],
  exports: [PracticeSessionRepository, AnswerRegradeRepository],
})
export class RelationalPracticePersistenceModule {}
