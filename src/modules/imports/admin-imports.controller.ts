import {
  applyDecorators,
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
  ApiConsumes,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { ImportPrecheckResult, ImportsService } from './imports.service';
import { DescribedImportRowError } from './error-report';
import { ImportLauncher } from './import-launcher';
import { ImportJob } from './domain/import-job';
import { CreateImportDto, CreateImportFileIdBodyDto, CreateImportUploadBodyDto } from './dto/create-import.dto';
import { QueryAdminImportDto } from './dto/query-admin-import.dto';
import { ImportPrecheckResultDto, ImportRowErrorDto } from './dto/import-precheck.dto';
import { QueryImportErrorsDto } from './dto/query-import-errors.dto';
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
import { ApiRequestBodyContent } from '../../common/swagger/api-request-body-content';
import { Auditable, AuditAction } from '../../infrastructure/audit';
import { IMPORT_PRECHECK_LIMITS } from './import.constants';

const ENTITY_TYPE = 'ImportJob';

const IMPORT_MAX_SIZE = (fileConfig() as FileConfig).maxSizes[FilePurpose.IMPORT];
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const importPackageInterceptor = FileInterceptor('file', {
  limits: { fileSize: IMPORT_MAX_SIZE },
  fileFilter: (_request, file, callback) =>
    purposeFileFilter({ query: { purpose: FilePurpose.IMPORT } }, file, callback),
});

const ImportPackageBody = (): MethodDecorator =>
  applyDecorators(
    ApiConsumes('multipart/form-data', 'application/json'),
    ApiExtraModels(CreateImportUploadBodyDto, CreateImportFileIdBodyDto),
    ApiRequestBodyContent({
      'multipart/form-data': { schema: { $ref: getSchemaPath(CreateImportUploadBodyDto) } },
      'application/json': { schema: { $ref: getSchemaPath(CreateImportFileIdBodyDto) } },
    }),
  );

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
  @ImportPackageBody()
  @ApiOkResponse({ type: ImportJob })
  @Auditable({ action: AuditAction.CREATE, entityType: ENTITY_TYPE, includeBody: false, includeResponse: true })
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileTooLargeInterceptor, importPackageInterceptor)
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

  @ApiOperation({
    operationId: 'adminPrecheckImport',
    summary: '预检导入包：同步解析与校验，返回将新建、更新、跳过的数量与错误行，不写入任何数据',
    description: `请求体与创建导入任务相同；publishOnImport 影响试卷能否引用本包新题，仅管理员可用。导入单元超过 ${IMPORT_PRECHECK_LIMITS.maxUnits} 个时返回 413（importPrecheckTooLarge）；导入包无法解析时返回 422，error 为导入包错误键`,
  })
  @ImportPackageBody()
  @ApiOkResponse({ type: ImportPrecheckResultDto })
  @ApiPayloadTooLargeResponse({ description: '导入包过大或导入单元过多' })
  @Post('precheck')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileTooLargeInterceptor, importPackageInterceptor)
  precheck(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateImportDto,
    @Request() request: RequestWithUser,
  ): Promise<ImportPrecheckResult> {
    return this.importsService.precheck(
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

  @ApiOperation({
    operationId: 'adminGetImportErrors',
    summary: '错误行明细（与错误行报告 xlsx 相同），任务无错误时为空列表',
  })
  @ApiOkResponse({ type: PaginationResponse(ImportRowErrorDto) })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id/errors.json')
  @HttpCode(HttpStatus.OK)
  async findErrors(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: QueryImportErrorsDto,
  ): Promise<PaginationResponseDto<DescribedImportRowError>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const { data, total } = await this.importsService.findErrors(id, { sheet: query.sheet, page, limit });
    return pagination(data, total, { page, limit });
  }

  @ApiOperation({ operationId: 'adminDownloadImportErrors', summary: '下载错误行报告（xlsx）' })
  @ApiOkResponse({
    description: '错误行报告文件',
    content: { [XLSX_MIME_TYPE]: { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id/errors')
  async downloadErrors(@Param('id', ParseUuidPipe) id: string, @Response() response: ExpressResponse): Promise<void> {
    const report = await this.importsService.getErrorReport(id);
    response.setHeader('Content-Type', report.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
    response.send(report.content);
  }
}
