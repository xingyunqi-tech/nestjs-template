import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AUDITABLE_KEY, AuditableOptions } from './decorators/auditable.decorator';
import { AuditAction } from './domain/audit-log';
vi.hoisted(() => {
  process.env.FILE_DRIVER ??= 'local';
});

import { AdminPaperRulesController } from '../../modules/papers/admin-paper-rules.controller';
import { AdminAccountCleanupController } from '../../modules/account-cleanup/admin-account-cleanup.controller';
import { AdminAppProfileController } from '../../modules/app-profile/admin-app-profile.controller';
import { AdminImportsController } from '../../modules/imports/admin-imports.controller';

type ControllerClass = { prototype: object; name: string };

const MODULES_DIR = join(__dirname, '../../modules');

const READ_ONLY_HANDLERS: object[] = [AdminPaperRulesController.prototype.preview];

const UNAUDITED_HANDLERS: object[] = [
  AdminAccountCleanupController.prototype.retrigger,
  AdminAppProfileController.prototype.update,
];

const EXEMPT_HANDLERS = new Set([...READ_ONLY_HANDLERS, ...UNAUDITED_HANDLERS]);

function adminControllerFiles(): string[] {
  return readdirSync(MODULES_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => /(^|\/)admin-[^/]+\.controller\.ts$/.test(file))
    .map((file) => join(MODULES_DIR, file));
}

async function loadAdminControllers(): Promise<ControllerClass[]> {
  const modules = await Promise.all(adminControllerFiles().map((file) => import(file) as Promise<object>));
  return modules.flatMap((exports) =>
    Object.values(exports).filter(
      (value): value is ControllerClass =>
        typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value) !== undefined,
    ),
  );
}

function writeHandlersOf(controller: ControllerClass): { name: string; handler: object }[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype).flatMap((name) => {
    const handler = prototype[name];
    if (typeof handler !== 'function') {
      return [];
    }
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    return method === undefined || method === RequestMethod.GET ? [] : [{ name, handler }];
  });
}

describe('admin controllers audit', () => {
  let controllers: ControllerClass[];

  beforeAll(async () => {
    controllers = await loadAdminControllers();
  });

  it('should collect every admin controller under src/modules', () => {
    expect(controllers.length).toBe(adminControllerFiles().length);
    expect(controllers).toContain(AdminPaperRulesController);
    expect(controllers).toContain(AdminImportsController);
  });

  it('should audit every write endpoint except the exempt ones', () => {
    const missing: string[] = [];
    const unexpected: string[] = [];
    for (const controller of controllers) {
      for (const { name, handler } of writeHandlersOf(controller)) {
        const options = Reflect.getMetadata(AUDITABLE_KEY, handler) as AuditableOptions | undefined;
        const label = `${controller.name}.${name}`;
        if (EXEMPT_HANDLERS.has(handler)) {
          if (options) unexpected.push(label);
          continue;
        }
        if (!options) {
          missing.push(label);
          continue;
        }
        expect(Object.values(AuditAction)).toContain(options.action);
        expect(options.entityType).toMatch(/^[A-Z][A-Za-z]+$/);
      }
    }

    expect({ missing, unexpected }).toEqual({ missing: [], unexpected: [] });
  });

  it('should record the created import job instead of the upload request', () => {
    const options = Reflect.getMetadata(AUDITABLE_KEY, AdminImportsController.prototype.create) as AuditableOptions;

    expect(options).toMatchObject({
      action: AuditAction.CREATE,
      entityType: 'ImportJob',
      includeBody: false,
      includeResponse: true,
    });
  });
});
