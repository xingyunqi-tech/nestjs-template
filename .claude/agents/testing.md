# 测试策略

> 依赖：[common-patterns](./common-patterns.md)

## 测试框架

- **单元测试**: Vitest + unplugin-swc（只转译不做类型检查，类型由 `pnpm type-check` 覆盖），配置见 `vitest.config.mts`
- **E2E 测试**: Vitest + Supertest，配置见 `vitest.e2e.config.mts`
- **覆盖率**: `@vitest/coverage-v8`
- **全局 API**: `describe` / `it` / `expect` / `vi` 为全局变量，类型 `Mocked` / `Mock` 需从 `vitest` 导入

## 单元测试

### 文件位置

与被测文件同目录，命名 `*.spec.ts`：

```
src/modules/feature/
├── feature.service.ts
├── feature.service.spec.ts    # 单元测试
└── feature.controller.ts
```

### Service 测试模式

```typescript
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FeatureService } from './feature.service';
import { FeatureRepository } from './infrastructure/persistence/feature.repository';

describe('FeatureService', () => {
  let service: FeatureService;
  let repository: Mocked<FeatureRepository>;

  beforeEach(async () => {
    const mockRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findManyWithPagination: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FeatureService, { provide: FeatureRepository, useValue: mockRepository }],
    }).compile();

    service = module.get<FeatureService>(FeatureService);
    repository = module.get(FeatureRepository);
  });

  describe('create', () => {
    it('应该创建并返回功能', async () => {
      const dto = { name: '测试功能' };
      const expected = { id: 1, name: '测试功能', createdAt: new Date() };
      repository.create.mockResolvedValue(expected as any);

      const result = await service.create(dto);

      expect(result).toEqual(expected);
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining(dto));
    });
  });

  describe('findById', () => {
    it('存在时应返回功能', async () => {
      const expected = { id: 1, name: '测试功能' };
      repository.findById.mockResolvedValue(expected as any);

      const result = await service.findById(1);

      expect(result).toEqual(expected);
    });

    it('不存在时应返回 null', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.findById(999);

      expect(result).toBeNull();
    });
  });
});
```

### 测试规则

1. **Mock 所有外部依赖** — Repository, ConfigService, 其他 Service
2. **测试业务逻辑** — 验证、转换、条件分支
3. **测试异常场景** — 不存在、重复、权限不足
4. **描述使用中文** — `it('应该创建并返回功能')`

## E2E 测试

### 文件位置

```
test/
├── user/
│   └── auth.e2e-spec.ts
├── utils/
│   └── ...
└── ...
```

### E2E 测试模式

```typescript
import request from 'supertest';
import { APP_URL } from '../utils/constants';

describe('Auth (e2e)', () => {
  const app = APP_URL;

  describe('POST /api/v1/auth/email/login', () => {
    it('应该成功登录', async () => {
      const response = await request(app)
        .post('/api/v1/auth/email/login')
        .send({
          email: 'admin@example.com',
          password: 'secret',
        })
        .expect(200);

      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('refreshToken');
    });

    it('密码错误应返回 422', async () => {
      await request(app)
        .post('/api/v1/auth/email/login')
        .send({
          email: 'admin@example.com',
          password: 'wrong-password',
        })
        .expect(422);
    });
  });
});
```

### 运行 E2E 测试

```bash
# 需要先启动数据库和应用
make dev                 # 启动 Docker 开发环境
pnpm test:e2e         # 运行 E2E 测试

# 或使用 Docker CI 环境
make ci                  # 自动启动环境并运行测试
```

## 运行命令

```bash
pnpm test             # 运行所有单元测试
pnpm test:watch       # 监听模式
pnpm test:cov         # 生成覆盖率报告
pnpm test:e2e         # 运行 E2E 测试
pnpm test:debug       # 调试模式
```

## 测试覆盖率

- **门槛**: `vitest.config.mts` 的 `coverage.thresholds`，`pnpm test:cov` 低于门槛即失败（CI 的 Test job 执行该命令）
- **重点覆盖**: Service 层业务逻辑、Guard/Interceptor、工具函数
- **可选覆盖**: Controller（薄层，E2E 测试覆盖）、Entity/Mapper（简单映射）
