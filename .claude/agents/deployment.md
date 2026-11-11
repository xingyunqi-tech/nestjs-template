# 部署流程

> 依赖：[common-patterns](./common-patterns.md)

## Docker 构建

### Dockerfile（多阶段构建）

```
1. Base     — Node 24-alpine 基础镜像
2. Deps     — pnpm install 依赖
3. Builder  — nest build 编译
4. Prod     — 仅生产依赖 + 编译产物
```

### Docker Compose 环境

| 环境 | 命令        | 用途               |
| ---- | ----------- | ------------------ |
| Dev  | `make dev`  | 本地开发（热重载） |
| Test | `make test` | 测试环境           |
| CI   | `make ci`   | CI 自动化测试      |
| Prod | `make prod` | 生产部署           |

### Makefile 常用命令

Makefile 位于 `docker/Makefile`，从项目根目录使用 `make -C docker` 调用：

```bash
make -C docker dev      # 启动 PostgreSQL + Redis + App（开发模式）
make -C docker test     # 启动测试环境
make -C docker ci       # CI 测试（运行后自动退出）
make -C docker down     # 停止所有容器
make -C docker clean    # 清理容器和数据卷
```

## CI/CD（GitHub Actions）

### Check 工作流（`.github/workflows/check.yml`）

触发条件：PR 或 push 到 main/master/release/\*、手动触发

```
1. Lint           → ESLint + Prettier + markdownlint + cspell
2. Type Check     → TypeScript 类型检查
3. Test           → 单元测试 + 覆盖率门槛（vitest.config.mts thresholds）
4. Build          → 应用编译
5. Migrations     → 空库执行全部迁移后检查实体与库结构一致
6. Workflow Lint  → actionlint + zizmor（.github/zizmor.yml）
7. Security       → pnpm audit（生产依赖 high 及以上）+ gitleaks（本次提交范围）
8. Image Scan     → 构建生产镜像 + Trivy（HIGH / CRITICAL 且有修复版本）
9. E2E            → 1–7 通过后用 docker compose 跑端到端测试
```

依赖更新由 Renovate 管理（`.github/renovate.json5`）：Node 限 24.x、TypeScript 限 6.x，Postgres / Redis 大版本不自动升级。

### Deploy 工作流（`.github/workflows/deploy.yml`）

触发条件：仅手动触发（选择是否部署及目标 aliyun / tencent / all）

```
1. Build & Push → 构建 Docker 镜像 → 推送到 GHCR（部署时同时推送腾讯云 TCR）
2. Deploy       → SSH 到阿里云 ECS / 腾讯云 CVM → 从 TCR 拉取镜像 → 重启服务 → 健康检查
3. Cleanup      → 调用 cleanup-registry.yml 清理旧镜像
```

## 环境变量管理

### 开发环境

使用 `.env` 文件（已加入 .gitignore）：

```env
NODE_ENV=development
APP_PORT=3000
DATABASE_HOST=localhost
REDIS_HOST=localhost
```

### 生产环境

通过以下方式注入：

- Docker Compose 环境变量
- CI/CD Secrets
- 服务器环境变量

### 必需的 CI/CD Secrets

```
ALIYUN_HOST          # 服务器地址
ALIYUN_PORT          # SSH 端口
ALIYUN_USER          # SSH 用户
ALIYUN_SSH_KEY       # SSH 私钥
DOCKERHUB_USERNAME   # Docker Hub 用户名
DOCKERHUB_TOKEN      # Docker Hub Token
```

## 数据库迁移部署

### 开发环境

```bash
pnpm migration:generate src/infrastructure/database/migrations/FeatureName
pnpm migration:run
```

### 生产环境

迁移在部署时自动执行（Docker 容器启动脚本）：

```bash
# 生产环境种子数据
pnpm seed:run:prod
```

## 监控

### 健康检查

```
GET /health       # 总体状态（需监控令牌，同 METRICS_TOKEN）
GET /health/live  # 存活探针
GET /health/ready # 就绪探针
```

### Prometheus 指标

```
GET /metrics      # Prometheus 格式指标
```

可用于 Grafana Dashboard 监控。

## 本地开发快速启动

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量
cp .env.example .env

# 3. 启动基础服务
make dev
# 或手动启动 PostgreSQL + Redis

# 4. 运行迁移
pnpm migration:run

# 5. 执行种子数据
pnpm seed:run:relational

# 6. 启动开发服务器
pnpm start:swc

# 7. 访问
# API: http://localhost:3000/api/v1
# Swagger: http://localhost:3000/docs
```
