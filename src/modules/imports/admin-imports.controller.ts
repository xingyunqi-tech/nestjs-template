import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  Response,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { ImportsService } from './imports.service';
import { ImportLauncher } from './import-launcher';
import { ImportJob } from './domain/import-job';
import { CreateImportDto } from './dto/create-import.dto';
import { QueryAdminImportDto } from './dto/query-admin-import.dto';
import fileConfig from '../files/config/file.config';
import { FileConfig } from '../files/config/file-config.type';
import { FilePurpose } from '../files/domain/file-purpose';
import { purposeFileFilter } from '../files/file-purposes';
import { FileTooLargeInterceptor } from '../files/file-too-large.interceptor';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

const IMPORT_MAX_SIZE = (fileConfig() as FileConfig).maxSizes[FilePurpose.IMPORT];

@ApiTags('Admin Imports')
@ApiBearerAuth()
@RequirePermissions(Permission.CONTENT_MANAGE)
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller({ path: 'admin/imports', version: '1' })
export class AdminImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly importLauncher: ImportLauncher,
  ) {}

  @ApiOperation({
    operationId: 'adminCreateImport',
    summary: '创建导入任务：传已上传导入包的 fileId，或直接上传 file（zip / xlsx / json）',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        fileId: { type: 'string', format: 'uuid' },
        publishOnImport: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ type: ImportJob })
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileTooLargeInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: IMPORT_MAX_SIZE },
      fileFilter: (_request, file, callback) =>
        purposeFileFilter({ query: { purpose: FilePurpose.IMPORT } }, file, callback),
    }),
  )
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateImportDto,
    @Request() request: RequestWithUser,
  ): Promise<ImportJob> {
    return this.importLauncher.launch(
      {
        fileId: dto.fileId,
        upload: file && { buffer: file.buffer, originalname: file.originalname },
        publishOnImport: dto.publishOnImport ?? false,
      },
      { id: Number(request.user.id), roleId: request.user.role?.id ?? null },
    );
  }

  @ApiOperation({ operationId: 'adminGetImports', summary: '导入任务列表' })
  @ApiOkResponse({ type: PaginationResponse(ImportJob) })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAdminImportDto): Promise<PaginationResponseDto<ImportJob>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.importsService.findManyWithPaginationAndCount({
      status: query.status,
      paginationOptions: { page, limit },
    });
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminGetImport', summary: '导入任务进度与统计' })
  @ApiOkResponse({ type: ImportJob })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id', ParseUuidPipe) id: string): Promise<ImportJob> {
    return this.importsService.findById(id);
  }

  @ApiOperation({ operationId: 'adminDownloadImportErrors', summary: '下载错误行报告（xlsx）' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id/errors')
  async downloadErrors(@Param('id', ParseUuidPipe) id: string, @Response() response: ExpressResponse): Promise<void> {
    const report = await this.importsService.getErrorReport(id);
    response.setHeader('Content-Type', report.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
    response.send(report.content);
  }
}
