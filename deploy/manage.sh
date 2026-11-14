#!/bin/bash

# NestJS API 容器管理脚本
# 用法: ./manage.sh [start|stop|restart|remove|status|logs|health|help]

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置变量
CONTAINER_NAME="nestjs-api"
COMPOSE_FILE="docker/docker-compose.ecs.yaml"
ENV_FILE=".env"
HEALTH_URL="http://localhost:3000/api/v1/health/ready"
HEALTH_TIMEOUT=30

# 日志函数
log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_blue() { echo -e "${BLUE}[INFO]${NC} $*"; }

# 检查 Docker 是否安装
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    if ! docker compose version >/dev/null 2>&1; then
        log_error "Docker Compose is not available. Please install Docker Compose."
        exit 1
    fi
}

# 获取项目根目录
# 服务器场景: manage.sh 在 $DEPLOY_PATH/ 下，docker/ 与之同级
# 本地场景: manage.sh 在 deploy/ 子目录下，docker/ 在上一级
get_project_root() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -d "${script_dir}/docker" ]; then
        echo "$script_dir"
    else
        cd "${script_dir}/.." && pwd
    fi
}

# 检查部署目录根的 .env
check_env_file() {
    local project_root
    project_root=$(get_project_root)
    if [ ! -f "${project_root}/${ENV_FILE}" ]; then
        log_error "${project_root}/${ENV_FILE} not found. Copy docker/.env.ecs.example to it first."
        exit 1
    fi
}

# 检查容器是否运行
container_running() {
    docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# 检查容器是否存在
container_exists() {
    docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# 启动服务
start_services() {
    local project_root
    project_root=$(get_project_root)

    if container_running; then
        log_warn "Services are already running"
        show_status
        return 0
    fi

    log_info "Starting services..."
    cd "$project_root"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

    # 等待健康检查
    log_info "Waiting for API to be healthy..."
    for i in $(seq 1 "$HEALTH_TIMEOUT"); do
        if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api wget -q --spider "$HEALTH_URL" 2>/dev/null; then
            log_info "API is healthy!"
            show_status
            return 0
        fi
        echo -ne "  Attempt $i/$HEALTH_TIMEOUT...\r"
        sleep 5
    done

    log_error "API health check failed after $HEALTH_TIMEOUT attempts"
    show_logs_tail
    exit 1
}

# 停止服务
stop_services() {
    local project_root
    project_root=$(get_project_root)

    if ! container_exists; then
        log_warn "No services running"
        return 0
    fi

    log_info "Stopping services..."
    cd "$project_root"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop
    log_info "Services stopped"
}

# 重启服务
restart_services() {
    local project_root
    project_root=$(get_project_root)

    log_info "Restarting services..."
    cd "$project_root"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" restart

    sleep 3

    if container_running; then
        log_info "Services restarted successfully"
        show_status
    else
        log_error "Services failed to restart"
        show_logs_tail
        exit 1
    fi
}

# 删除服务
remove_services() {
    local project_root
    project_root=$(get_project_root)

    log_info "Removing services and volumes..."
    cd "$project_root"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down -v --remove-orphans
    log_info "Services removed"
}

# 显示服务状态
show_status() {
    local project_root
    project_root=$(get_project_root)

    log_blue "Service Status:"
    cd "$project_root"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
}

# 显示日志
show_logs() {
    local project_root
    project_root=$(get_project_root)

    log_info "Showing logs (press Ctrl+C to exit)..."
    cd "$project_root"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs -f
}

# 显示最近日志（失败排查用）
show_logs_tail() {
    local project_root
    project_root=$(get_project_root)

    log_blue "Recent API logs:"
    cd "$project_root"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs api --tail=30
}

# 健康检查
health_check() {
    if container_running; then
        if wget -q --spider "$HEALTH_URL" 2>/dev/null || curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
            log_info "API is healthy"
        else
            log_error "API is running but health check failed"
            exit 1
        fi
    else
        log_error "API container is not running"
        exit 1
    fi
}

# 清理旧镜像
cleanup_images() {
    local image_pattern="${1:-}"

    if [ -z "$image_pattern" ]; then
        log_error "Usage: $0 cleanup <image-pattern>"
        exit 1
    fi

    log_info "Cleaning up old images for pattern: ${image_pattern}"
    # docker images 默认按创建时间倒序排列（最新在前），直接 tail -n +4 保留最新 3 个
    local old_images
    old_images=$(docker images "$image_pattern" -q | tail -n +4)

    if [ -n "$old_images" ]; then
        echo "$old_images" | xargs -r docker rmi -f || true
        log_info "Old images cleaned up"
    else
        log_info "No old images to clean up"
    fi
}

# 显示帮助
show_help() {
    cat <<EOF
${BLUE}NestJS API Container Management Script${NC}

Usage: $0 [COMMAND]

${GREEN}Commands:${NC}
  start       Start all services (api, postgres, redis)
  stop        Stop all running services
  restart     Restart all services
  remove      Remove all services and volumes
  status      Show services status
  logs        Show and follow service logs
  health      Run API health check
  cleanup     Clean up old Docker images (keep latest 3)
  help        Show this help message

${GREEN}Examples:${NC}
  $0 start              # Start all services
  $0 stop               # Stop all services
  $0 restart            # Restart all services
  $0 logs               # View logs (follow mode)
  $0 health             # Check API health
  $0 cleanup nestjs     # Clean old nestjs images

${GREEN}Configuration:${NC}
  Container:    $CONTAINER_NAME
  Compose file: $COMPOSE_FILE
  Env file:     $ENV_FILE
  Health URL:   $HEALTH_URL

EOF
}

# 主函数
main() {
    check_docker

    local command="${1:-help}"

    case "$command" in
        start|stop|restart|remove|rm|status|ps|logs)
            check_env_file
            ;;
    esac

    case "$command" in
        start)
            start_services
            ;;
        stop)
            stop_services
            ;;
        restart)
            restart_services
            ;;
        remove|rm)
            remove_services
            ;;
        status|ps)
            show_status
            ;;
        logs)
            show_logs
            ;;
        health)
            health_check
            ;;
        cleanup)
            cleanup_images "${2:-}"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"
