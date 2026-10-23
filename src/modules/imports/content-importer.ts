import { Injectable } from '@nestjs/common';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { QuestionsService } from '../questions/questions.service';
import { PapersService } from '../papers/papers.service';
import { FileStorageService } from '../files/file-storage.service';
import { ImportOutcome, ImportSummary } from './domain/import-outcome';
import { ImportPackage } from './package/import-package';
import { ImportProgressListener, ImportRunOptions, ImportSession, ImportSessionDeps } from './import-session';

export interface ImportPrecheckOutcome extends ImportOutcome {
  summary: ImportSummary;
}

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
    return new ImportSession(this.deps(), pkg, { ...options, dryRun: false }, onProgress).run();
  }

  /** 完整解析与校验但不写入，统计按真实导入的顺序在内存中模拟 */
  async precheck(pkg: ImportPackage, options: Omit<ImportRunOptions, 'dryRun'>): Promise<ImportPrecheckOutcome> {
    const session = new ImportSession(this.deps(), pkg, { ...options, dryRun: true });
    const outcome = await session.run();
    return { ...outcome, summary: session.summary };
  }

  private deps(): ImportSessionDeps {
    return {
      subjectsService: this.subjectsService,
      knowledgePointsService: this.knowledgePointsService,
      questionsService: this.questionsService,
      papersService: this.papersService,
      fileStorageService: this.fileStorageService,
    };
  }
}
