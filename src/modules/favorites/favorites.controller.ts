import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  HttpStatus,
  HttpCode,
  Request,
} from '@nestjs/common';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FavoritesService } from './favorites.service';
import { FavoriteTargetsService } from './favorite-targets.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { QueryFavoriteDto } from './dto/query-favorite.dto';
import { CheckFavoriteDto, CheckFavoriteResponseDto } from './dto/check-favorite.dto';
import { Favorite } from './domain/favorite';
import { FavoriteItemDto } from './dto/favorite-item.dto';
import { PaginationResponse, PaginationResponseDto } from '../../common/dto/pagination-response.dto';
import { pagination } from '../../common/pagination';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiTags('Favorites')
@Controller({
  path: 'favorites',
  version: '1',
})
export class FavoritesController {
  constructor(
    private readonly favoritesService: FavoritesService,
    private readonly favoriteTargetsService: FavoriteTargetsService,
  ) {}

  @ApiCreatedResponse({ type: Favorite })
  @ApiOperation({
    operationId: 'createFavorite',
    summary: '添加收藏；题目、试卷由服务端校验并写入标题快照与科目，忽略传入的 title、image',
  })
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Request() request: RequestWithUser, @Body() createFavoriteDto: CreateFavoriteDto): Promise<Favorite> {
    return this.favoriteTargetsService.create(Number(request.user.id), createFavoriteDto);
  }

  @ApiOkResponse({ type: PaginationResponse(FavoriteItemDto) })
  @ApiOperation({ operationId: 'getFavorites', summary: '获取收藏列表，可按类型与科目筛选；题目、试卷附带下架状态' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Request() request: RequestWithUser,
    @Query() query: QueryFavoriteDto,
  ): Promise<PaginationResponseDto<FavoriteItemDto>> {
    const { data, total, paginationOptions } = await this.favoriteTargetsService.findPage(
      Number(request.user.id),
      query,
    );
    return pagination(data, total, paginationOptions);
  }

  @ApiOkResponse({ type: CheckFavoriteResponseDto })
  @ApiOperation({ operationId: 'checkFavorite', summary: '检查是否已收藏' })
  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(
    @Request() request: RequestWithUser,
    @Body() checkFavoriteDto: CheckFavoriteDto,
  ): Promise<CheckFavoriteResponseDto> {
    return this.favoritesService.check(request.user.id, checkFavoriteDto.targetType, checkFavoriteDto.targetId);
  }

  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        isFavorited: { type: 'boolean' },
        favorite: { $ref: '#/components/schemas/Favorite' },
      },
    },
  })
  @ApiOperation({ operationId: 'toggleFavorite', summary: '切换收藏状态' })
  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  toggle(
    @Request() request: RequestWithUser,
    @Body() createFavoriteDto: CreateFavoriteDto,
  ): Promise<{ isFavorited: boolean; favorite?: Favorite }> {
    return this.favoriteTargetsService.toggle(Number(request.user.id), createFavoriteDto);
  }

  @ApiOperation({ operationId: 'deleteFavorite', summary: '取消收藏' })
  @Delete(':id')
  @ApiParam({ name: 'id', type: Number, required: true })
  @HttpCode(HttpStatus.OK)
  remove(@Request() request: RequestWithUser, @Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.favoritesService.remove(id, request.user.id);
  }
}
