import { Injectable } from '@nestjs/common';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { QuestionsService } from '../questions/questions.service';
import { PapersService } from '../papers/papers.service';
import { FileStorageService } from '../files/file-storage.service';
import { ImportOutcome } from './domain/import-outcome';
import { ImportPackage } from './package/import-package';
import { ImportProgressListener, ImportRunOptions, ImportSession } from './import-session';

/** 把解析后的导入包写入题库，单元原子性由各模块服务的事务保证 */
@Injectable()
export class ContentImporter {
  constructor(
    private readonly subjectsService: SubjectsService,
    private readonly knowledgePointsService: KnowledgePointsService,
    private readonly questionsService: QuestionsService,
    private readonly papersService: PapersService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  run(pkg: ImportPackage, options: ImportRunOptions, onProgress?: ImportProgressListener): Promise<ImportOutcome> {
    const deps = {
      subjectsService: this.subjectsService,
      knowledgePointsService: this.knowledgePointsService,
      questionsService: this.questionsService,
      papersService: this.papersService,
      fileStorageService: this.fileStorageService,
    };
    return new ImportSession(deps, pkg, options, onProgress).run();
  }
}
