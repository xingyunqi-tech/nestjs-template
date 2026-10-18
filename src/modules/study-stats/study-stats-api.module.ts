import { Module } from '@nestjs/common';
import { StudyStatsModule } from './study-stats.module';
import { ExamsModule } from '../exams/exams.module';
import { StudyBrowseService } from './study-browse.service';
import { StudyController } from './study.controller';
import { SubjectKnowledgePointsController } from './subject-knowledge-points.controller';

@Module({
  imports: [StudyStatsModule, ExamsModule],
  controllers: [StudyController, SubjectKnowledgePointsController],
  providers: [StudyBrowseService],
})
export class StudyStatsApiModule {}
