import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { KnowledgePointRepository } from './infrastructure/persistence/knowledge-point.repository';
import { SubjectRepository } from './infrastructure/persistence/subject.repository';
import { KnowledgePoint } from './domain/knowledge-point';
import { Subject } from './domain/subject';
import { KnowledgePointChangeResult, KnowledgePointViolation } from './domain/knowledge-point-rules';
import { SubjectsService } from './subjects.service';
import { CreateKnowledgePointDto } from './dto/create-knowledge-point.dto';
import { UpdateKnowledgePointDto } from './dto/update-knowledge-point.dto';
import { MoveKnowledgePointDto } from './dto/move-knowledge-point.dto';
import {
  MigrateKnowledgePointQuestionsDto,
  MigrateKnowledgePointQuestionsResultDto,
} from './dto/migrate-knowledge-point-questions.dto';
import { KnowledgePointTreeNodeDto, PublicKnowledgePointTreeNodeDto } from './dto/knowledge-point-tree-node.dto';
import { buildKnowledgePointTree } from './knowledge-point-tree';
import { conflictOnForeignKeyViolation } from './foreign-key-conflict';

function violationException(violation: KnowledgePointViolation): HttpException {
  switch (violation) {
    case KnowledgePointViolation.NOT_FOUND:
      return new NotFoundException({ error: violation });
    case KnowledgePointViolation.INVALID_MIGRATION_TARGET:
    case KnowledgePointViolation.MIGRATION_TARGET_NOT_LEAF:
      return new UnprocessableEntityException({ errors: { targetId: violation } });
    case KnowledgePointViolation.INVALID_PARENT:
    case KnowledgePointViolation.TOO_DEEP:
      return new UnprocessableEntityException({ errors: { parentId: violation } });
    case KnowledgePointViolation.HAS_QUESTIONS:
    case KnowledgePointViolation.HAS_CHILDREN:
      return new ConflictException({ error: violation });
  }
}

function unwrap<T>(result: KnowledgePointChangeResult<T>): T {
  if (!result.ok) {
    throw violationException(result.violation);
  }
  return result.value;
}

@Injectable()
export class KnowledgePointsService {
  constructor(
    private readonly knowledgePointRepository: KnowledgePointRepository,
    private readonly subjectRepository: SubjectRepository,
    private readonly subjectsService: SubjectsService,
  ) {}

  async getPublishedTree(subjectId: Subject['id']): Promise<PublicKnowledgePointTreeNodeDto[]> {
    await this.subjectsService.getPublishedSubject(subjectId);
    const points = await this.knowledgePointRepository.findManyBySubjectId(subjectId);
    return buildKnowledgePointTree(points, (point) =>
      Object.assign(new PublicKnowledgePointTreeNodeDto(), point, { progress: null }),
    );
  }

  async getTree(subjectId: Subject['id']): Promise<KnowledgePointTreeNodeDto[]> {
    await this.subjectsService.findById(subjectId);
    const points = await this.knowledgePointRepository.findManyBySubjectId(subjectId);
    return buildKnowledgePointTree(points, (point) => Object.assign(new KnowledgePointTreeNodeDto(), point));
  }

  findByIds(ids: KnowledgePoint['id'][]): Promise<KnowledgePoint[]> {
    return this.knowledgePointRepository.findByIds([...new Set(ids)]);
  }

  async findById(id: KnowledgePoint['id']): Promise<KnowledgePoint> {
    const point = await this.knowledgePointRepository.findById(id);
    if (!point) {
      throw new NotFoundException({ error: KnowledgePointViolation.NOT_FOUND });
    }
    return point;
  }

  async create(dto: CreateKnowledgePointDto): Promise<KnowledgePoint> {
    if (!(await this.subjectRepository.findById(dto.subjectId))) {
      throw new UnprocessableEntityException({ errors: { subjectId: 'subjectNotFound' } });
    }
    return unwrap(
      await conflictOnForeignKeyViolation(
        this.knowledgePointRepository.create({
          subjectId: dto.subjectId,
          parentId: dto.parentId ?? null,
          name: dto.name,
          sort: dto.sort ?? 0,
        }),
      ),
    );
  }

  async update(id: KnowledgePoint['id'], dto: UpdateKnowledgePointDto): Promise<KnowledgePoint> {
    const point = await this.knowledgePointRepository.update(id, dto);
    if (!point) {
      throw new NotFoundException({ error: KnowledgePointViolation.NOT_FOUND });
    }
    return point;
  }

  async move(id: KnowledgePoint['id'], dto: MoveKnowledgePointDto): Promise<KnowledgePoint> {
    return unwrap(await this.knowledgePointRepository.move(id, dto.parentId, dto.sort));
  }

  async remove(id: KnowledgePoint['id']): Promise<void> {
    unwrap(await this.knowledgePointRepository.remove(id));
  }

  async migrateQuestions(
    id: KnowledgePoint['id'],
    dto: MigrateKnowledgePointQuestionsDto,
  ): Promise<MigrateKnowledgePointQuestionsResultDto> {
    return unwrap(await this.knowledgePointRepository.migrateQuestions(id, dto.targetId));
  }
}
