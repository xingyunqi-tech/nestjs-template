import { Module } from '@nestjs/common';
import { RelationalExamPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { FilesModule } from '../files/files.module';
import { ExamsService } from './exams.service';
import { SubjectsService } from './subjects.service';
import { KnowledgePointsService } from './knowledge-points.service';
import { KnowledgePointQuestionCountService } from './knowledge-point-question-count.service';
import { ExamProfilesService } from './exam-profiles.service';
import { ExamsController } from './exams.controller';
import { ExamProfilesController } from './exam-profiles.controller';
import { AdminExamsController } from './admin-exams.controller';
import { AdminSubjectsController } from './admin-subjects.controller';
import { AdminKnowledgePointsController } from './admin-knowledge-points.controller';

@Module({
  imports: [RelationalExamPersistenceModule, FilesModule],
  controllers: [
    ExamsController,
    ExamProfilesController,
    AdminExamsController,
    AdminSubjectsController,
    AdminKnowledgePointsController,
  ],
  providers: [
    ExamsService,
    SubjectsService,
    KnowledgePointsService,
    KnowledgePointQuestionCountService,
    ExamProfilesService,
  ],
  exports: [
    ExamsService,
    SubjectsService,
    KnowledgePointsService,
    KnowledgePointQuestionCountService,
    ExamProfilesService,
    RelationalExamPersistenceModule,
  ],
})
export class ExamsModule {}
