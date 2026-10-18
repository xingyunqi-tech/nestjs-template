import {
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import ms from 'ms';
import { createHash } from 'crypto';
import { JwtService, TokenExpiredError, JsonWebTokenError } from '@nestjs/jwt';
import { hashPassword, compareMd5Password } from '../../common/utils/crypto.utils';
import { AuthEmailLoginDto } from './dto/auth-email-login.dto';
import { AuthUpdateDto } from './dto/auth-update.dto';
import { AuthDeleteAccountDto } from './dto/auth-delete-account.dto';
import { AuthProvidersEnum } from './auth-providers.enum';
import { AuthRegisterLoginDto } from './dto/auth-register-login.dto';
import { NullableType } from '../../common/types/nullable.type';
import { LoginResponseDto } from './dto/login-response.dto';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayloadType } from './strategies/types/jwt-refresh-payload.type';
import { JwtPayloadType } from './strategies/types/jwt-payload.type';
import { UsersService } from '../users/users.service';
import { AllConfigType } from '../../config/config.type';
import { MailService } from '../../integrations/mail/mail.service';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { SessionService } from '../session/session.service';
import { StatusEnum } from '../../common/enums/statuses/statuses.enum';
import { User } from '../users/domain/user';
import { SmsService, SmsCodeType } from '../../integrations/sms/sms.service';
import { AuthPhoneLoginDto } from './dto/auth-phone-login.dto';
import { AuthPhoneSmsLoginDto } from './dto/auth-phone-sms-login.dto';
import { AuthPhoneRegisterDto } from './dto/auth-phone-register.dto';
import { AuthWechatLoginDto, WechatLoginType } from './dto/auth-wechat-login.dto';
import { AuthWechatPhoneLoginDto } from './dto/auth-wechat-phone-login.dto';
import { AuthAlipayLoginDto } from './dto/auth-alipay-login.dto';
import { AlipayService } from '../../integrations/alipay/alipay.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { WechatService } from '../../integrations/wechat/wechat.service';
import { maskEmail, maskPhone } from '../../common/utils/sanitize.utils';
import { TokenService } from './services/token.service';
import { CredentialRepository } from './infrastructure/persistence/credential.repository';
import { isUniqueViolationOf } from '../../common/utils/exceptions.util';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { verifySmsCode, validateUserStatusForAuth } from './helpers/auth-validation.helper';

/** 密码哈希的指纹，写入重置密码令牌，密码变更后令牌失效 */
function passwordFingerprint(password?: string | null): string {
  return createHash('sha256')
    .update(password ?? '')
    .digest('hex')
    .slice(0, 16);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private sessionService: SessionService,
    private mailService: MailService,
    private configService: ConfigService<AllConfigType>,
    private smsService: SmsService,
    private wechatService: WechatService,
    private alipayService: AlipayService,
    private tokenService: TokenService,
    private notificationsService: NotificationsService,
    private credentialRepository: CredentialRepository,
  ) {}

  /**
   * 验证邮箱登录
   * @param loginDto - 邮箱登录数据传输对象
   * @returns 登录响应，包含用户信息和令牌
   * @throws UnprocessableEntityException 当邮箱不存在、密码错误或用户状态不允许登录时
   */
  async validateLogin(loginDto: AuthEmailLoginDto): Promise<LoginResponseDto> {
    this.logger.log(`Login attempt for email: ${maskEmail(loginDto.email)}`);
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      this.logger.warn(`Login failed - user not found: ${maskEmail(loginDto.email)}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: 'notFound',
        },
      });
    }

    if (!user.password) {
      this.logger.warn(`Login failed - no password set for user: ${user.id}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          password: 'incorrectPassword',
        },
      });
    }

    const isValidPassword = await compareMd5Password(loginDto.password, user.password);

    if (!isValidPassword) {
      this.logger.warn(`Login failed - incorrect password for user: ${user.id}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          password: 'incorrectPassword',
        },
      });
    }

    // Allow inactive users to login (they just haven't confirmed email yet)
    // Only block if status is explicitly set to something other than active/inactive
    validateUserStatusForAuth(user, 'email', this.logger);

    this.logger.log(`Login successful for user: ${user.id}`);
    return this.createSessionAndTokens(user);
  }

  /**
   * 用户注册
   * @param dto - 注册数据传输对象
   * @throws UnprocessableEntityException 当邮箱已存在时
   */
  async register(dto: AuthRegisterLoginDto): Promise<void> {
    this.logger.log(`Registration attempt for email: ${maskEmail(dto.email)}`);

    const user = await this.usersService.create({
      ...dto,
      email: dto.email,
      role: {
        id: RoleEnum.user,
      },
      status: {
        id: StatusEnum.inactive,
      },
    });

    this.logger.log(`User registered successfully: ${user.id}`);

    // Initialize default notification settings for new user
    // 使用 try-catch 确保通知设置失败不影响注册流程
    try {
      await this.notificationsService.initializeDefaultSettings(user.id);
    } catch (error) {
      this.logger.warn(`Failed to initialize notification settings for user ${user.id}`, { error });
      // 不抛出错误，通知设置可以稍后补充
    }

    const hash = await this.jwtService.signAsync(
      {
        confirmEmailUserId: user.id,
      },
      {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
        expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
          infer: true,
        }),
      },
    );

    await this.mailService.userSignUp({
      to: dto.email,
      data: {
        hash,
      },
    });

    this.logger.log(`Confirmation email sent to: ${maskEmail(dto.email)}`);
  }

  /**
   * 确认邮箱
   * @param hash - JWT 令牌哈希值
   * @throws UnprocessableEntityException 当令牌过期、无效或用户已激活时
   * @throws NotFoundException 当用户不存在时
   */
  async confirmEmail(hash: string): Promise<void> {
    this.logger.log('Email confirmation attempt');
    let userId: User['id'];

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        confirmEmailUserId: User['id'];
      }>(hash, {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
      });

      userId = jwtData.confirmEmailUserId;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        this.logger.warn('Email confirmation failed - token expired');
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: 'tokenExpired',
          },
        });
      }
      if (error instanceof JsonWebTokenError) {
        this.logger.warn('Email confirmation failed - invalid hash');
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: 'invalidHash',
          },
        });
      }
      throw error;
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      this.logger.warn(`Email confirmation failed - user not found: ${userId}`);
      throw new NotFoundException({
        status: HttpStatus.NOT_FOUND,
        error: 'notFound',
      });
    }

    if (user.status?.id !== StatusEnum.inactive) {
      this.logger.warn(`Email confirmation failed - user already active: ${userId}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: 'alreadyConfirmed',
        },
      });
    }

    await this.usersService.update(user.id, {
      status: { id: StatusEnum.active },
    });
    this.logger.log(`Email confirmed for user: ${userId}`);
  }

  /**
   * 确认新邮箱
   * @param hash - JWT 令牌哈希值，包含新邮箱信息
   * @throws UnprocessableEntityException 当令牌过期或无效时
   * @throws NotFoundException 当用户不存在时
   */
  async confirmNewEmail(hash: string): Promise<void> {
    this.logger.log('New email confirmation attempt');
    let userId: User['id'];
    let newEmail: User['email'];

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        confirmEmailUserId: User['id'];
        newEmail: User['email'];
      }>(hash, {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
      });

      userId = jwtData.confirmEmailUserId;
      newEmail = jwtData.newEmail;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        this.logger.warn('New email confirmation failed - token expired');
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: 'tokenExpired',
          },
        });
      }
      if (error instanceof JsonWebTokenError) {
        this.logger.warn('New email confirmation failed - invalid hash');
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: 'invalidHash',
          },
        });
      }
      throw error;
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException({
        status: HttpStatus.NOT_FOUND,
        error: `notFound`,
      });
    }

    const updateData: { email: User['email']; status?: { id: StatusEnum } } = {
      email: newEmail,
    };

    // 仅当用户是 inactive（未确认邮箱）时才激活，避免被封禁用户通过确认邮箱"复活"
    if (user.status?.id === StatusEnum.inactive) {
      updateData.status = { id: StatusEnum.active };
    }

    await this.usersService.update(user.id, updateData);
  }

  /**
   * 忘记密码 - 发送重置密码邮件
   * @param email - 用户邮箱
   * @throws UnprocessableEntityException 当邮箱不存在时
   */
  async forgotPassword(email: string): Promise<void> {
    this.logger.log(`Password reset requested for: ${maskEmail(email)}`);
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      this.logger.warn(`Password reset failed - email not found: ${maskEmail(email)}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: 'emailNotExists',
        },
      });
    }

    const tokenExpiresIn = this.configService.getOrThrow('auth.forgotExpires', {
      infer: true,
    });

    const tokenExpires = Date.now() + ms(tokenExpiresIn);

    const hash = await this.jwtService.signAsync(
      {
        forgotUserId: user.id,
        pwd: passwordFingerprint(user.password),
      },
      {
        secret: this.configService.getOrThrow('auth.forgotSecret', {
          infer: true,
        }),
        expiresIn: tokenExpiresIn,
      },
    );

    await this.mailService.forgotPassword({
      to: email,
      data: {
        hash,
        tokenExpires,
      },
    });

    this.logger.log(`Password reset email sent to: ${maskEmail(email)}`);
  }

  /**
   * 重置密码
   * @param hash - JWT 令牌哈希值
   * @param password - 新密码（明文）
   * @throws UnprocessableEntityException 当令牌过期、无效或用户不存在时
   */
  async resetPassword(hash: string, password: string): Promise<void> {
    this.logger.log('Password reset attempt');
    let userId: User['id'];
    let tokenPasswordFingerprint: string | undefined;

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        forgotUserId: User['id'];
        pwd?: string;
      }>(hash, {
        secret: this.configService.getOrThrow('auth.forgotSecret', {
          infer: true,
        }),
      });

      userId = jwtData.forgotUserId;
      tokenPasswordFingerprint = jwtData.pwd;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        this.logger.warn('Password reset failed - token expired');
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: 'tokenExpired',
          },
        });
      }
      if (error instanceof JsonWebTokenError) {
        this.logger.warn('Password reset failed - invalid hash');
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: 'invalidHash',
          },
        });
      }
      throw error;
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      this.logger.warn(`Password reset failed - user not found: ${userId}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `notFound`,
        },
      });
    }

    // 密码已变更（链接已使用过）时令牌失效
    if (tokenPasswordFingerprint !== passwordFingerprint(user.password)) {
      this.logger.warn(`Password reset failed - token already used: ${userId}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: 'invalidHash',
        },
      });
    }

    // Encrypt password before updating
    const hashedPassword = await hashPassword(password);

    const { updated, revokedSessionIds } = await this.credentialRepository.resetPassword(
      user.id,
      hashedPassword,
      user.password ?? null,
    );
    if (!updated) {
      this.logger.warn(`Password reset failed - token used concurrently: ${userId}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: 'invalidHash',
        },
      });
    }
    await this.sessionService.forgetSessions(revokedSessionIds);

    this.logger.log(`Password reset successful for user: ${userId}`);
  }

  /**
   * 通过手机验证码重置密码
   * @param phone - 手机号
   * @param code - 短信验证码
   * @param password - 新密码（明文）
   * @throws UnprocessableEntityException 当手机号不存在、验证码错误或用户状态不允许时
   */
  async resetPasswordByPhone(phone: string, code: string, password: string): Promise<void> {
    this.logger.log(`Phone password reset attempt for: ${maskPhone(phone)}`);

    // 验证短信验证码
    const verifyResult = await this.smsService.verifyCode(phone, code, SmsCodeType.RESET_PASSWORD);
    if (!verifyResult.success) {
      this.logger.warn(`Phone password reset failed - invalid code for: ${maskPhone(phone)}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          code: 'invalidCode',
        },
      });
    }

    // 查找用户
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      this.logger.warn(`Phone password reset failed - phone not found: ${maskPhone(phone)}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          phone: 'phoneNotExists',
        },
      });
    }

    // 检查用户状态
    validateUserStatusForAuth(user, 'phone', this.logger);

    // 加密新密码
    const hashedPassword = await hashPassword(password);

    const { revokedSessionIds } = await this.credentialRepository.resetPassword(user.id, hashedPassword);
    await this.sessionService.forgetSessions(revokedSessionIds);

    this.logger.log(`Phone password reset successful for user: ${user.id}`);
  }

  /**
   * 获取当前用户信息
   * @param userJwtPayload - JWT 载荷信息
   * @returns 用户信息或 null
   */
  async me(userJwtPayload: JwtPayloadType): Promise<NullableType<User>> {
    return this.usersService.findById(userJwtPayload.id);
  }

  /**
   * 更新用户信息
   * @param userJwtPayload - JWT 载荷信息
   * @param userDto - 更新数据传输对象
   * @returns 更新后的用户信息或 null
   * @throws UnprocessableEntityException 当用户不存在、密码验证失败或邮箱已被占用时
   */
  async update(userJwtPayload: JwtPayloadType, userDto: AuthUpdateDto): Promise<NullableType<User>> {
    const currentUser = await this.usersService.findById(userJwtPayload.id);

    if (!currentUser) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'userNotFound',
        },
      });
    }

    if (userDto.password) {
      if (!userDto.oldPassword) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'missingOldPassword',
          },
        });
      }

      if (!currentUser.password) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'incorrectOldPassword',
          },
        });
      }

      const isValidOldPassword = await compareMd5Password(userDto.oldPassword, currentUser.password);

      if (!isValidOldPassword) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'incorrectOldPassword',
          },
        });
      } else {
        await this.sessionService.deleteByUserIdWithExclude({
          userId: currentUser.id,
          excludeSessionId: userJwtPayload.sessionId,
        });
      }
    }

    if (userDto.email && userDto.email !== currentUser.email) {
      const userByEmail = await this.usersService.findByEmail(userDto.email);

      if (userByEmail && userByEmail.id !== currentUser.id) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            email: 'emailExists',
          },
        });
      }

      await this.verifyIdentity(currentUser, userDto);

      const hash = await this.jwtService.signAsync(
        {
          confirmEmailUserId: currentUser.id,
          newEmail: userDto.email,
        },
        {
          secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
            infer: true,
          }),
        },
      );

      await this.mailService.confirmNewEmail({
        to: userDto.email,
        data: {
          hash,
        },
      });

      // Remove email from update - it will be updated after confirmation
      delete userDto.email;
    }

    delete userDto.oldPassword;
    delete userDto.smsCode;

    await this.usersService.update(userJwtPayload.id, userDto);

    return this.usersService.findById(userJwtPayload.id);
  }

  /**
   * 刷新访问令牌
   * @param data - 包含会话ID和哈希值的数据
   * @returns 新的访问令牌和刷新令牌
   * @throws UnauthorizedException 当会话不存在或哈希值不匹配时
   */
  async refreshToken(data: Pick<JwtRefreshPayloadType, 'sessionId' | 'hash'>): Promise<Omit<LoginResponseDto, 'user'>> {
    this.logger.debug(`Token refresh attempt for session: ${data.sessionId}`);
    const session = await this.sessionService.findById(data.sessionId);

    // 用户已注销时会话关联的 user 为空
    if (!session?.user) {
      this.logger.warn(`Token refresh failed - session not found: ${data.sessionId}`);
      throw new UnauthorizedException();
    }

    if (session.hash !== data.hash) {
      if (await this.sessionService.wasRecentlyRotatedFrom(session.id, data.hash)) {
        this.logger.warn(`Token refresh failed - stale refresh token within grace period: ${data.sessionId}`);
      } else {
        this.logger.warn(`Refresh token reused, revoking session: ${data.sessionId}`);
        await this.sessionService.revoke(session.id);
      }
      throw new UnauthorizedException();
    }

    const hash = this.tokenService.generateSessionHash();

    const user = await this.usersService.findById(session.user.id);

    if (!user?.role) {
      this.logger.warn(`Token refresh failed - user not found for session: ${data.sessionId}`);
      throw new UnauthorizedException();
    }

    validateUserStatusForAuth(user, 'refresh', this.logger);

    const { token, refreshToken, tokenExpires } = await this.tokenService.getTokensData({
      id: session.user.id,
      role: {
        id: user.role.id,
      },
      sessionId: session.id,
      hash,
    });

    const rotated = await this.sessionService.rotateHash(session.id, data.hash, hash);
    if (!rotated) {
      this.logger.warn(`Token refresh failed - session rotated concurrently: ${data.sessionId}`);
      throw new UnauthorizedException();
    }

    this.logger.debug(`Token refreshed for user: ${session.user.id}`);

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }

  /**
   * 软删除用户账户
   * @param user - 包含用户ID的对象
   * @param dto - 身份验证凭据
   */
  async softDelete(user: Pick<User, 'id'>, dto: AuthDeleteAccountDto): Promise<void> {
    this.logger.log(`User account deletion requested: ${user.id}`);
    const currentUser = await this.usersService.findById(user.id);
    if (!currentUser) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'userNotFound',
        },
      });
    }
    await this.verifyIdentity(currentUser, dto);

    await this.usersService.remove(user.id);
    this.logger.log(`User account deleted: ${user.id}`);
  }

  /**
   * 敏感操作前验证身份：有密码的用户校验当前密码，没有密码但绑定了手机号的用户校验 verify_identity 短信验证码
   * @throws UnprocessableEntityException 当凭据缺失或错误，或用户既没有密码也没有手机号时
   */
  private async verifyIdentity(user: User, credentials: { oldPassword?: string; smsCode?: string }): Promise<void> {
    if (user.password) {
      if (!credentials.oldPassword) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'missingOldPassword',
          },
        });
      }
      if (!(await compareMd5Password(credentials.oldPassword, user.password))) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'incorrectOldPassword',
          },
        });
      }
      return;
    }

    if (!user.phone) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          phone: 'phoneRequiredForVerification',
        },
      });
    }

    if (!credentials.smsCode) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          smsCode: 'missingSmsCode',
        },
      });
    }
    await verifySmsCode(this.smsService, user.phone, credentials.smsCode, SmsCodeType.VERIFY_IDENTITY, this.logger);
  }

  /**
   * 用户登出
   * @param data - 包含会话ID的数据
   */
  async logout(data: Pick<JwtRefreshPayloadType, 'sessionId'>): Promise<void> {
    this.logger.log(`Logout for session: ${data.sessionId}`);
    return this.sessionService.deleteById(data.sessionId);
  }

  /**
   * 发送短信验证码
   * @param phone - 手机号
   * @param type - 验证码类型（登录、注册、重置密码等）
   * @throws UnprocessableEntityException 当手机号已存在（注册）或不存在（登录/重置密码）或发送失败时
   */
  async sendCode(phone: string, type: SmsCodeType = SmsCodeType.LOGIN): Promise<void> {
    this.logger.log(`Send SMS code request for phone: ${maskPhone(phone)}, type: ${type}`);

    // 尚无校验 change_phone 验证码的业务，不对外发送
    if (type === SmsCodeType.CHANGE_PHONE) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          type: 'unsupportedCodeType',
        },
      });
    }

    // For register type, check if phone already exists
    if (type === SmsCodeType.REGISTER) {
      const existingUser = await this.usersService.findByPhone(phone);
      if (existingUser) {
        this.logger.warn(`Phone already registered: ${maskPhone(phone)}`);
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            phone: 'phoneAlreadyExists',
          },
        });
      }
    }

    // For login/reset_password/verify_identity type, check if phone exists
    if (type === SmsCodeType.LOGIN || type === SmsCodeType.RESET_PASSWORD || type === SmsCodeType.VERIFY_IDENTITY) {
      const user = await this.usersService.findByPhone(phone);
      if (!user) {
        this.logger.warn(`Phone not found: ${maskPhone(phone)}`);
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            phone: 'phoneNotFound',
          },
        });
      }
    }

    const sendResult = await this.smsService.sendCode(phone, type);
    if (!sendResult.success) {
      this.logger.warn(`Failed to send SMS code to ${maskPhone(phone)}: ${sendResult.message}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          phone: sendResult.retryAfter ? 'rateLimited' : 'sendFailed',
          retryAfter: sendResult.retryAfter,
        },
      });
    }
    this.logger.log(`SMS code sent to: ${maskPhone(phone)}`);
  }

  /**
   * 验证手机号密码登录
   * @param loginDto - 手机号登录数据传输对象
   * @returns 登录响应，包含用户信息和令牌
   * @throws UnprocessableEntityException 当手机号不存在、密码错误或用户状态不允许登录时
   */
  async validatePhoneLogin(loginDto: AuthPhoneLoginDto): Promise<LoginResponseDto> {
    this.logger.log(`Phone login attempt for: ${maskPhone(loginDto.phone)}`);
    const user = await this.usersService.findByPhone(loginDto.phone);

    if (!user) {
      this.logger.warn(`Phone login failed - user not found: ${maskPhone(loginDto.phone)}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          credentials: 'incorrectPhoneOrPassword',
        },
      });
    }

    if (!user.password) {
      this.logger.warn(`Phone login failed - no password set for user: ${user.id}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          credentials: 'incorrectPhoneOrPassword',
        },
      });
    }

    const isValidPassword = await compareMd5Password(loginDto.password, user.password);

    if (!isValidPassword) {
      this.logger.warn(`Phone login failed - incorrect password for user: ${user.id}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          credentials: 'incorrectPhoneOrPassword',
        },
      });
    }

    // Allow both active and inactive users to login (consistent with email login)
    validateUserStatusForAuth(user, 'phone', this.logger);

    this.logger.log(`Phone login successful for user: ${user.id}`);
    return this.createSessionAndTokens(user);
  }

  /**
   * 验证手机号短信验证码登录
   * @param loginDto - 手机号短信登录数据传输对象
   * @returns 登录响应，包含用户信息和令牌
   * @throws UnprocessableEntityException 当验证码无效、手机号不存在或用户状态不允许登录时
   */
  async validatePhoneSmsLogin(loginDto: AuthPhoneSmsLoginDto): Promise<LoginResponseDto> {
    this.logger.log(`Phone SMS login attempt for: ${maskPhone(loginDto.phone)}`);

    // Verify SMS code
    await verifySmsCode(this.smsService, loginDto.phone, loginDto.code, SmsCodeType.LOGIN, this.logger);

    const user = await this.usersService.findByPhone(loginDto.phone);

    if (!user) {
      this.logger.warn(`Phone SMS login failed - user not found: ${maskPhone(loginDto.phone)}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          phone: 'notFound',
        },
      });
    }

    // Allow both active and inactive users to login (consistent with email login)
    validateUserStatusForAuth(user, 'phone', this.logger);

    this.logger.log(`Phone SMS login successful for user: ${user.id}`);
    return this.createSessionAndTokens(user);
  }

  /**
   * 手机号注册
   * @param dto - 手机号注册数据传输对象
   * @returns 登录响应，包含用户信息和令牌
   * @throws UnprocessableEntityException 当验证码无效或手机号已存在时
   */
  async registerByPhone(dto: AuthPhoneRegisterDto): Promise<LoginResponseDto> {
    this.logger.log(`Phone registration attempt for: ${maskPhone(dto.phone)}`);

    // Verify SMS code
    await verifySmsCode(this.smsService, dto.phone, dto.code, SmsCodeType.REGISTER, this.logger);

    // Check if phone already exists
    const existingUser = await this.usersService.findByPhone(dto.phone);
    if (existingUser) {
      this.logger.warn(`Phone registration failed - phone already exists: ${maskPhone(dto.phone)}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          phone: 'phoneAlreadyExists',
        },
      });
    }

    const user = await this.usersService.create({
      phone: dto.phone,
      password: dto.password,
      nickname: dto.nickname,
      provider: AuthProvidersEnum.phone,
      role: {
        id: RoleEnum.user,
      },
      status: {
        id: StatusEnum.active,
      },
    });

    this.logger.log(`User registered successfully via phone: ${user.id}`);

    // Initialize default notification settings for new user
    try {
      await this.notificationsService.initializeDefaultSettings(user.id);
    } catch (error) {
      this.logger.warn(`Failed to initialize notification settings for user ${user.id}`, { error });
    }

    return this.createSessionAndTokens(user);
  }

  /**
   * 修改密码
   * @param userJwtPayload - JWT 载荷信息
   * @param oldPassword - 旧密码
   * @param newPassword - 新密码
   * @throws UnprocessableEntityException 当用户不存在或旧密码错误时
   */
  async changePassword(userJwtPayload: JwtPayloadType, oldPassword: string, newPassword: string): Promise<void> {
    this.logger.log(`Password change attempt for user: ${userJwtPayload.id}`);

    const user = await this.usersService.findById(userJwtPayload.id);

    if (!user) {
      this.logger.warn(`Password change failed - user not found: ${userJwtPayload.id}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'userNotFound',
        },
      });
    }

    if (!user.password) {
      this.logger.warn(`Password change failed - no password set for user: ${userJwtPayload.id}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          oldPassword: 'incorrectOldPassword',
        },
      });
    }

    const isValidOldPassword = await compareMd5Password(oldPassword, user.password);

    if (!isValidOldPassword) {
      this.logger.warn(`Password change failed - incorrect old password for user: ${userJwtPayload.id}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          oldPassword: 'incorrectOldPassword',
        },
      });
    }

    // Update password
    await this.usersService.update(userJwtPayload.id, { password: newPassword });

    // Invalidate all other sessions
    await this.sessionService.deleteByUserIdWithExclude({
      userId: userJwtPayload.id,
      excludeSessionId: userJwtPayload.sessionId,
    });

    this.logger.log(`Password changed successfully for user: ${userJwtPayload.id}`);
  }

  /**
   * 微信登录
   * @param dto - 微信登录数据传输对象
   * @returns 登录响应，包含用户信息和令牌
   */
  async wechatLogin(dto: AuthWechatLoginDto): Promise<LoginResponseDto> {
    this.logger.log(`WeChat login attempt with type: ${dto.type}`);

    // Get user info from WeChat
    const wechatUserInfo =
      dto.type === WechatLoginType.MINI_APP
        ? await this.wechatService.miniAppLogin(dto.code)
        : await this.wechatService.appLogin(dto.code);

    // Check if user already exists
    let user = await this.usersService.findByWechatOpenId(wechatUserInfo.openId);

    if (!user) {
      // Create new user for first-time WeChat login
      this.logger.log(`Creating new user for WeChat openId: ${wechatUserInfo.openId}`);

      try {
        user = await this.createWechatUser({
          openId: wechatUserInfo.openId,
          unionId: wechatUserInfo.unionId,
          nickname: dto.nickname ?? wechatUserInfo.nickname,
          gender: wechatUserInfo.gender,
        });
      } catch (error) {
        if (!isUniqueViolationOf(error, 'user_wechatOpenId_key')) {
          throw error;
        }
        // 并发首次登录时另一请求已创建该用户
        const existing = await this.usersService.findByWechatOpenId(wechatUserInfo.openId);
        if (!existing) {
          throw error;
        }
        this.logger.log(`Concurrent WeChat registration resolved to user: ${existing.id}`);
        validateUserStatusForAuth(existing, 'wechat', this.logger);
        return this.createSessionAndTokens(existing);
      }

      this.logger.log(`New WeChat user created: ${user.id}`);
    } else {
      this.logger.log(`Existing user found for WeChat openId: ${wechatUserInfo.openId}`);
      validateUserStatusForAuth(user, 'wechat', this.logger);
    }

    this.logger.log(`WeChat login successful for user: ${user.id}`);
    return this.createSessionAndTokens(user);
  }

  /**
   * 微信手机号快捷登录（小程序）
   * openId 与手机号分属不同用户时拒绝登录，不合并账号
   * @param dto - wx.login code 与手机号快速验证 code
   * @returns 登录响应，包含用户信息和令牌
   * @throws UnprocessableEntityException code 无效、非大陆手机号或手机号已绑定其他微信时
   */
  async wechatPhoneLogin(dto: AuthWechatPhoneLoginDto): Promise<LoginResponseDto> {
    const [wechatUserInfo, phoneInfo] = await Promise.all([
      this.wechatService.miniAppLogin(dto.loginCode),
      this.wechatService.getPhoneNumber(dto.phoneCode),
    ]);

    if (phoneInfo.countryCode !== '86') {
      this.logger.warn(`WeChat phone login rejected - unsupported country code: ${phoneInfo.countryCode}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'phoneRegionNotSupported',
        errors: { phone: 'unsupportedRegion' },
      });
    }

    const identity = {
      openId: wechatUserInfo.openId,
      unionId: wechatUserInfo.unionId,
      phone: phoneInfo.purePhoneNumber,
    };
    this.logger.log(`WeChat phone login attempt for: ${maskPhone(identity.phone)}`);

    // 并发请求抢先绑定或创建时返回 null，重新查询一次
    const user =
      (await this.resolveWechatPhoneUser(identity, true)) ?? (await this.resolveWechatPhoneUser(identity, false));

    if (!user) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { user: 'notFound' },
      });
    }

    validateUserStatusForAuth(user, 'wechat', this.logger);

    this.logger.log(`WeChat phone login successful for user: ${user.id}`);
    return this.createSessionAndTokens(user);
  }

  /**
   * 按 openId 与手机号查找、绑定或创建用户
   * @param allowRetry - 为 true 时，绑定或创建与并发请求冲突返回 null；为 false 时直接抛出
   */
  private async resolveWechatPhoneUser(
    identity: { openId: string; unionId?: string; phone: string },
    allowRetry: boolean,
  ): Promise<User | null> {
    const [byOpenId, byPhone] = await Promise.all([
      this.usersService.findByWechatOpenId(identity.openId),
      this.usersService.findByPhone(identity.phone),
    ]);

    const phoneBoundToOtherWechat = () => {
      this.logger.warn(`WeChat phone login rejected - phone bound to another user: ${maskPhone(identity.phone)}`);
      return new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'phoneBoundToOtherWechat',
        errors: { phone: 'boundToOtherWechat' },
      });
    };

    const retryOrThrow = (error: unknown): null => {
      if (allowRetry) return null;
      throw error;
    };

    if (byOpenId && byPhone) {
      if (String(byOpenId.id) !== String(byPhone.id)) {
        throw phoneBoundToOtherWechat();
      }
      return byOpenId;
    }

    if (byOpenId) {
      // 已绑定其他手机号时保留原手机号
      if (byOpenId.phone) {
        return byOpenId;
      }
      validateUserStatusForAuth(byOpenId, 'wechat', this.logger);
      try {
        const bound = await this.usersService.bindPhoneIfEmpty(byOpenId.id, identity.phone);
        if (!bound) return retryOrThrow(new Error(`Failed to bind phone to user ${byOpenId.id}`));
      } catch (error) {
        return retryOrThrow(error);
      }
      return this.usersService.findById(byOpenId.id);
    }

    if (byPhone) {
      if (byPhone.wechatOpenId) {
        throw phoneBoundToOtherWechat();
      }
      validateUserStatusForAuth(byPhone, 'wechat', this.logger);
      try {
        const bound = await this.usersService.bindWechatIfEmpty(byPhone.id, identity.openId, identity.unionId);
        if (!bound) return retryOrThrow(new Error(`Failed to bind WeChat to user ${byPhone.id}`));
      } catch (error) {
        return retryOrThrow(error);
      }
      return this.usersService.findById(byPhone.id);
    }

    try {
      const user = await this.createWechatUser(identity);
      this.logger.log(`New WeChat phone user created: ${user.id}`);
      return user;
    } catch (error) {
      return retryOrThrow(error);
    }
  }

  /**
   * 支付宝登录（小程序）
   * 首次登录创建独立账号，不与已有账号合并
   * @param dto - my.getAuthCode 返回的授权码
   * @returns 登录响应，包含用户信息和令牌
   */
  async alipayLogin(dto: AuthAlipayLoginDto): Promise<LoginResponseDto> {
    const { openId } = await this.alipayService.exchangeAuthCode(dto.authCode);

    let user = await this.usersService.findByAlipayOpenId(openId);

    if (!user) {
      try {
        user = await this.createUserWithDefaultSettings({
          alipayOpenId: openId,
          nickname: '支付宝用户',
          provider: AuthProvidersEnum.alipay,
          role: { id: RoleEnum.user },
          status: { id: StatusEnum.active },
        });
        this.logger.log(`New Alipay user created: ${user.id}`);
      } catch (error) {
        if (!isUniqueViolationOf(error, 'user_alipayOpenId_key')) {
          throw error;
        }
        // 并发首次登录时另一请求已创建该用户
        user = await this.usersService.findByAlipayOpenId(openId);
        if (!user) {
          throw error;
        }
      }
    }

    validateUserStatusForAuth(user, 'alipay', this.logger);

    this.logger.log(`Alipay login successful for user: ${user.id}`);
    return this.createSessionAndTokens(user);
  }

  /**
   * 创建微信用户并初始化通知设置
   */
  private createWechatUser(data: {
    openId: string;
    unionId?: string;
    phone?: string;
    nickname?: string;
    gender?: number;
  }): Promise<User> {
    return this.createUserWithDefaultSettings({
      wechatOpenId: data.openId,
      wechatUnionId: data.unionId,
      phone: data.phone,
      nickname: data.nickname ?? '微信用户',
      gender: data.gender ?? 0,
      provider: AuthProvidersEnum.wechat,
      role: {
        id: RoleEnum.user,
      },
      status: {
        id: StatusEnum.active,
      },
    });
  }

  /**
   * 创建用户并初始化通知设置，通知设置初始化失败不影响创建结果
   */
  private async createUserWithDefaultSettings(createUserDto: CreateUserDto): Promise<User> {
    const user = await this.usersService.create(createUserDto);

    try {
      await this.notificationsService.initializeDefaultSettings(user.id);
    } catch (error) {
      this.logger.warn(`Failed to initialize notification settings for user ${user.id}`, { error });
    }

    return user;
  }

  /**
   * Create session and generate tokens for a user
   */
  private async createSessionAndTokens(user: User): Promise<LoginResponseDto> {
    const hash = this.tokenService.generateSessionHash();

    const session = await this.sessionService.create({
      user,
      hash,
    });

    const { token, refreshToken, tokenExpires } = await this.tokenService.getTokensData({
      id: user.id,
      role: user.role,
      sessionId: session.id,
      hash,
    });

    return {
      refreshToken,
      token,
      tokenExpires,
      user,
    };
  }
}
