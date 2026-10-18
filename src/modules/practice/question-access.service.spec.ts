import type { Mocked } from 'vitest';
import { QuestionAccessService } from './question-access.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { QuestionAssociationReader } from './ports/question-association.reader';
import { AnswerVisibilityService } from './answer-visibility.service';
import { HiddenReason } from './domain/hidden-reason';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { PublicQuestionUnitDto, toPublicQuestion } from '../questions/dto/public-question.dto';
import { QuestionSolutionDto } from '../questions/dto/question-solution.dto';

const USER = 7;

const question = (id: string, overrides: Partial<Question> = {}): Question =>
  Object.assign(new Question(), {
    id,
    subjectId: 's1',
    parentId: null,
    type: QuestionType.SINGLE,
    currentVersion: 1,
    stem: id,
    options: null,
    answer: { keys: ['B'] },
    analysis: null,
    difficulty: 3,
    knowledgePointIds: [],
    material: null,
    audioFileId: null,
    isFree: true,
    sort: 0,
    ...overrides,
  });

const solution = (analysis: string): QuestionSolutionDto => ({ answer: { keys: ['B'] }, analysis });

describe('QuestionAccessService', () => {
  const material = question('m', { type: QuestionType.MATERIAL, answer: null });
  const subs = [question('c1', { parentId: 'm' }), question('c2', { parentId: 'm', sort: 1 })];
  let repository: Mocked<Pick<PracticeSessionRepository, 'findQuestionIdsInUserSessions'>>;
  let associations: Mocked<QuestionAssociationReader>;
  let visibility: Mocked<Pick<AnswerVisibilityService, 'evaluate'>>;
  let questions: Mocked<Pick<QuestionsService, 'findByIds' | 'findUnits' | 'findUnitsByQuestionIds' | 'renderUnits'>>;
  let service: QuestionAccessService;

  beforeEach(() => {
    repository = { findQuestionIdsInUserSessions: vi.fn().mockResolvedValue([]) };
    associations = { findAssociatedQuestionIds: vi.fn().mockResolvedValue([]) };
    visibility = { evaluate: vi.fn() };
    questions = {
      findByIds: vi.fn(),
      findUnits: vi.fn().mockResolvedValue([{ root: material, questions: subs }]),
      findUnitsByQuestionIds: vi.fn(),
      renderUnits: vi.fn().mockImplementation(async (units, _viewer, options) => ({
        units: units.map(({ root, questions: items }: { root: Question; questions: Question[] }) =>
          Object.assign(new PublicQuestionUnitDto(), toPublicQuestion(root), {
            ...(root.type === QuestionType.MATERIAL && { children: items.map((item) => toPublicQuestion(item)) }),
          }),
        ),
        solutions: new Map(
          [...(options.solutionIds ?? [])].map((id) => [id as string, solution(`${id as string} 解析`)]),
        ),
      })),
    };
    service = new QuestionAccessService(
      repository as unknown as PracticeSessionRepository,
      associations,
      visibility as unknown as AnswerVisibilityService,
      questions as unknown as QuestionsService,
    );
  });

  it('should attach solutions to visible sub questions only and keep the material root without one', async () => {
    questions.findByIds.mockResolvedValue([material]);
    repository.findQuestionIdsInUserSessions.mockResolvedValue(['c1', 'c2']);
    visibility.evaluate.mockResolvedValue([
      { visible: true, hiddenReason: null },
      { visible: false, hiddenReason: null },
    ]);

    const dto = await service.getQuestion(USER, 'm');

    expect(visibility.evaluate).toHaveBeenCalledWith(
      USER,
      [
        { questionId: 'c1', questionType: QuestionType.SINGLE },
        { questionId: 'c2', questionType: QuestionType.SINGLE },
      ],
      'standalone',
    );
    expect(dto).toMatchObject({ id: 'm', solution: null, hiddenReason: null });
    expect(dto.children).toEqual([
      expect.objectContaining({ id: 'c1', solution: solution('c1 解析') }),
      expect.objectContaining({ id: 'c2', solution: null }),
    ]);
  });

  it('should only include sub questions related through sessions or associations', async () => {
    questions.findByIds.mockResolvedValue([material]);
    associations.findAssociatedQuestionIds.mockResolvedValue(['c2']);
    visibility.evaluate.mockResolvedValue([{ visible: true, hiddenReason: null }]);

    const dto = await service.getQuestion(USER, 'm');

    expect(associations.findAssociatedQuestionIds).toHaveBeenCalledWith(USER, ['c1', 'c2']);
    expect(dto.children?.map((child) => child.id)).toEqual(['c2']);
  });

  it('should withhold the solution and report the hidden reason during an ongoing mock', async () => {
    const single = question('q1');
    questions.findByIds.mockResolvedValue([single]);
    questions.findUnitsByQuestionIds.mockResolvedValue([{ root: single, questions: [single] }]);
    associations.findAssociatedQuestionIds.mockResolvedValue(['q1']);
    visibility.evaluate.mockResolvedValue([{ visible: false, hiddenReason: HiddenReason.MOCK_IN_PROGRESS }]);

    const dto = await service.getQuestion(USER, 'q1');

    expect(dto).toMatchObject({ id: 'q1', solution: null, hiddenReason: HiddenReason.MOCK_IN_PROGRESS });
    expect(dto.children).toBeUndefined();
  });

  it('should reject unknown or unrelated questions', async () => {
    questions.findByIds.mockResolvedValue([]);
    await expect(service.getQuestion(USER, 'x')).rejects.toMatchObject({ errorKey: 'questionNotAccessible' });

    const single = question('q1');
    questions.findByIds.mockResolvedValue([single]);
    questions.findUnitsByQuestionIds.mockResolvedValue([{ root: single, questions: [single] }]);
    await expect(service.getQuestion(USER, 'q1')).rejects.toMatchObject({ errorKey: 'questionNotAccessible' });
    expect(visibility.evaluate).not.toHaveBeenCalled();
  });
});
