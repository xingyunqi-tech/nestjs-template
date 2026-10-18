import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  HttpStatus,
  HttpCode,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FeedbacksService } from './feedbacks.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { QueryFeedbackDto } from './dto/query-feedback.dto';
import { Feedback, USER_QUERYABLE_FEEDBACK_TYPES } from './domain/feedback';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiTags('Feedbacks')
@Controller({
  path: 'feedbacks',
  version: '1',
})
export class FeedbacksController {
  constructor(private readonly feedbacksService: FeedbacksService) {}

  @ApiCreatedResponse({ type: Feedback })
  @ApiOperation({ operationId: 'createFeedback', summary: '提交反馈' })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Request() request: RequestWithUser, @Body() createFeedbackDto: CreateFeedbackDto): Promise<Feedback> {
    return this.feedbacksService.create(request.user.id, createFeedbackDto);
  }

  @ApiOkResponse({ type: PaginationResponse(Feedback) })
  @ApiOperation({ operationId: 'getFeedbacks', summary: '获取反馈列表' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Request() request: RequestWithUser,
    @Query() query: QueryFeedbackDto,
  ): Promise<PaginationResponseDto<Feedback>> {
    const page = query?.page ?? 1;
    let limit = query?.limit ?? 10;
    if (limit > 50) {
      limit = 50;
    }

    const { data, total } = await this.feedbacksService.findManyWithPaginationAndCount({
      userId: request.user.id,
      type: query?.type,
      status: query?.status,
      paginationOptions: { page, limit },
    });

    return pagination(data, total, { page, limit });
  }

  @ApiOkResponse({ type: Feedback })
  @ApiOperation({ operationId: 'getFeedback', summary: '获取反馈详情' })
  @Get(':id')
  @ApiParam({ name: 'id', type: Number, required: true })
  @HttpCode(HttpStatus.OK)
  async findOne(@Request() request: RequestWithUser, @Param('id', ParseIdPipe) id: number): Promise<Feedback> {
    const feedback = await this.feedbacksService.findById(id);

    if (
      feedback?.userId?.toString() !== request.user.id.toString() ||
      !USER_QUERYABLE_FEEDBACK_TYPES.includes(feedback.type)
    ) {
      throw new NotFoundException({
        error: 'feedbackNotFound',
      });
    }

    return feedback;
  }
}
