import { CompositeQuestionAssociationReader, QuestionAssociationSource } from './question-association.reader';

describe('CompositeQuestionAssociationReader', () => {
  const source = (
    hits: string[],
  ): QuestionAssociationSource & { findAssociatedQuestionIds: ReturnType<typeof vi.fn> } => ({
    findAssociatedQuestionIds: vi.fn((_userId: number, ids: string[]) =>
      Promise.resolve(ids.filter((id) => hits.includes(id))),
    ),
  });

  it('should union the hits of all sources in the requested order', async () => {
    const reader = new CompositeQuestionAssociationReader([source(['q3']), source(['q1'])]);

    await expect(reader.findAssociatedQuestionIds(7, ['q1', 'q2', 'q3'])).resolves.toEqual(['q1', 'q3']);
  });

  it('should pass only the remaining questions to later sources', async () => {
    const first = source(['q1']);
    const second = source(['q2']);
    const reader = new CompositeQuestionAssociationReader([first, second]);

    await reader.findAssociatedQuestionIds(7, ['q1', 'q2']);

    expect(second.findAssociatedQuestionIds).toHaveBeenCalledWith(7, ['q2']);
  });

  it('should skip later sources once every question is associated', async () => {
    const second = source([]);
    const reader = new CompositeQuestionAssociationReader([source(['q1']), second]);

    await expect(reader.findAssociatedQuestionIds(7, ['q1'])).resolves.toEqual(['q1']);
    expect(second.findAssociatedQuestionIds).not.toHaveBeenCalled();
  });
});
