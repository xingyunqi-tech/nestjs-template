import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AiConversationsService } from './ai-conversations.service';
import { AiChatService } from './ai-chat.service';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiSseResponder } from './ai-sse.responder';
import { CreateAiConversationDto } from './dto/create-ai-conversation.dto';
import { SendAiMessageDto } from './dto/send-ai-message.dto';
import { QueryAiConversationsDto } from './dto/query-ai-conversations.dto';
import { QueryAiMessageEventsDto, QueryAiMessagesDto } from './dto/query-ai-messages.dto';
import { AiConversationDto } from './dto/ai-conversation.dto';
import { AiMessageDto, AiMessagePageDto } from './dto/ai-message.dto';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { RequirePermissions } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { SkipResponseTransform } from '../../common/decorators/skip-response-transform.decorator';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

const SSE_DESCRIPTION =
  'SSE 事件：message.start { messageId }、reasoning.delta { text }、answer.delta { text }、suggestions { items }、' +
  'message.done { status, usage }、error { code, message }；事件带 id 时可用于续读';

@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'ai', version: '1' })
export class AiController {
  constructor(
    private readonly conversationsService: AiConversationsService,
    private readonly chatService: AiChatService,
    private readonly streamService: AiMessageStreamService,
    private readonly sseResponder: AiSseResponder,
  ) {}

  @ApiOperation({
    operationId: 'createAiConversation',
    summary: '创建讲题会话：校验前置条件与答案可见性，同一题同一版本复用会话',
  })
  @ApiOkResponse({ type: AiConversationDto })
  @RequirePermissions(Permission.AI_CHAT)
  @UseGuards(PermissionsGuard)
  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  createConversation(
    @Request() request: RequestWithUser,
    @Body() dto: CreateAiConversationDto,
  ): Promise<AiConversationDto> {
    return this.conversationsService.create(Number(request.user.id), dto);
  }

  @ApiOperation({ operationId: 'getAiConversations', summary: '历史会话，按更新时间倒序' })
  @ApiOkResponse({ type: PaginationResponse(AiConversationDto) })
  @Get('conversations')
  @HttpCode(HttpStatus.OK)
  async findConversations(
    @Request() request: RequestWithUser,
    @Query() query: QueryAiConversationsDto,
  ): Promise<PaginationResponseDto<AiConversationDto>> {
    const { data, total, paginationOptions } = await this.conversationsService.findMany(Number(request.user.id), query);
    return pagination(data, total, paginationOptions);
  }

  @ApiOperation({ operationId: 'getAiMessages', summary: '会话消息，按时间升序分页向前加载' })
  @ApiOkResponse({ type: AiMessagePageDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  findMessages(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: QueryAiMessagesDto,
  ): Promise<AiMessagePageDto> {
    return this.conversationsService.findMessages(Number(request.user.id), id, query);
  }

  @ApiOperation({
    operationId: 'sendAiMessage',
    summary: '发送消息并以 SSE 返回回答；连接断开不影响生成，可按 messageId 续读或拉取',
    description: SSE_DESCRIPTION,
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: SSE_DESCRIPTION })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @RequirePermissions(Permission.AI_CHAT)
  @UseGuards(PermissionsGuard)
  @SkipResponseTransform()
  @Post('conversations/:id/messages')
  async sendMessage(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SendAiMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    const { messageId } = await this.chatService.send(Number(request.user.id), id, dto);
    await this.sseResponder.send(response, (signal) => this.streamService.follow(messageId, '0', signal));
  }

  @ApiOperation({ operationId: 'deleteAiConversation', summary: '删除会话及其消息，生成中的回答先停止' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Delete('conversations/:id')
  @HttpCode(HttpStatus.OK)
  removeConversation(@Request() request: RequestWithUser, @Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.conversationsService.remove(Number(request.user.id), id);
  }

  @ApiOperation({ operationId: 'getAiMessage', summary: '拉取单条回答（断线后恢复），生成中时返回已下发的内容' })
  @ApiOkResponse({ type: AiMessageDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get('messages/:id')
  @HttpCode(HttpStatus.OK)
  getMessage(@Request() request: RequestWithUser, @Param('id', ParseUuidPipe) id: string): Promise<AiMessageDto> {
    return this.conversationsService.getMessage(Number(request.user.id), id);
  }

  @ApiOperation({
    operationId: 'getAiMessageEvents',
    summary: '按 SSE 续读回答事件：从 after 之后继续，事件流过期时从头读取会按已保存的结果补发',
    description: SSE_DESCRIPTION,
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: SSE_DESCRIPTION })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SkipResponseTransform()
  @Get('messages/:id/events')
  async followMessage(
    @Request() request: RequestWithUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: QueryAiMessageEventsDto,
    @Res() response: Response,
  ): Promise<void> {
    const message = await this.conversationsService.findReadableAssistantMessage(Number(request.user.id), id);
    await this.sseResponder.send(response, (signal) =>
      this.streamService.follow(message.id, query.after ?? '0', signal),
    );
  }

  @ApiOperation({ operationId: 'stopAiMessage', summary: '停止生成，已下发的内容以 STOPPED 保存；已结束时不做处理' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Post('messages/:id/stop')
  @HttpCode(HttpStatus.OK)
  stopMessage(@Request() request: RequestWithUser, @Param('id', ParseUuidPipe) id: string): Promise<void> {
    return this.chatService.stop(Number(request.user.id), id);
  }
}
