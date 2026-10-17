import { Controller, Get, Param, ParseUUIDPipe, Request, Response, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { basename } from 'path';
import { FilesService } from './files.service';
import { LOCAL_FILES_ROOT } from './local-file-path';
import { buildFileUrl } from './file-url';
import { FileDriver } from './config/file-config.type';
import { AllConfigType } from '../../config/config.type';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Files')
@Controller({
  path: 'files',
  version: '1',
})
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** S3 驱动重定向到预签名 URL */
  @Get('private/:id')
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard('jwt'))
  async readPrivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() request: RequestWithUser,
    @Response() response: ExpressResponse,
  ): Promise<void> {
    const file = await this.filesService.findAccessible(id, request.user.id);
    if (this.configService.get('file.driver', { infer: true }) === FileDriver.LOCAL) {
      response.sendFile(basename(file.path), { root: LOCAL_FILES_ROOT });
      return;
    }
    response.redirect(await buildFileUrl(file));
  }
}
