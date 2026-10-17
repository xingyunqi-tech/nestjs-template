import { buildKnowledgePointTree } from './knowledge-point-tree';
import { KnowledgePoint } from './domain/knowledge-point';

const point = (id: string, parentId: string | null, level: number): KnowledgePoint =>
  Object.assign(new KnowledgePoint(), { id, parentId, level, name: id });

describe('buildKnowledgePointTree', () => {
  it('should nest children under their parents in input order', () => {
    const tree = buildKnowledgePointTree(
      [point('a', null, 1), point('b', null, 1), point('a1', 'a', 2), point('a2', 'a', 2), point('a1x', 'a1', 3)],
      (p) => ({ id: p.id }),
    );

    expect(tree).toEqual([
      {
        id: 'a',
        children: [
          { id: 'a1', children: [{ id: 'a1x', children: [] }] },
          { id: 'a2', children: [] },
        ],
      },
      { id: 'b', children: [] },
    ]);
  });
});
