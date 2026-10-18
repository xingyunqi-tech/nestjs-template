import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaperEntity } from './entities/paper.entity';
import { PaperQuestionEntity } from './entities/paper-question.entity';
import { PaperRuleEntity } from './entities/paper-rule.entity';
import { DailyQuestionSetEntity } from './entities/daily-question-set.entity';
import { PaperRepository } from '../paper.repository';
import { PaperRuleRepository } from '../paper-rule.repository';
import { DailyQuestionSetRepository } from '../daily-question-set.repository';
import { DailySetUsageRepository } from '../daily-set-usage.repository';
import { PaperRelationalRepository } from './repositories/paper.repository';
import { PaperRuleRelationalRepository } from './repositories/paper-rule.repository';
import { DailyQuestionSetRelationalRepository } from './repositories/daily-question-set.repository';
import { DailySetUsageRelationalRepository } from './repositories/daily-set-usage.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PaperEntity, PaperQuestionEntity, PaperRuleEntity, DailyQuestionSetEntity])],
  providers: [
    { provide: PaperRepository, useClass: PaperRelationalRepository },
    { provide: PaperRuleRepository, useClass: PaperRuleRelationalRepository },
    { provide: DailyQuestionSetRepository, useClass: DailyQuestionSetRelationalRepository },
    { provide: DailySetUsageRepository, useClass: DailySetUsageRelationalRepository },
  ],
  exports: [PaperRepository, PaperRuleRepository, DailyQuestionSetRepository, DailySetUsageRepository],
})
export class RelationalPaperPersistenceModule {}
