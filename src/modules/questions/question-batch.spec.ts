import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { batchErrorKeyOf, toBatchFailure } from './question-batch';
import { BusinessException } from '../../common/exceptions/business.exception';

describe('batchErrorKeyOf', () => {
  it.each([
    ['an error code', new ConflictException({ error: 'invalidStatusTransition' }), 'invalidStatusTransition'],
    [
      'an error code with details',
      new ForbiddenException({ error: 'selfReviewForbidden', errors: { questionIds: ['q1'] } }),
      'selfReviewForbidden',
    ],
    ['a business error', new BusinessException('answerChangeNotAllowed'), 'answerChangeNotAllowed'],
    [
      'a field error',
      new UnprocessableEntityException({ errors: { knowledgePointIds: 'invalidKnowledgePoint' } }),
      'invalidKnowledgePoint',
    ],
    ['a bare http error', new NotFoundException(), 'notFound'],
    ['an unexpected error', new Error('deadlock detected'), 'internalServerError'],
  ])('should use %s', (_case, error, key) => {
    expect(batchErrorKeyOf(error)).toBe(key);
  });
});

describe('toBatchFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should translate the error key with the request language', () => {
    const t = vi.fn((key: string) => (key === 'common.selfReviewForbidden' ? '不能审核自己创建或提交的题目' : key));
    vi.spyOn(I18nContext, 'current').mockReturnValue({ t } as unknown as I18nContext);

    expect(toBatchFailure('q1', new ForbiddenException({ error: 'selfReviewForbidden' }))).toEqual({
      id: 'q1',
      error: 'selfReviewForbidden',
      message: '不能审核自己创建或提交的题目',
    });
  });

  it('should fall back to the error key without a translation', () => {
    vi.spyOn(I18nContext, 'current').mockReturnValue(undefined);

    expect(toBatchFailure('q1', new ConflictException({ error: 'questionInUse' }))).toEqual({
      id: 'q1',
      error: 'questionInUse',
      message: 'questionInUse',
    });
  });
});
