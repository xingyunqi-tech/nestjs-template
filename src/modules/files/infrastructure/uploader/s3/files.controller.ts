import { Controller, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesS3Service } from './files.service';
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
export class FilesS3Controller {
  constructor(private readonly filesService: FilesS3Service) {}

  @ApiCreatedResponse({
    type: FileResponseDto,
  })
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
    @UploadedFile() file: Express.MulterS3.File,
    @Query() query: UploadFileQueryDto,
    @Request() request: RequestWithUser,
  ): Promise<FileResponseDto> {
    return this.filesService.create(file, Number(request.user.id), query.purpose);
  }
}
