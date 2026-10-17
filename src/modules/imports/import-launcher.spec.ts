import type { Mocked } from 'vitest';
import { Queue } from 'bullmq';
import { ImportLauncher } from './import-launcher';
import { ImportsService } from './imports.service';
import { ImportJob } from './domain/import-job';
import { ImportQueueJobData } from '../../infrastructure/queue/import-queue/import-queue.constants';

describe('ImportLauncher', () => {
  let importsService: Mocked<Pick<ImportsService, 'create' | 'execute'>>;
  const input = { fileId: 'f', publishOnImport: false };
  const requester = { id: 1, roleId: null };

  beforeEach(() => {
    importsService = {
      create: vi.fn().mockResolvedValue(Object.assign(new ImportJob(), { id: 'job-1' })),
      execute: vi.fn().mockResolvedValue(null),
    };
  });

  it('should enqueue the created job once without retries', async () => {
    const queue = { add: vi.fn() };
    const launcher = new ImportLauncher(
      importsService as unknown as ImportsService,
      queue as unknown as Queue<ImportQueueJobData>,
    );

    await expect(launcher.launch(input, requester)).resolves.toMatchObject({ id: 'job-1' });
    expect(queue.add).toHaveBeenCalledWith(
      'run-import',
      { importJobId: 'job-1' },
      expect.objectContaining({ jobId: 'job-1', attempts: 1 }),
    );
    expect(importsService.execute).not.toHaveBeenCalled();
  });

  it('should run the job in process when no queue is registered', async () => {
    const launcher = new ImportLauncher(importsService as unknown as ImportsService);

    await launcher.launch(input, requester);
    await new Promise((resolve) => setImmediate(resolve));

    expect(importsService.execute).toHaveBeenCalledWith('job-1');
  });
});
