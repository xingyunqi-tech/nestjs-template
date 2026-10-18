import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { UserExamProfileEntity } from '../entities/user-exam-profile.entity';
import { UserExamProfileMapper } from '../mappers/user-exam-profile.mapper';
import { ExamProfileChanges, UserExamProfileRepository } from '../../user-exam-profile.repository';
import { UserExamProfile } from '../../../../domain/user-exam-profile';
import { ContentStatus } from '../../../../domain/content-status';
import { DEFAULT_DAILY_GOAL } from '../../../../domain/exam-profile-defaults';
import { NullableType } from '../../../../../../common/types/nullable.type';

@Injectable()
export class UserExamProfileRelationalRepository implements UserExamProfileRepository {
  constructor(
    @InjectRepository(UserExamProfileEntity)
    private readonly profileRepository: Repository<UserExamProfileEntity>,
  ) {}

  async findManyByUserId(userId: UserExamProfile['userId']): Promise<UserExamProfile[]> {
    const entities = await this.profileRepository.find({
      where: { userId: Number(userId) },
      relations: { exam: true },
      order: { isCurrent: 'DESC', createdAt: 'DESC', id: 'ASC' },
    });
    return entities.map((entity) => UserExamProfileMapper.toDomain(entity));
  }

  async findCurrentByUserId(userId: UserExamProfile['userId']): Promise<NullableType<UserExamProfile>> {
    const entity = await this.profileRepository.findOne({ where: { userId: Number(userId), isCurrent: true } });
    return entity ? UserExamProfileMapper.toDomain(entity) : null;
  }

  async findByUserIdAndExamId(
    userId: UserExamProfile['userId'],
    examId: UserExamProfile['examId'],
  ): Promise<NullableType<UserExamProfile>> {
    const entity = await this.profileRepository.findOne({
      where: { userId: Number(userId), examId },
      relations: { exam: true },
    });
    return entity ? UserExamProfileMapper.toDomain(entity) : null;
  }

  async upsert(
    userId: UserExamProfile['userId'],
    examId: UserExamProfile['examId'],
    changes: ExamProfileChanges,
  ): Promise<UserExamProfile> {
    return this.profileRepository.manager.transaction(async (manager) => {
      await this.lockUserProfiles(manager, userId);
      const existing = await manager.findOne(UserExamProfileEntity, { where: { userId: Number(userId), examId } });
      if (existing) {
        const update: QueryDeepPartialEntity<UserExamProfileEntity> = {
          ...(changes.examDate !== undefined && { examDate: changes.examDate }),
          ...(changes.dailyGoal !== undefined && { dailyGoal: changes.dailyGoal }),
        };
        if (Object.keys(update).length > 0) {
          await manager.update(UserExamProfileEntity, { id: existing.id }, update);
        }
        return this.findInTransaction(manager, userId, examId);
      }

      const hasCurrent = await manager.exists(UserExamProfileEntity, {
        where: { userId: Number(userId), isCurrent: true },
      });
      await manager.save(
        manager.create(
          UserExamProfileEntity,
          UserExamProfileMapper.toPersistence({
            userId,
            examId,
            isCurrent: !hasCurrent,
            examDate: changes.examDate ?? null,
            dailyGoal: changes.dailyGoal ?? DEFAULT_DAILY_GOAL,
          }),
        ),
      );
      return this.findInTransaction(manager, userId, examId);
    });
  }

  async markCurrent(userId: UserExamProfile['userId'], examId: UserExamProfile['examId']): Promise<boolean> {
    return this.profileRepository.manager.transaction(async (manager) => {
      await this.lockUserProfiles(manager, userId);
      const exists = await manager.exists(UserExamProfileEntity, { where: { userId: Number(userId), examId } });
      if (!exists) {
        return false;
      }
      await manager.query(
        `UPDATE "user_exam_profile" SET "isCurrent" = false, "updatedAt" = now()
         WHERE "userId" = $1 AND "isCurrent" AND "examId" <> $2`,
        [Number(userId), examId],
      );
      await manager.query(
        `UPDATE "user_exam_profile" SET "isCurrent" = true, "updatedAt" = now()
         WHERE "userId" = $1 AND "examId" = $2 AND NOT "isCurrent"`,
        [Number(userId), examId],
      );
      return true;
    });
  }

  async remove(userId: UserExamProfile['userId'], examId: UserExamProfile['examId']): Promise<boolean> {
    return this.profileRepository.manager.transaction(async (manager) => {
      await this.lockUserProfiles(manager, userId);
      const existing = await manager.findOne(UserExamProfileEntity, { where: { userId: Number(userId), examId } });
      if (!existing) {
        return false;
      }
      await manager.delete(UserExamProfileEntity, { id: existing.id });
      if (existing.isCurrent) {
        await manager.query(
          `UPDATE "user_exam_profile" SET "isCurrent" = true, "updatedAt" = now()
           WHERE "id" = (
             SELECT p."id" FROM "user_exam_profile" AS p
             INNER JOIN "exam" AS e ON e."id" = p."examId" AND e."status" = $2
             WHERE p."userId" = $1
             ORDER BY p."createdAt" DESC, p."id" ASC
             LIMIT 1
           )`,
          [Number(userId), ContentStatus.PUBLISHED],
        );
      }
      return true;
    });
  }

  private async findInTransaction(
    manager: EntityManager,
    userId: UserExamProfile['userId'],
    examId: UserExamProfile['examId'],
  ): Promise<UserExamProfile> {
    const entity = await manager.findOneOrFail(UserExamProfileEntity, {
      where: { userId: Number(userId), examId },
      relations: { exam: true },
    });
    return UserExamProfileMapper.toDomain(entity);
  }

  private async lockUserProfiles(manager: EntityManager, userId: UserExamProfile['userId']): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('user_exam_profile'), $1)`, [Number(userId)]);
  }
}
