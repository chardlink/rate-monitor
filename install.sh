#!/bin/bash

# ==============================================================================
#  汇率实时提醒助手 - Ubuntu/Debian 一键部署脚本
#  支持环境：Ubuntu 20.04+, Debian 11+
# ==============================================================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # 无颜色

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}    🚀 欢迎使用 汇率实时提醒助手 一键原生部署脚本 (Ubuntu/Debian) ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""

# 1. 权限检测
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ 错误：请使用 root 权限或 sudo 运行此脚本！${NC}"
  echo "示例: sudo bash install.sh"
  exit 1
fi

# 2. 系统检测与包更新
echo -e "${YELLOW}[1/6] 正在更新系统软件包列表...${NC}"
apt-get update -y
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ 警告：apt update 失败，尝试继续安装...${NC}"
fi

# 3. 安装基础依赖 (Git, Curl)
echo -e "${YELLOW}[2/6] 正在安装基础工具 (Git, Curl)...${NC}"
apt-get install -y git curl
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ 错误：安装基础依赖工具失败，请检查您的网络连接。${NC}"
  exit 1
fi

# 4. 检测并安装 Node.js 与 npm
echo -e "${YELLOW}[3/6] 正在检测 Node.js 运行环境...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${BLUE}ℹ️ 未检测到 Node.js，正在为您自动下载安装最新稳定版 (Node.js 18)...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 错误：Node.js 安装失败，请尝试手动安装。${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Node.js 安装成功: $(node -v)${NC}"
else
  echo -e "${GREEN}✓ 检测到已安装 Node.js: $(node -v)${NC}"
fi

# 5. 克隆或更新项目代码
INSTALL_DIR="/var/www/rate-monitor"
echo -e "${YELLOW}[4/6] 正在部署项目代码至目录: ${INSTALL_DIR}...${NC}"

if [ -d "$INSTALL_DIR" ]; then
  echo -e "${BLUE}ℹ️ 检测到目标目录已存在，正在拉取最新代码...${NC}"
  cd "$INSTALL_DIR"
  git fetch --all
  git reset --hard origin/main
else
  echo -e "${BLUE}ℹ️ 正在克隆您的 GitHub 仓库...${NC}"
  git clone https://github.com/chardlink/rate-monitor.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 创建持久化存储目录并授权
mkdir -p "$INSTALL_DIR/data"
chmod -R 777 "$INSTALL_DIR/data"

# 6. 安装依赖包
echo -e "${YELLOW}[5/6] 正在安装项目生产环境依赖...${NC}"
npm install --only=production
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ 错误：依赖包安装失败，请检查 npm 连接。${NC}"
  exit 1
fi

# 7. 全局安装并配置 PM2 进程守护
echo -e "${YELLOW}[6/6] 正在配置后台进程守护 (PM2)...${NC}"
if ! command -v pm2 &> /dev/null; then
  echo -e "${BLUE}ℹ️ 正在全局安装 pm2 进程管理器...${NC}"
  npm install -g pm2
fi

# 启动 Node.js 服务
echo -e "${BLUE}ℹ️ 正在通过 PM2 启动服务...${NC}"
pm2 stop rate-monitor &> /dev/null || true
pm2 delete rate-monitor &> /dev/null || true
PORT=1180 pm2 start server.js --name "rate-monitor"

# 保存并设置开机自动启动
pm2 save
pm2 startup systemd &> /dev/null || true

# 8. 完成安装并展示访问说明
echo ""
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}        🎉 恭喜！汇率实时提醒助手已成功原生部署在后台！${NC}"
echo -e "${GREEN}================================================================${NC}"
echo ""

# 获取服务器公网/内网IP
IP_ADDR=$(hostname -I | awk '{print $1}')
if [ -z "$IP_ADDR" ]; then
  IP_ADDR="您的服务器IP"
fi

echo -e "🌎 ${BLUE}访问地址：${NC} http://${IP_ADDR}:1180"
echo -e "📂 ${BLUE}代码安装目录：${NC} ${INSTALL_DIR}"
echo -e "💾 ${BLUE}数据持久化存储：${NC} ${INSTALL_DIR}/data (支持 30 天历史及设置永久保存)"
echo ""
echo -e "📊 ${YELLOW}如何管理后台监控服务？${NC}"
echo -e "  - 查看服务实时运行状态: ${GREEN}pm2 status${NC}"
echo -e "  - 查看后台实时日志输出: ${GREEN}pm2 logs rate-monitor${NC}"
echo -e "  - 重启监控服务: ${GREEN}pm2 restart rate-monitor${NC}"
echo -e "  - 停止监控服务: ${GREEN}pm2 stop rate-monitor${NC}"
echo ""
echo -e "⚠️  ${RED}重要提醒：${NC}如网页无法打开，请确保服务器防火墙或云安全组的 ${YELLOW}1180 端口${NC} 已对外开放。"
echo -e "${BLUE}================================================================${NC}"
