import { Body, Controller, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesS3PresignedService } from './files.service';
import { FileUploadDto } from './dto/file.dto';
import { FileResponseDto } from './dto/file-response.dto';
import { FileUploadPurposeGuard } from '../../../file-upload-purpose.guard';
import { UploadFileQueryDto } from '../../../dto/upload-file-query.dto';
import type { RequestWithUser } from '../../../../../common/types/request-with-user.type';

@ApiTags('Files')
@Controller({
  path: 'files',
  version: '1',
})
export class FilesS3PresignedController {
  constructor(private readonly filesService: FilesS3PresignedService) {}

  @ApiCreatedResponse({
    type: FileResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), FileUploadPurposeGuard)
  @Post('upload')
  async uploadFile(
    @Body() file: FileUploadDto,
    @Query() query: UploadFileQueryDto,
    @Request() request: RequestWithUser,
  ): Promise<{ file: import('../../../domain/file').FileType; uploadSignedUrl: string }> {
    return this.filesService.create(file, Number(request.user.id), query.purpose);
  }
}
