import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SubjectRepository } from './infrastructure/persistence/subject.repository';
import { ExamRepository } from './infrastructure/persistence/exam.repository';
import { KnowledgePointRepository } from './infrastructure/persistence/knowledge-point.repository';
import { Subject } from './domain/subject';
import { Exam } from './domain/exam';
import { CONTENT_STATUS_SOURCES, ContentStatus } from './domain/content-status';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { SubjectFilterOptions } from './dto/query-admin-subject.dto';
import { conflictOnForeignKeyViolation } from './foreign-key-conflict';
import { IPaginationOptions } from '../../common/types/pagination-options';

@Injectable()
export class SubjectsService {
  constructor(
    private readonly subjectRepository: SubjectRepository,
    private readonly examRepository: ExamRepository,
    private readonly knowledgePointRepository: KnowledgePointRepository,
  ) {}

  async findPublishedByExamId(examId: Exam['id']): Promise<Subject[]> {
    const exam = await this.examRepository.findById(examId);
    if (exam?.status !== ContentStatus.PUBLISHED) {
      throw new NotFoundException({ error: 'examNotFound' });
    }
    return this.subjectRepository.findManyByExamIdAndStatus(examId, ContentStatus.PUBLISHED);
  }

  /** 科目及其考试均已发布时返回科目 */
  async getPublishedSubject(id: Subject['id']): Promise<Subject> {
    const subject = await this.subjectRepository.findById(id);
    const exam =
      subject?.status === ContentStatus.PUBLISHED ? await this.examRepository.findById(subject.examId) : null;
    if (!subject || exam?.status !== ContentStatus.PUBLISHED) {
      throw new NotFoundException({ error: 'subjectNotFound' });
    }
    return subject;
  }

  findAllPublished(): Promise<Subject[]> {
    return this.subjectRepository.findAllPublished();
  }

  findManyWithPaginationAndCount(options: {
    filterOptions?: SubjectFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Subject[]; total: number }> {
    return this.subjectRepository.findManyWithPaginationAndCount(options);
  }

  async findById(id: Subject['id']): Promise<Subject> {
    const subject = await this.subjectRepository.findById(id);
    if (!subject) {
      throw new NotFoundException({ error: 'subjectNotFound' });
    }
    return subject;
  }

  async create(dto: CreateSubjectDto): Promise<Subject> {
    if (!(await this.examRepository.findById(dto.examId))) {
      throw new UnprocessableEntityException({ errors: { examId: 'examNotFound' } });
    }
    return conflictOnForeignKeyViolation(
      this.subjectRepository.create({
        examId: dto.examId,
        name: dto.name,
        sort: dto.sort ?? 0,
        hasSubjective: dto.hasSubjective ?? false,
        status: ContentStatus.DRAFT,
      }),
    );
  }

  async update(id: Subject['id'], dto: UpdateSubjectDto): Promise<Subject> {
    const subject = await this.subjectRepository.update(id, dto);
    if (!subject) {
      throw new NotFoundException({ error: 'subjectNotFound' });
    }
    return subject;
  }

  async changeStatus(id: Subject['id'], target: ContentStatus.PUBLISHED | ContentStatus.OFFLINE): Promise<Subject> {
    await this.subjectRepository.transitionStatus(id, CONTENT_STATUS_SOURCES[target], target);
    const subject = await this.findById(id);
    if (subject.status !== target) {
      throw new ConflictException({ error: 'invalidStatusTransition' });
    }
    return subject;
  }

  async remove(id: Subject['id']): Promise<void> {
    const subject = await this.findById(id);
    if (subject.status !== ContentStatus.DRAFT) {
      throw new ConflictException({ error: 'onlyDraftDeletable' });
    }
    if ((await this.knowledgePointRepository.countBySubjectId(id)) > 0) {
      throw new ConflictException({ error: 'subjectHasKnowledgePoints' });
    }
    if (!(await conflictOnForeignKeyViolation(this.subjectRepository.removeDraftWithoutKnowledgePoints(id)))) {
      throw new ConflictException({ error: 'conflict' });
    }
  }
}
