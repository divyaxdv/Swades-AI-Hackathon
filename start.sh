#!/usr/bin/env bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 2>/dev/null || true
nvm use

docker compose -f packages/db/docker-compose.yml up -d
sleep 3
npm run db:push
npm run dev
