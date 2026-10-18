import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { FavoriteInput, FavoritesService } from './favorites.service';
import { Favorite, FavoriteTargetType } from './domain/favorite';
import { questionTitle, snapshotTitle } from './domain/favorite-title';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { QueryFavoriteDto } from './dto/query-favorite.dto';
import { FavoriteItemDto } from './dto/favorite-item.dto';
import { QuestionAssociationPrerequisiteService } from '../practice/question-association-prerequisite.service';
import { PapersService } from '../papers/papers.service';
import { PaperType } from '../papers/domain/paper-type';
import { QuestionsService } from '../questions/questions.service';
import { QuestionStatus } from '../questions/domain/question-status';
import { ContentStatus } from '../exams/domain/content-status';
import { IPaginationOptions } from '../../common/types/pagination-options';

const MAX_PAGE_SIZE = 50;

/** 创建、切换与列出收藏：题目与试卷由服务端校验目标并写入标题快照与科目 */
@Injectable()
export class FavoriteTargetsService {
  constructor(
    private readonly favoritesService: FavoritesService,
    private readonly questionAssociationPrerequisiteService: QuestionAssociationPrerequisiteService,
    private readonly papersService: PapersService,
    private readonly questionsService: QuestionsService,
  ) {}

  async create(userId: number, dto: CreateFavoriteDto): Promise<Favorite> {
    return this.favoritesService.create(userId, await this.resolve(userId, dto));
  }

  async toggle(userId: number, dto: CreateFavoriteDto): Promise<{ isFavorited: boolean; favorite?: Favorite }> {
    const existing = await this.favoritesService.findByTarget(userId, dto.targetType, dto.targetId);
    if (existing) {
      await this.favoritesService.remove(existing.id, userId);
      return { isFavorited: false };
    }
    return { isFavorited: true, favorite: await this.create(userId, dto) };
  }

  async findPage(
    userId: number,
    query: QueryFavoriteDto,
  ): Promise<{ data: FavoriteItemDto[]; total: number; paginationOptions: IPaginationOptions }> {
    const paginationOptions = { page: query.page ?? 1, limit: Math.min(query.limit ?? 10, MAX_PAGE_SIZE) };
    const { data, total } = await this.favoritesService.findManyWithPaginationAndCount({
      userId,
      targetType: query.targetType,
      subjectId: query.subjectId,
      paginationOptions,
    });
    const offline = await this.findOfflineTargets(data);
    return {
      data: data.map((favorite) =>
        Object.assign(new FavoriteItemDto(), favorite, {
          targetOffline: offline.get(`${favorite.targetType}:${favorite.targetId}`) ?? null,
        }),
      ),
      total,
      paginationOptions,
    };
  }

  /** 键为 `targetType:targetId`；不存在的目标视为已下架 */
  private async findOfflineTargets(favorites: Favorite[]): Promise<Map<string, boolean>> {
    const idsOf = (type: FavoriteTargetType): string[] =>
      favorites.filter((favorite) => favorite.targetType === type).map((favorite) => favorite.targetId);
    const questionIds = idsOf(FavoriteTargetType.QUESTION);
    const paperIds = idsOf(FavoriteTargetType.PAPER);
    const [questions, papers] = await Promise.all([
      this.questionsService.findByIds(questionIds),
      this.papersService.findByIds(paperIds),
    ]);
    const parents = await this.questionsService.findByIds([
      ...new Set(questions.flatMap((question) => question.parentId ?? [])),
    ]);
    const published = new Set(
      [...questions, ...parents]
        .filter((question) => question.status === QuestionStatus.PUBLISHED)
        .map((question) => question.id),
    );
    const questionById = new Map(questions.map((question) => [question.id, question]));
    const publishedPapers = new Set(
      papers.filter((paper) => paper.status === ContentStatus.PUBLISHED).map((paper) => paper.id),
    );
    return new Map([
      ...questionIds.map((id): [string, boolean] => {
        const question = questionById.get(id);
        const online =
          !!question && published.has(id) && (question.parentId === null || published.has(question.parentId));
        return [`${FavoriteTargetType.QUESTION}:${id}`, !online];
      }),
      ...paperIds.map((id): [string, boolean] => [`${FavoriteTargetType.PAPER}:${id}`, !publishedPapers.has(id)]),
    ]);
  }

  private async resolve(userId: number, dto: CreateFavoriteDto): Promise<FavoriteInput> {
    const { targetType, targetId, extra } = dto;
    switch (targetType) {
      case FavoriteTargetType.QUESTION: {
        const question = await this.questionAssociationPrerequisiteService.assertEligible(userId, targetId);
        return {
          targetType,
          targetId: question.id,
          title: questionTitle(question.stem),
          extra,
          subjectId: question.subjectId,
        };
      }
      case FavoriteTargetType.PAPER: {
        if (!isUUID(targetId)) {
          throw new NotFoundException({ error: 'paperNotFound' });
        }
        const paper = await this.papersService.findVisible(targetId.toLowerCase(), userId);
        if (paper.type === PaperType.GENERATED) {
          throw new NotFoundException({ error: 'paperNotFound' });
        }
        return { targetType, targetId: paper.id, title: snapshotTitle(paper.title), extra, subjectId: paper.subjectId };
      }
      default:
        return { targetType, targetId, title: dto.title, image: dto.image, extra, subjectId: null };
    }
  }
}
