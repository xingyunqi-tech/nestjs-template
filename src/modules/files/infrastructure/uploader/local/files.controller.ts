import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  Response,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesLocalService } from './files.service';
import { FileResponseDto } from './dto/file-response.dto';
import { FileUploadPurposeGuard } from '../../../file-upload-purpose.guard';
import { FileTooLargeInterceptor } from '../../../file-too-large.interceptor';
import { UploadFileQueryDto } from '../../../dto/upload-file-query.dto';
import type { RequestWithUser } from '../../../../../common/types/request-with-user.type';

@ApiTags('Files')
@Controller({
  path: 'files',
  version: '1',
})
export class FilesLocalController {
  constructor(private readonly filesService: FilesLocalService) {}

  @ApiCreatedResponse({
    type: FileResponseDto,
  })
  @ApiOperation({ operationId: 'uploadFile', summary: '上传文件' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), FileUploadPurposeGuard)
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileTooLargeInterceptor, FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadFileQueryDto,
    @Request() request: RequestWithUser,
  ): Promise<FileResponseDto> {
    return this.filesService.create(file, Number(request.user.id), query.purpose);
  }

  @Get(':path')
  @ApiExcludeEndpoint()
  async download(@Param('path') path: string, @Response() response: import('express').Response): Promise<void> {
    const file = await this.filesService.findPublicByFileName(path);
    if (!file) {
      throw new NotFoundException({ error: 'fileNotFound' });
    }
    response.sendFile(path, { root: './files' });
  }
}
