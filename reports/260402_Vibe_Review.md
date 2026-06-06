================================================
  VIBE CODING REVIEW - 2026-04-02
================================================

## 세션 요약
AI-Ask 앱 개선: Notion AI URL 변경, 창 배치 4x1 분할, Claude 전송 문제 해결, 앱 아이콘 생성, 실행 안정성 강화

변경 파일: 24개 | +146줄 / -19줄
커밋: 1개 (afcdf4b)

## 주요 변경사항

### browser.mjs (핵심 로직)
- Notion URL: `notion.so` → `notion.so/ai` 로 변경
- 창 배치: 2x2 분할(960x540) → 4x1 분할(514x1400)로 변경
- Gemini 전송: `input.fill()` → `keyboard.type()` + 타임아웃 5초 설정
- Claude 전송: `input.fill()` + `Enter` → `execCommand('insertText')` + `button[aria-label="메시지 보내기"]` 클릭
- 페이지 로드: `page.goto(url)` → `page.goto(url, { waitUntil: 'load', timeout: 20000 })` + try/catch 추가

### AI-Ask.command (실행 스크립트)
- `#!/bin/bash` → `#!/bin/zsh` 변경
- 이전 프로세스 자동 정리 (pkill + SingletonLock 삭제) 추가
- node 절대경로 `/usr/local/bin/node` 사용
- 프로그램 종료 시 `read` 대기 추가

### AI-Ask.app (macOS 앱 번들)
- .app 번들 새로 생성 (Info.plist, PkgInfo, MacOS/AI-Ask)
- 실행 파일: `open -a Terminal AI-Ask.command` 방식으로 터미널과 함께 실행
- 커스텀 앱 아이콘 생성 및 적용 (4색 원형 로고)

## 의사결정 복기

### 1. Claude 전송 방식 (가장 큰 난관)
- **문제**: Claude.ai의 Tiptap/ProseMirror 에디터에서 `fill()` + `Enter`가 작동하지 않음
- **시도한 방법들**:
  1. `input.fill()` + `Enter` → 줄바꿈만 됨 (실패)
  2. `keyboard.type()` + `Enter` → 줄바꿈만 됨 (실패)
  3. `keyboard.type()` + 전송 버튼 클릭 (선택자 오류) → 실패
  4. `input.fill()` + `evaluate()`로 버튼 찾기 → 실패
  5. `execCommand('insertText')` + `Enter` → 줄바꿈 (실패)
  6. `execCommand('insertText')` + `button[aria-label="메시지 보내기"]` 클릭 → **성공!**
- **핵심 발견**: Tiptap 에디터는 `fill()`과 `keyboard.type()` 모두 Enter를 줄바꿈으로 처리. `execCommand`로 텍스트 삽입 + 전송 버튼 직접 클릭이 유일한 해결책
- **디버깅 방법**: `page.evaluate()`로 DOM을 스캔하여 모든 button 요소의 aria-label, 위치, 크기를 출력 → `aria-label="메시지 보내기"` 발견

### 2. 각 AI별 전송 방식이 모두 다름
- **Notion**: `Meta+j` 단축키로 AI 패널 열기 → `fill()` + `Enter`
- **Gemini**: `keyboard.type()` + `Enter` (fill이 안 되는 에디터)
- **ChatGPT**: `fill()` + `Enter` (표준적인 방식)
- **Claude**: `execCommand('insertText')` + 전송 버튼 클릭 (가장 까다로움)
- **교훈**: 각 AI 서비스마다 에디터 구현이 달라서 동일한 자동화 방식을 적용할 수 없음

### 3. AI-Ask.app 실행 문제
- **문제**: .app 번들이 백그라운드에서 실행되어 에러가 보이지 않음
- **해결**: `open -a Terminal` 명령으로 터미널을 열어서 AI-Ask.command 실행
- **추가 문제**: Chrome SingletonLock 파일이 남아서 중복 실행 방지 → AI-Ask.command에 자동 정리 코드 추가

### 4. 창 배치 변경
- 2x2 → 4x1로 변경 (사용자 모니터에 맞춤)
- 속도 최적화 시도 (500ms→100ms) → 창 배치가 깨져서 원래 속도로 복원
- **교훈**: 대기 시간을 줄이면 CDP 윈도우 배치가 불안정해짐

## 코드 품질 체크

[OK] 에러 처리: 모든 전송 함수에 try/catch 적용
[OK] 페이지 로드: timeout과 waitUntil 옵션 추가
[OK] 프로세스 관리: SingletonLock 자동 정리
[WARN] `document.execCommand`는 deprecated API - 현재는 작동하지만 장기적으로 대안 필요
[WARN] Claude 전송 버튼 `aria-label="메시지 보내기"` - UI 업데이트 시 깨질 수 있음 (한국어 의존)
[WARN] 하드코딩된 positions 값 (514px, 1400px) - 모니터 해상도에 따라 조정 필요
[WARN] Chrome 실행 경로 하드코딩 (`/Applications/Google Chrome.app`)
[FIX] 없음 - 현재 모든 기능 정상 작동

## 학습 포인트

1. **Tiptap/ProseMirror 에디터 자동화**: `fill()`과 `keyboard.type()` 모두 ProseMirror의 키 바인딩에 의해 Enter가 줄바꿈으로 처리됨. `execCommand('insertText')`가 유일한 텍스트 삽입 방법
2. **Playwright 디버깅 기법**: `page.evaluate()`로 DOM을 직접 스캔하여 요소의 aria-label, 위치, 크기를 출력하는 방식이 선택자를 찾는 가장 확실한 방법
3. **macOS .app 번들 구조**: Info.plist + PkgInfo + MacOS/실행파일 + Resources/아이콘 으로 구성. 쉘 스크립트도 실행 파일로 사용 가능
4. **Chrome SingletonLock**: Playwright가 Chrome을 persistent context로 실행하면 프로필 디렉토리에 SingletonLock 파일이 생성됨. 비정상 종료 시 잔존하여 재실행 차단
5. **iconutil**: macOS에서 .iconset 폴더 → .icns 변환 도구. 다양한 크기의 PNG를 준비해야 함
6. **각 AI 서비스별 에디터 차이**: Notion(자체 에디터), Gemini(ql-editor), ChatGPT(prompt-textarea), Claude(Tiptap ProseMirror) - 모두 다른 자동화 전략 필요

## 다음 할 일

- [개선] Claude 전송 버튼 선택자를 `aria-label` 외에 `data-testid` 등 안정적인 선택자로 보강
- [개선] 모니터 해상도 자동 감지하여 positions 동적 계산
- [개선] `execCommand` deprecated 대안 조사 (Tiptap API 직접 호출 가능성)
- [개선] Notion AI 전송 방식 검증 (Meta+j 단축키 의존성)
- [계속] AI-Ask.app 아이콘 디자인 개선 (더 세련된 디자인)

================================================
