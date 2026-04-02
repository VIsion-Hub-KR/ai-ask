#!/bin/zsh
cd "$(dirname "$0")"

# 이전 프로세스 정리
pkill -f "node browser.mjs" 2>/dev/null
rm -f ~/.ai-ask/profile/SingletonLock 2>/dev/null
sleep 1

echo "📦 의존성 확인 중..."
[ -d node_modules ] || npm install
echo ""
/usr/local/bin/node browser.mjs
echo ""
read -k 1 "?프로그램 종료: 아무 키나 누르세요"
