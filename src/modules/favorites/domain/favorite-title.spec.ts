import { questionTitle } from './favorite-title';

describe('questionTitle', () => {
  it('should replace images, collapse whitespace and truncate to 200 characters', () => {
    expect(questionTitle('  下图\n![示意](file:abc)  中\t哪项正确 ')).toBe('下图 [图片] 中 哪项正确');
    expect(questionTitle('题'.repeat(300))).toHaveLength(200);
  });
});
