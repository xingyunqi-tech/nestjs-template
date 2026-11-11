import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Request,
  Post,
  UseGuards,
  Put,
  Delete,
  Param,
  SerializeOptions,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthEmailLoginDto } from './dto/auth-email-login.dto';
import { AuthForgotPasswordDto } from './dto/auth-forgot-password.dto';
import { AuthConfirmEmailDto } from './dto/auth-confirm-email.dto';
import { AuthResetPasswordDto } from './dto/auth-reset-password.dto';
import { AuthUpdateDto } from './dto/auth-update.dto';
import { AuthDeleteAccountDto } from './dto/auth-delete-account.dto';
import { AuthGuard } from '@nestjs/passport';
import { AuthRegisterLoginDto } from './dto/auth-register-login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { NullableType } from '../../common/types/nullable.type';
import { User } from '../users/domain/user';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import type { RequestWithUser, RequestWithRefreshUser } from '../../common/types/request-with-user.type';
import { AuthPhoneLoginDto } from './dto/auth-phone-login.dto';
import { AuthPhoneSmsLoginDto } from './dto/auth-phone-sms-login.dto';
import { AuthPhoneRegisterDto } from './dto/auth-phone-register.dto';
import { AuthSendCodeDto } from './dto/auth-send-code.dto';
import { AuthChangePasswordDto } from './dto/auth-change-password.dto';
import { SmsCodeType } from '../../integrations/sms/sms.service';
import { AuthWechatLoginDto } from './dto/auth-wechat-login.dto';
import { AuthWechatPhoneLoginDto } from './dto/auth-wechat-phone-login.dto';
import { AuthAlipayLoginDto } from './dto/auth-alipay-login.dto';
import { AuthPhoneResetPasswordDto } from './dto/auth-phone-reset-password.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';

@ApiTags('Auth')
@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('email/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ operationId: 'loginWithEmail', summary: '邮箱登录' })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  public login(@Body() loginDto: AuthEmailLoginDto): Promise<LoginResponseDto> {
    return this.service.validateLogin(loginDto);
  }

  @Post('email/register')
  @ApiOperation({ operationId: 'registerWithEmail', summary: '邮箱注册' })
  @HttpCode(HttpStatus.OK)
  async register(@Body() createUserDto: AuthRegisterLoginDto): Promise<void> {
    return this.service.register(createUserDto);
  }

  @Post('email/confirm')
  @ApiOperation({ operationId: 'confirmEmail', summary: '确认邮箱' })
  @HttpCode(HttpStatus.OK)
  async confirmEmail(@Body() confirmEmailDto: AuthConfirmEmailDto): Promise<void> {
    return this.service.confirmEmail(confirmEmailDto.hash);
  }

  @Post('email/confirm/new')
  @ApiOperation({ operationId: 'confirmNewEmail', summary: '确认新邮箱' })
  @HttpCode(HttpStatus.OK)
  async confirmNewEmail(@Body() confirmEmailDto: AuthConfirmEmailDto): Promise<void> {
    return this.service.confirmNewEmail(confirmEmailDto.hash);
  }

  @Post('forgot/password')
  @Throttle({ default: { limit: 3, ttl: 300000 } })
  @ApiOperation({ operationId: 'forgotPassword', summary: '忘记密码' })
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotPasswordDto: AuthForgotPasswordDto): Promise<void> {
    return this.service.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset/password')
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @ApiOperation({ operationId: 'resetPassword', summary: '重置密码' })
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() resetPasswordDto: AuthResetPasswordDto): Promise<void> {
    return this.service.resetPassword(resetPasswordDto.hash, resetPasswordDto.password);
  }

  @ApiBearerAuth()
  @SerializeOptions({
    groups: ['me'],
  })
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ operationId: 'getCurrentUser', summary: '获取当前用户信息' })
  @ApiOkResponse({
    type: User,
  })
  @HttpCode(HttpStatus.OK)
  public me(@Request() request: RequestWithUser): Promise<NullableType<User>> {
    return this.service.me(request.user);
  }

  @ApiBearerAuth()
  @ApiOkResponse({
    type: RefreshResponseDto,
  })
  @SerializeOptions({
    groups: ['me'],
  })
  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiOperation({ operationId: 'refreshToken', summary: '刷新令牌' })
  @HttpCode(HttpStatus.OK)
  public refresh(@Request() request: RequestWithRefreshUser): Promise<RefreshResponseDto> {
    return this.service.refreshToken({
      sessionId: request.user.sessionId,
      hash: request.user.hash,
    });
  }

  @ApiBearerAuth()
  @Get('sessions')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ operationId: 'getMySessions', summary: '当前用户的登录设备' })
  @ApiOkResponse({ type: SessionResponseDto, isArray: true })
  @HttpCode(HttpStatus.OK)
  public getSessions(@Request() request: RequestWithUser): Promise<SessionResponseDto[]> {
    return this.service.listSessions(request.user);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ operationId: 'revokeMySession', summary: '下线指定设备' })
  @ApiOkResponse({ description: '已下线' })
  @HttpCode(HttpStatus.OK)
  public revokeSession(@Request() request: RequestWithUser, @Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.service.revokeSession(request.user, id);
  }

  @ApiBearerAuth()
  @Post('sessions/revoke-others')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ operationId: 'revokeOtherSessions', summary: '下线其他设备' })
  @ApiOkResponse({ description: '已下线' })
  @HttpCode(HttpStatus.OK)
  public revokeOtherSessions(@Request() request: RequestWithUser): Promise<void> {
    return this.service.revokeOtherSessions(request.user);
  }

  @ApiBearerAuth()
  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ operationId: 'logout', summary: '退出登录' })
  @ApiOkResponse({ description: '退出登录成功' })
  @HttpCode(HttpStatus.OK)
  public async logout(@Request() request: RequestWithUser): Promise<void> {
    await this.service.logout({
      sessionId: request.user.sessionId,
    });
  }

  @ApiBearerAuth()
  @SerializeOptions({
    groups: ['me'],
  })
  @Put('me')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ operationId: 'updateCurrentUser', summary: '更新当前用户信息' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: User,
  })
  public update(@Request() request: RequestWithUser, @Body() userDto: AuthUpdateDto): Promise<NullableType<User>> {
    return this.service.update(request.user, userDto);
  }

  @ApiBearerAuth()
  @Delete('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ operationId: 'deleteCurrentUser', summary: '删除当前用户账号' })
  @HttpCode(HttpStatus.OK)
  public async delete(@Request() request: RequestWithUser, @Body() dto: AuthDeleteAccountDto): Promise<void> {
    return this.service.softDelete(request.user, dto);
  }

  @Post('phone/send-code')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ operationId: 'sendSmsCode', summary: '发送短信验证码' })
  @HttpCode(HttpStatus.OK)
  async sendCode(@Body() sendCodeDto: AuthSendCodeDto): Promise<void> {
    return this.service.sendCode(sendCodeDto.phone, sendCodeDto.type ?? SmsCodeType.LOGIN);
  }

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('phone/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ operationId: 'loginWithPhone', summary: '手机号密码登录' })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  public phoneLogin(@Body() loginDto: AuthPhoneLoginDto): Promise<LoginResponseDto> {
    return this.service.validatePhoneLogin(loginDto);
  }

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('phone/sms-login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ operationId: 'loginWithSms', summary: '短信验证码登录' })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  public phoneSmsLogin(@Body() loginDto: AuthPhoneSmsLoginDto): Promise<LoginResponseDto> {
    return this.service.validatePhoneSmsLogin(loginDto);
  }

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('phone/register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ operationId: 'registerWithPhone', summary: '手机号注册' })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  public phoneRegister(@Body() registerDto: AuthPhoneRegisterDto): Promise<LoginResponseDto> {
    return this.service.registerByPhone(registerDto);
  }

  @Post('phone/reset-password')
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @ApiOperation({ operationId: 'resetPasswordByPhone', summary: '通过手机验证码重置密码' })
  @HttpCode(HttpStatus.OK)
  public async resetPasswordByPhone(@Body() resetPasswordDto: AuthPhoneResetPasswordDto): Promise<void> {
    return this.service.resetPasswordByPhone(resetPasswordDto.phone, resetPasswordDto.code, resetPasswordDto.password);
  }

  @ApiBearerAuth()
  @Put('password')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ operationId: 'changePassword', summary: '修改密码' })
  @HttpCode(HttpStatus.OK)
  public async changePassword(
    @Request() request: RequestWithUser,
    @Body() changePasswordDto: AuthChangePasswordDto,
  ): Promise<void> {
    return this.service.changePassword(request.user, changePasswordDto.oldPassword, changePasswordDto.newPassword);
  }

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('wechat/login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ operationId: 'loginWithWechat', summary: '微信登录' })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  public wechatLogin(@Body() loginDto: AuthWechatLoginDto): Promise<LoginResponseDto> {
    return this.service.wechatLogin(loginDto);
  }

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('wechat/phone-login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ operationId: 'loginWithWechatPhone', summary: '微信手机号快捷登录（小程序）' })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  public wechatPhoneLogin(@Body() loginDto: AuthWechatPhoneLoginDto): Promise<LoginResponseDto> {
    return this.service.wechatPhoneLogin(loginDto);
  }

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('alipay/login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ operationId: 'loginWithAlipay', summary: '支付宝登录（小程序）' })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  public alipayLogin(@Body() loginDto: AuthAlipayLoginDto): Promise<LoginResponseDto> {
    return this.service.alipayLogin(loginDto);
  }
}
