import { KnowledgePoint } from './domain/knowledge-point';

type TreeNode<N> = N & { children: TreeNode<N>[] };

/** points 需按 level 升序排列，同级顺序即输出顺序 */
export function buildKnowledgePointTree<N extends object>(
  points: KnowledgePoint[],
  toNode: (point: KnowledgePoint) => N,
): TreeNode<N>[] {
  const nodes = new Map<string, TreeNode<N>>();
  const roots: TreeNode<N>[] = [];
  for (const point of points) {
    const node = Object.assign(toNode(point), { children: [] as TreeNode<N>[] });
    nodes.set(point.id, node);
    const parent = point.parentId ? nodes.get(point.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
