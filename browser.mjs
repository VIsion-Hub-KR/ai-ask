// 터미널 직접 실행용 폴백: 4개 AI 모드만 구동한다.
// 엔진 로직은 ai-controller.cjs에 있고, GUI 앱(main.cjs)과 공유한다.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const controller = require('./ai-controller.cjs');

console.log('🚀 AI Ask (CLI) — 4개 AI 모드 시작 중...\n');
await controller.launchMulti();

console.log('\n════════════════════════════════════════');
console.log('  AI Ask 준비 완료!');
console.log('  !질문  → 4개 AI에 동시 전송');
console.log('  !!     → 4개 AI 답변 수집(클립보드)');
console.log('  종료: Ctrl+C');
console.log('════════════════════════════════════════\n');
