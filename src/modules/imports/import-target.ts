import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { KnowledgePoint } from '../exams/domain/knowledge-point';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionUnit } from '../questions/domain/question-unit';
import { QuestionImportResult, QuestionImportUnit } from '../questions/question-import';
import { PapersService } from '../papers/papers.service';
import { PaperImportInput } from '../papers/paper-import';
import { PaperType } from '../papers/domain/paper-type';
import { FileStorageService } from '../files/file-storage.service';
import { AssetPurpose } from './package/asset-kind';

export interface ImportSessionDeps {
  subjectsService: SubjectsService;
  knowledgePointsService: KnowledgePointsService;
  questionsService: QuestionsService;
  papersService: PapersService;
  fileStorageService: FileStorageService;
}

export interface StoredAsset {
  fileId: string;
  /** 本次新存入的文件；单元失败时调用以撤销 */
  discard: (() => Promise<void>) | null;
}

/** 导入会话读写题库的全部入口，预检时由内存模拟实现替换 */
export interface ImportTarget {
  ensureKnowledgePath(subjectId: string, names: string[]): Promise<boolean>;
  findKnowledgePoints(subjectId: string): Promise<KnowledgePoint[]>;
  storeAsset(content: Buffer, name: string, purpose: AssetPurpose): Promise<StoredAsset>;
  importQuestionUnit(unit: QuestionImportUnit): Promise<QuestionImportResult>;
  findQuestions(ids: string[]): Promise<Question[]>;
  findQuestionUnits(rootIds: string[]): Promise<QuestionUnit[]>;
  paperTitleExists(subjectId: string, title: string): Promise<boolean>;
  importPaper(input: PaperImportInput): Promise<void>;
}

const PAPER_TITLE_LOOKUP_LIMIT = 100;

export async function catalogPaperTitleExists(
  papersService: PapersService,
  subjectId: string,
  title: string,
): Promise<boolean> {
  const { data } = await papersService.findManyWithPaginationAndCount({
    filterOptions: { subjectId, keyword: title },
    paginationOptions: { page: 1, limit: PAPER_TITLE_LOOKUP_LIMIT },
  });
  return data.some((paper) => paper.title === title && paper.type !== PaperType.GENERATED);
}

export class LiveImportTarget implements ImportTarget {
  constructor(private readonly deps: ImportSessionDeps) {}

  async ensureKnowledgePath(subjectId: string, names: string[]): Promise<boolean> {
    return (await this.deps.knowledgePointsService.ensurePath(subjectId, names)).created;
  }

  findKnowledgePoints(subjectId: string): Promise<KnowledgePoint[]> {
    return this.deps.knowledgePointsService.findBySubjectId(subjectId);
  }

  async storeAsset(content: Buffer, name: string, purpose: AssetPurpose): Promise<StoredAsset> {
    const { file, reused } = await this.deps.fileStorageService.storeDeduplicated(content, name, purpose, null);
    return { fileId: file.id, discard: reused ? null : () => this.deps.fileStorageService.remove(file) };
  }

  importQuestionUnit(unit: QuestionImportUnit): Promise<QuestionImportResult> {
    return this.deps.questionsService.importUnit(unit);
  }

  findQuestions(ids: string[]): Promise<Question[]> {
    return this.deps.questionsService.findByIds(ids);
  }

  findQuestionUnits(rootIds: string[]): Promise<QuestionUnit[]> {
    return this.deps.questionsService.findUnits(rootIds);
  }

  paperTitleExists(subjectId: string, title: string): Promise<boolean> {
    return catalogPaperTitleExists(this.deps.papersService, subjectId, title);
  }

  async importPaper(input: PaperImportInput): Promise<void> {
    await this.deps.papersService.importPaper(input);
  }
}
