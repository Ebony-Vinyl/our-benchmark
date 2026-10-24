#!/bin/bash
# Our Benchmark 服务器部署脚本（从本机经 SOCKS 代理部署到 144.126.133.165）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_DIR="/d/ofm-ssh"
export DISPLAY=:0
export SSH_ASKPASS="$SSH_DIR/askpass.sh"
export SSH_ASKPASS_REQUIRE=force

SSH_OPTS=(-o ConnectTimeout=30
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$SSH_DIR/known_hosts"
  -o PreferredAuthentications=publickey
  -o ServerAliveInterval=30
  -o ProxyCommand="python '$SSH_DIR/socks_proxy.py' %h %p"
  -i "$SSH_DIR/ofm-handover-root-ed25519")
HOST=root@144.126.133.165

echo "==> 打包（服务器代码 + 公网站点 + 题库）"
cd "$DIR/.."
tar czf /tmp/ob-deploy.tar.gz server package.json data/benchmarks-full

echo "==> 上传"
scp "${SSH_OPTS[@]}" -o ConnectTimeout=60 /tmp/ob-deploy.tar.gz "$HOST":/tmp/ob-deploy.tar.gz

echo "==> 远程安装与启动"
ssh "${SSH_OPTS[@]}" "$HOST" 'bash -s' <<'REMOTE'
set -e
mkdir -p /opt/our-benchmark
tar xzf /tmp/ob-deploy.tar.gz -C /opt/our-benchmark
cd /opt/our-benchmark

# Node 22（若未装）
if ! command -v node >/dev/null 2>&1; then
  echo "安装 Node.js 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
node --version

# 依赖（仅 express）
if [ ! -d node_modules/express ]; then
  npm install --omit=dev --no-audit --no-fund >/dev/null
fi

# GitHub OAuth 凭据占位（用户可编辑后 restart）
if [ ! -f /opt/our-benchmark/env ]; then
  cat > /opt/our-benchmark/env <<'EOF'
# GitHub OAuth（可选）：创建 GitHub OAuth App 后填入并 systemctl restart our-benchmark
# Redirect URI 填: http://144.126.133.165:8600/api/v1/auth/github/callback
#GITHUB_CLIENT_ID=
#GITHUB_CLIENT_SECRET=
EOF
fi

# systemd 服务
cat > /etc/systemd/system/our-benchmark.service <<'EOF'
[Unit]
Description=Our Benchmark Server (大模型跑分榜)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/our-benchmark/server
Environment=PORT=8600
Environment=PUBLIC_URL=http://144.126.133.165:8600
Environment=DATASETS_DIR=/opt/our-benchmark/data/benchmarks-full
EnvironmentFile=-/opt/our-benchmark/env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable our-benchmark >/dev/null 2>&1
systemctl restart our-benchmark
sleep 2
systemctl is-active our-benchmark
echo "--- health ---"
curl -s http://127.0.0.1:8600/api/v1/health
echo
echo "--- datasets ---"
curl -s http://127.0.0.1:8600/api/v1/datasets | head -c 400
echo
REMOTE

echo "==> 完成"
