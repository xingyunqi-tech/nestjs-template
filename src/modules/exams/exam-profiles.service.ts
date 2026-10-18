import { Injectable, NotFoundException } from '@nestjs/common';
import { UserExamProfileRepository } from './infrastructure/persistence/user-exam-profile.repository';
import { UserExamProfile } from './domain/user-exam-profile';
import { NullableType } from '../../common/types/nullable.type';
import { ContentStatus } from './domain/content-status';
import { UpsertExamProfileDto } from './dto/upsert-exam-profile.dto';
import { ExamsService } from './exams.service';
import { conflictOnForeignKeyViolation } from './foreign-key-conflict';

@Injectable()
export class ExamProfilesService {
  constructor(
    private readonly profileRepository: UserExamProfileRepository,
    private readonly examsService: ExamsService,
  ) {}

  async findMine(userId: UserExamProfile['userId']): Promise<UserExamProfile[]> {
    const profiles = await this.profileRepository.findManyByUserId(userId);
    await this.examsService.withResolvedIcons(profiles.flatMap((profile) => (profile.exam ? [profile.exam] : [])));
    return profiles;
  }

  findCurrent(userId: UserExamProfile['userId']): Promise<NullableType<UserExamProfile>> {
    return this.profileRepository.findCurrentByUserId(userId);
  }

  /** 首次关注要求考试已发布 */
  async upsert(
    userId: UserExamProfile['userId'],
    examId: UserExamProfile['examId'],
    dto: UpsertExamProfileDto,
  ): Promise<UserExamProfile> {
    if (!(await this.profileRepository.findByUserIdAndExamId(userId, examId))) {
      await this.examsService.getPublishedExam(examId);
    }
    return this.withResolvedIcon(
      await conflictOnForeignKeyViolation(
        this.profileRepository.upsert(userId, examId, { examDate: dto.examDate, dailyGoal: dto.dailyGoal }),
      ),
    );
  }

  async setCurrent(userId: UserExamProfile['userId'], examId: UserExamProfile['examId']): Promise<UserExamProfile> {
    const profile = await this.profileRepository.findByUserIdAndExamId(userId, examId);
    if (!profile) {
      throw new NotFoundException({ error: 'examProfileNotFound' });
    }
    if (profile.exam?.status !== ContentStatus.PUBLISHED) {
      throw new NotFoundException({ error: 'examNotFound' });
    }
    const updated = (await this.profileRepository.markCurrent(userId, examId))
      ? await this.profileRepository.findByUserIdAndExamId(userId, examId)
      : null;
    if (!updated) {
      throw new NotFoundException({ error: 'examProfileNotFound' });
    }
    return this.withResolvedIcon(updated);
  }

  async remove(userId: UserExamProfile['userId'], examId: UserExamProfile['examId']): Promise<void> {
    if (!(await this.profileRepository.remove(userId, examId))) {
      throw new NotFoundException({ error: 'examProfileNotFound' });
    }
  }

  private async withResolvedIcon(profile: UserExamProfile): Promise<UserExamProfile> {
    if (profile.exam) {
      await this.examsService.withResolvedIcons([profile.exam]);
    }
    return profile;
  }
}
