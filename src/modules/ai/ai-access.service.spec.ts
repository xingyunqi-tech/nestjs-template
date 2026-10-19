import { AiAccessService } from './ai-access.service';
import { AppConfigService } from '../config/config.service';
import { ConsentsService } from '../consents/consents.service';
import { UsersService } from '../../core/users/users.service';

describe('AiAccessService', () => {
  let enabled: unknown;
  let configured: boolean;
  let user: { id: number; phone: string | null; wechatOpenId: string | null } | null;
  let agreed: boolean;
  let service: AiAccessService;

  beforeEach(() => {
    enabled = true;
    configured = true;
    user = { id: 7, phone: '13800138000', wechatOpenId: null };
    agreed = true;
    service = new AiAccessService(
      { getValue: vi.fn(() => Promise.resolve(enabled)) } as unknown as AppConfigService,
      { findById: vi.fn(() => Promise.resolve(user)) } as unknown as UsersService,
      { hasAgreedAiService: vi.fn(() => Promise.resolve(agreed)) } as unknown as ConsentsService,
      { isConfigured: () => configured, moderate: vi.fn() },
    );
  });

  it('should allow a user with a phone number and no WeChat binding', async () => {
    await expect(service.assertCanUse(7)).resolves.toBeUndefined();
  });

  it('should reject as aiUnavailable when AI is disabled', async () => {
    enabled = false;

    await expect(service.assertCanUse(7)).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });

  it('should reject as aiUnavailable when content moderation is not configured', async () => {
    configured = false;

    await expect(service.assertCanUse(7)).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
  });

  it('should reject a user without a phone number as phoneBindingRequired', async () => {
    user = { id: 7, phone: null, wechatOpenId: 'open-1' };

    await expect(service.assertCanUse(7)).rejects.toMatchObject({ errorKey: 'phoneBindingRequired' });
  });

  it('should reject a user who has not agreed to the AI service terms', async () => {
    agreed = false;

    await expect(service.assertCanUse(7)).rejects.toMatchObject({ errorKey: 'aiConsentRequired' });
  });
});
