import { ApiExtension } from '@nestjs/swagger';
import type { ContentObject, OpenAPIObject, RequestBodyObject } from '@nestjs/swagger';

const REQUEST_BODY_CONTENT_EXTENSION = 'x-request-body-content';

/** 按 Content-Type 分别声明请求体 schema，需在生成文档后调用 applyRequestBodyContent */
export const ApiRequestBodyContent = (content: ContentObject): MethodDecorator & ClassDecorator =>
  ApiExtension(REQUEST_BODY_CONTENT_EXTENSION, content);

export function applyRequestBodyContent(document: OpenAPIObject): OpenAPIObject {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem) as Record<string, unknown>[]) {
      const content = operation?.[REQUEST_BODY_CONTENT_EXTENSION] as ContentObject | undefined;
      if (!content) {
        continue;
      }
      delete operation[REQUEST_BODY_CONTENT_EXTENSION];
      operation.requestBody = { ...(operation.requestBody as RequestBodyObject | undefined), content };
    }
  }
  return document;
}
