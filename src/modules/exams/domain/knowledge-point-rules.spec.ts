import {
  checkCanAddChild,
  checkCanMigrate,
  checkCanMove,
  checkCanRemove,
  KnowledgePointViolation,
  knowledgePointPath,
} from './knowledge-point-rules';

const node = (overrides: Partial<{ subjectId: string; path: string; level: number; questionCount: number }> = {}) => ({
  subjectId: 's1',
  path: '/a/',
  level: 1,
  questionCount: 0,
  ...overrides,
});

describe('knowledge point rules', () => {
  it('should build the path from the parent path', () => {
    expect(knowledgePointPath(null, 'a')).toBe('/a/');
    expect(knowledgePointPath('/a/', 'b')).toBe('/a/b/');
  });

  describe('checkCanAddChild', () => {
    it('should allow a child under a level 2 node without questions', () => {
      expect(checkCanAddChild({ level: 2, questionCount: 0 }, 0)).toBeNull();
    });

    it('should reject a child under a node with questions', () => {
      expect(checkCanAddChild({ level: 1, questionCount: 3 }, 0)).toBe(KnowledgePointViolation.HAS_QUESTIONS);
    });

    it('should reject a child under a node with unpublished linked questions', () => {
      expect(checkCanAddChild({ level: 1, questionCount: 0 }, 1)).toBe(KnowledgePointViolation.HAS_QUESTIONS);
    });

    it('should reject a fourth level', () => {
      expect(checkCanAddChild({ level: 3, questionCount: 0 }, 0)).toBe(KnowledgePointViolation.TOO_DEEP);
    });
  });

  describe('checkCanMove', () => {
    it('should allow moving a two level subtree under a root node', () => {
      expect(checkCanMove(node({ path: '/a/' }), 2, node({ path: '/b/' }), 0)).toBeNull();
    });

    it('should allow moving to the root', () => {
      expect(checkCanMove(node({ path: '/b/a/', level: 2 }), 3, null, 0)).toBeNull();
    });

    it('should reject a parent in another subject', () => {
      expect(checkCanMove(node(), 1, node({ subjectId: 's2', path: '/b/' }), 0)).toBe(
        KnowledgePointViolation.INVALID_PARENT,
      );
    });

    it('should reject moving under itself or a descendant', () => {
      expect(checkCanMove(node(), 2, node({ path: '/a/' }), 0)).toBe(KnowledgePointViolation.INVALID_PARENT);
      expect(checkCanMove(node(), 2, node({ path: '/a/c/', level: 2 }), 0)).toBe(
        KnowledgePointViolation.INVALID_PARENT,
      );
    });

    it('should reject a parent with questions', () => {
      expect(checkCanMove(node(), 1, node({ path: '/b/', questionCount: 1 }), 0)).toBe(
        KnowledgePointViolation.HAS_QUESTIONS,
      );
    });

    it('should reject a parent with unpublished linked questions', () => {
      expect(checkCanMove(node(), 1, node({ path: '/b/' }), 2)).toBe(KnowledgePointViolation.HAS_QUESTIONS);
    });

    it('should reject when the subtree would exceed three levels', () => {
      expect(checkCanMove(node(), 2, node({ path: '/b/c/', level: 2 }), 0)).toBe(KnowledgePointViolation.TOO_DEEP);
    });
  });

  describe('checkCanRemove', () => {
    it('should allow removing a leaf without questions', () => {
      expect(checkCanRemove({ isLeaf: true, questionCount: 0 }, 0)).toBeNull();
    });

    it('should reject a node with children', () => {
      expect(checkCanRemove({ isLeaf: false, questionCount: 0 }, 0)).toBe(KnowledgePointViolation.HAS_CHILDREN);
    });

    it('should reject a node with published or linked questions', () => {
      expect(checkCanRemove({ isLeaf: true, questionCount: 2 }, 0)).toBe(KnowledgePointViolation.HAS_QUESTIONS);
      expect(checkCanRemove({ isLeaf: true, questionCount: 0 }, 1)).toBe(KnowledgePointViolation.HAS_QUESTIONS);
    });
  });

  describe('checkCanMigrate', () => {
    const source = { id: 'a', subjectId: 's1' };

    it('should allow another leaf of the same subject', () => {
      expect(checkCanMigrate(source, { id: 'b', subjectId: 's1', isLeaf: true })).toBeNull();
    });

    it('should reject a missing target, the source itself or another subject', () => {
      expect(checkCanMigrate(source, null)).toBe(KnowledgePointViolation.INVALID_MIGRATION_TARGET);
      expect(checkCanMigrate(source, { id: 'a', subjectId: 's1', isLeaf: true })).toBe(
        KnowledgePointViolation.INVALID_MIGRATION_TARGET,
      );
      expect(checkCanMigrate(source, { id: 'b', subjectId: 's2', isLeaf: true })).toBe(
        KnowledgePointViolation.INVALID_MIGRATION_TARGET,
      );
    });

    it('should reject a non-leaf target', () => {
      expect(checkCanMigrate(source, { id: 'b', subjectId: 's1', isLeaf: false })).toBe(
        KnowledgePointViolation.MIGRATION_TARGET_NOT_LEAF,
      );
    });
  });
});
