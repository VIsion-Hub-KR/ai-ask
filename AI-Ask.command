#!/bin/bash
cd "$(dirname "$0")"
echo "📦 의존성 확인 중..."
[ -d node_modules ] || npm install
echo ""
node browser.mjs
