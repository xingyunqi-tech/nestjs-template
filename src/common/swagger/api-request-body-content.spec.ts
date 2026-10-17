import { Body, Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiConsumes, ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiRequestBodyContent, applyRequestBodyContent } from './api-request-body-content';

class UploadDto {
  @ApiProperty({ type: String })
  name: string;
}

@Controller('uploads')
class UploadsController {
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiRequestBodyContent({
    'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } },
    'application/json': { schema: { type: 'object', properties: { fileId: { type: 'string' } } } },
  })
  @Post()
  create(@Body() dto: UploadDto): UploadDto {
    return dto;
  }

  @Post('plain')
  plain(@Body() dto: UploadDto): UploadDto {
    return dto;
  }
}

describe('applyRequestBodyContent', () => {
  it('should declare a separate request body schema per content type', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [UploadsController] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const document = applyRequestBodyContent(SwaggerModule.createDocument(app, new DocumentBuilder().build()));
    const operation = document.paths['/uploads'].post!;

    expect(operation.requestBody).toEqual({
      required: true,
      content: {
        'multipart/form-data': {
          schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
        },
        'application/json': { schema: { type: 'object', properties: { fileId: { type: 'string' } } } },
      },
    });
    expect(operation).not.toHaveProperty('x-request-body-content');
    expect(document.paths['/uploads/plain'].post!.requestBody).toEqual({
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/UploadDto' } } },
    });
    await app.close();
  });
});
