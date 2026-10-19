import { AiContentSafetyService } from './ai-content-safety.service';
import {
  ContentModerationError,
  ContentModerationProvider,
  ContentModerationResult,
} from '../../integrations/aliyun-green/content-moderation-provider';

describe('AiContentSafetyService', () => {
  let moderate: ReturnType<typeof vi.fn<ContentModerationProvider['moderate']>>;
  let service: AiContentSafetyService;

  const result = (verdict: ContentModerationResult['verdict'], riskLevel: string): ContentModerationResult => ({
    verdict,
    riskLevel,
    labels: verdict === 'block' ? ['political_content'] : [],
    requestId: 'req-1',
  });

  beforeEach(() => {
    moderate = vi.fn<ContentModerationProvider['moderate']>().mockResolvedValue(result('pass', 'none'));
    service = new AiContentSafetyService({ isConfigured: () => true, moderate });
  });

  describe('assertInputSafe', () => {
    it('should moderate the input with the user id', async () => {
      await expect(service.assertInputSafe(7, '为什么选 B？')).resolves.toBeUndefined();

      expect(moderate).toHaveBeenCalledWith({ kind: 'input', content: '为什么选 B？', userId: 7 });
    });

    it('should reject blocked input as contentBlocked', async () => {
      moderate.mockResolvedValue(result('block', 'medium'));

      await expect(service.assertInputSafe(7, '违规')).rejects.toMatchObject({ errorKey: 'contentBlocked' });
    });

    it('should reject as aiUnavailable when the moderation call fails', async () => {
      moderate.mockRejectedValue(new ContentModerationError('timeout', 'timed out'));

      await expect(service.assertInputSafe(7, '为什么')).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    });
  });

  describe('checkOutput', () => {
    it('should moderate the output with the given session id', async () => {
      await expect(service.checkOutput({ userId: 7, sessionId: 'm1', content: '答案是 B' })).resolves.toBe('pass');

      expect(moderate).toHaveBeenCalledWith({ kind: 'output', content: '答案是 B', userId: 7, sessionId: 'm1' });
    });

    it('should pass blank output without calling the service', async () => {
      await expect(service.checkOutput({ userId: 7, sessionId: 'm1', content: ' \n' })).resolves.toBe('pass');

      expect(moderate).not.toHaveBeenCalled();
    });

    it('should report blocked output', async () => {
      moderate.mockResolvedValue(result('block', 'high'));

      await expect(service.checkOutput({ userId: 7, sessionId: 'm1', content: '违规' })).resolves.toBe('blocked');
    });

    it('should report an error when the moderation call fails', async () => {
      moderate.mockRejectedValue(new ContentModerationError('networkError', 'down'));

      await expect(service.checkOutput({ userId: 7, sessionId: 'm1', content: '答案' })).resolves.toBe('error');
    });
  });
});
