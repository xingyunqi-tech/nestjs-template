import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExamEntity } from './entities/exam.entity';
import { SubjectEntity } from './entities/subject.entity';
import { KnowledgePointEntity } from './entities/knowledge-point.entity';
import { UserExamProfileEntity } from './entities/user-exam-profile.entity';
import { ExamRepository } from '../exam.repository';
import { SubjectRepository } from '../subject.repository';
import { KnowledgePointRepository } from '../knowledge-point.repository';
import { KnowledgePointQuestionRepository } from '../knowledge-point-question.repository';
import { UserExamProfileRepository } from '../user-exam-profile.repository';
import { ExamRelationalRepository } from './repositories/exam.repository';
import { SubjectRelationalRepository } from './repositories/subject.repository';
import { KnowledgePointRelationalRepository } from './repositories/knowledge-point.repository';
import { KnowledgePointQuestionRelationalRepository } from './repositories/knowledge-point-question.repository';
import { UserExamProfileRelationalRepository } from './repositories/user-exam-profile.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ExamEntity, SubjectEntity, KnowledgePointEntity, UserExamProfileEntity])],
  providers: [
    { provide: ExamRepository, useClass: ExamRelationalRepository },
    { provide: SubjectRepository, useClass: SubjectRelationalRepository },
    { provide: KnowledgePointRepository, useClass: KnowledgePointRelationalRepository },
    { provide: KnowledgePointQuestionRepository, useClass: KnowledgePointQuestionRelationalRepository },
    { provide: UserExamProfileRepository, useClass: UserExamProfileRelationalRepository },
  ],
  exports: [
    ExamRepository,
    SubjectRepository,
    KnowledgePointRepository,
    KnowledgePointQuestionRepository,
    UserExamProfileRepository,
  ],
})
export class RelationalExamPersistenceModule {}
