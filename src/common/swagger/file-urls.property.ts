import type { ApiPropertyOptions } from '@nestjs/swagger';

export const FILE_URLS_PROPERTY: ApiPropertyOptions = {
  type: 'object',
  additionalProperties: { type: 'string' },
  description: '内容中 file:{id} 引用与音频的访问地址，键为小写文件 id；文件不存在或无权访问时不含该键',
  example: { '11111111-1111-4111-8111-111111111111': 'https://cdn.example.com/a.png' },
};
