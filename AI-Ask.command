#!/bin/zsh
cd "$(dirname "$0")"

# 이전 세션의 프로필 락 잔재 정리
rm -f ~/.ai-ask/profile/SingletonLock 2>/dev/null

# node 경로 확보 (Finder 더블클릭 시 PATH가 최소일 수 있어 명시)
NODE="/usr/local/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"

echo "📦 의존성 확인 중..."
[ -d node_modules ] || "$NODE" -e "require('child_process').execSync('npm install',{stdio:'inherit'})"

echo "🚀 AI Ask 실행 중..."
echo "   (이 터미널 창은 앱이 켜져 있는 동안 열려 있습니다. 창을 닫으면 앱도 종료됩니다.)"

# GUI(Electron) 앱 실행. ELECTRON_RUN_AS_NODE가 켜져 있으면 GUI가 안 뜨므로 해제.
unset ELECTRON_RUN_AS_NODE
"$NODE" ./node_modules/electron/cli.js .
