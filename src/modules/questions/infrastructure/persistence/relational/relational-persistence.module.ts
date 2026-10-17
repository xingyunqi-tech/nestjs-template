import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuestionEntity } from './entities/question.entity';
import { QuestionVersionEntity } from './entities/question-version.entity';
import { QuestionKnowledgePointEntity } from './entities/question-knowledge-point.entity';
import { QuestionRepository } from '../question.repository';
import { QuestionUsageRepository } from '../question-usage.repository';
import { QuestionRelationalRepository } from './repositories/question.repository';
import { QuestionUsageRelationalRepository } from './repositories/question-usage.repository';
import { ExamsModule } from '../../../../exams/exams.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([QuestionEntity, QuestionVersionEntity, QuestionKnowledgePointEntity]),
    ExamsModule,
  ],
  providers: [
    { provide: QuestionRepository, useClass: QuestionRelationalRepository },
    { provide: QuestionUsageRepository, useClass: QuestionUsageRelationalRepository },
  ],
  exports: [QuestionRepository, QuestionUsageRepository],
})
export class RelationalQuestionPersistenceModule {}
