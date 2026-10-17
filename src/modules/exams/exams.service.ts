import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamRepository } from './infrastructure/persistence/exam.repository';
import { SubjectRepository } from './infrastructure/persistence/subject.repository';
import { Exam } from './domain/exam';
import { ExamCategory } from './domain/exam-category';
import { CONTENT_STATUS_SOURCES, ContentStatus } from './domain/content-status';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { ExamFilterOptions } from './dto/query-admin-exam.dto';
import { ExamGroupDto } from './dto/exam-group.dto';
import { FileUrlResolver } from '../files/file-url.resolver';
import { conflictOnForeignKeyViolation } from './foreign-key-conflict';
import { IPaginationOptions } from '../../common/types/pagination-options';

@Injectable()
export class ExamsService {
  constructor(
    private readonly examRepository: ExamRepository,
    private readonly subjectRepository: SubjectRepository,
    private readonly fileUrlResolver: FileUrlResolver,
  ) {}

  async findPublishedGroups(): Promise<ExamGroupDto[]> {
    const exams = await this.withResolvedIcons(await this.examRepository.findManyByStatus(ContentStatus.PUBLISHED));
    return Object.values(ExamCategory)
      .map((category) => ({ category, exams: exams.filter((exam) => exam.category === category) }))
      .filter((group) => group.exams.length > 0);
  }

  async getPublishedExam(id: Exam['id']): Promise<Exam> {
    const exam = await this.examRepository.findById(id);
    if (exam?.status !== ContentStatus.PUBLISHED) {
      throw new NotFoundException({ error: 'examNotFound' });
    }
    return exam;
  }

  async withResolvedIcons<T extends Pick<Exam, 'icon'>>(exams: T[]): Promise<T[]> {
    const withIcon = exams.filter((exam) => exam.icon);
    const icons = await this.fileUrlResolver.resolveMany(withIcon.map((exam) => exam.icon!));
    withIcon.forEach((exam, index) => {
      exam.icon = icons[index];
    });
    return exams;
  }

  findManyWithPaginationAndCount(options: {
    filterOptions?: ExamFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Exam[]; total: number }> {
    return this.examRepository.findManyWithPaginationAndCount(options);
  }

  async findById(id: Exam['id']): Promise<Exam> {
    const exam = await this.examRepository.findById(id);
    if (!exam) {
      throw new NotFoundException({ error: 'examNotFound' });
    }
    return exam;
  }

  create(dto: CreateExamDto): Promise<Exam> {
    return this.examRepository.create({
      name: dto.name,
      category: dto.category,
      icon: dto.icon ?? null,
      description: dto.description ?? null,
      sort: dto.sort ?? 0,
      status: ContentStatus.DRAFT,
    });
  }

  async update(id: Exam['id'], dto: UpdateExamDto): Promise<Exam> {
    const exam = await this.examRepository.update(id, dto);
    if (!exam) {
      throw new NotFoundException({ error: 'examNotFound' });
    }
    return exam;
  }

  async changeStatus(id: Exam['id'], target: ContentStatus.PUBLISHED | ContentStatus.OFFLINE): Promise<Exam> {
    await this.examRepository.transitionStatus(id, CONTENT_STATUS_SOURCES[target], target);
    const exam = await this.findById(id);
    if (exam.status !== target) {
      throw new ConflictException({ error: 'invalidStatusTransition' });
    }
    return exam;
  }

  async remove(id: Exam['id']): Promise<void> {
    const exam = await this.findById(id);
    if (exam.status !== ContentStatus.DRAFT) {
      throw new ConflictException({ error: 'onlyDraftDeletable' });
    }
    if ((await this.subjectRepository.countByExamId(id)) > 0) {
      throw new ConflictException({ error: 'examHasSubjects' });
    }
    if (!(await conflictOnForeignKeyViolation(this.examRepository.removeDraftWithoutSubjects(id)))) {
      throw new ConflictException({ error: 'conflict' });
    }
  }
}
