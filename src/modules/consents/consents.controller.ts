import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConsentsService } from './consents.service';
import { AgreeConsentDto } from './dto/agree-consent.dto';
import { ConsentStatusDto } from './dto/consent-status.dto';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiTags('Consents')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'me/consents', version: '1' })
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @ApiOperation({ operationId: 'getMyConsents', summary: '各协议当前版本与同意状态' })
  @ApiOkResponse({ type: [ConsentStatusDto] })
  @Get()
  @HttpCode(HttpStatus.OK)
  findMine(@Request() request: RequestWithUser): Promise<ConsentStatusDto[]> {
    return this.consentsService.findStatus(Number(request.user.id));
  }

  @ApiOperation({ operationId: 'agreeConsent', summary: '同意协议的当前版本，重复同意同一版本保留首次记录' })
  @ApiOkResponse({ type: ConsentStatusDto })
  @Post()
  @HttpCode(HttpStatus.OK)
  agree(
    @Request() request: RequestWithUser,
    @Body() dto: AgreeConsentDto,
    @Ip() ip: string | undefined,
  ): Promise<ConsentStatusDto> {
    return this.consentsService.agree(Number(request.user.id), dto, ip ?? null);
  }
}
