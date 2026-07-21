# AI Ask — macOS GUI 앱 설계

날짜: 2026-07-21
상태: 승인됨 (설계 확정)

## 목표

지금 터미널에서 도는 `browser.mjs` 스크립트를, 맥에서 아이콘 더블클릭으로 켜는 **버튼 있는 GUI 앱**으로 만든다. 기능은 두 가지.

1. **모드 1 — 4개 AI 동시** (기존 기능 그대로): 노션 AI·제미나이·챗지피티·클로드 창 4개를 띄우고, 클립보드로 `!질문` 복사→동시 전송 / `!!` 복사→답변 수집.
2. **모드 2 — 같은 AI 4개 (독립)** (신규): 노션/제미나이/챗지피티/클로드 중 **하나를 고르면 그 AI 창만 4개**를 띄운다. 클립보드 감시·자동 전송·자동 수집 **없음**. 사용자가 각 창에 직접 타이핑하는 완전 독립.

## 확정된 결정 (사용자 승인)

- 앱 형태: **진짜 GUI 앱** (버튼 있는 Electron 창).
- 독립 모드: **각 창 따로** (전송/수집 자동화 없음).
- 기존 4개 AI 모드: **클립보드 방식 그대로 유지**.
- 독립 모드 AI 선택 UI: **버튼 4개** (드롭다운 아님).
- **한 번에 한 세션만** 실행 (모드 1·2 동시 실행 불가). 로그인 프로필을 공유하기 때문 — 크롬이 같은 프로필을 두 번 못 연다. 대신 로그인은 두 모드가 공유해 한 번만 하면 됨.

## 아키텍처

**Electron 컨트롤 패널(버튼 창) + Playwright가 시스템 크롬을 구동** (엔진은 기존 코드 재사용).

```
Electron 메인 프로세스 (Node)
 ├─ BrowserWindow: 버튼 UI (index.html)
 └─ 버튼 클릭 IPC 수신 → ai-controller 호출
        │
        ▼
   Playwright.launchPersistentContext(
       userDataDir = ~/.ai-ask/profile,        // 로그인 공유
       executablePath = 설치된 Google Chrome)   // 크로미움 내장 안 함 → 앱 가벼움
        │
        ▼
   화면에 나란히 뜨는 크롬 창 4개
```

왜 이 방식인가: 내장 웹뷰(Electron BrowserView) 안에서는 **구글 로그인이 차단**(disallowed_useragent)되어 제미나이 등 구글 로그인 기반 서비스가 막힌다. 실제 크롬을 구동하면 로그인이 정상 작동하고, 지금 잘 되는 전송/수집 코드를 그대로 쓸 수 있다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `main.cjs` | Electron 메인. 버튼 창 생성, IPC 수신, 세션 상태(실행 중/꺼짐) 관리, 앱 종료 시 크롬 정리 |
| `preload.cjs` | contextIsolation 환경에서 렌더러에 안전한 API 노출 (`window.aiAsk.launchMulti()`, `launchSolo(ai)`, `stop()`, `onStatus(cb)`) |
| `index.html` | 버튼 UI (목업대로). 인라인 CSS/JS. 상태 표시·버튼 잠금 처리 |
| `ai-controller.cjs` | 기존 `browser.mjs`를 정리·이관. Playwright 구동 + 전송/수집/클립보드 로직. `launchMulti()` / `launchSolo(aiName)` / `stop()` 노출 |
| `browser.mjs` | **얇은 래퍼로 전환**. controller를 로드해 `launchMulti()`만 호출 → `node browser.mjs` 터미널 직접 실행 유지, 로직 중복 제거. (`pnpm start`는 electron으로 바뀌므로 CLI는 `node browser.mjs`로 실행) |
| `package.json` | `main`을 `main.cjs`로, electron 의존성 추가, `start`=electron, `dist`=electron-builder |

모듈 형식: controller는 **CommonJS(.cjs)** 로 통일해 `require('playwright')`로 로드 (Electron 메인 CJS와 정합).

## 모듈 인터페이스 (ai-controller.cjs)

- `launchMulti()` — services 4개(노션·제미나이·챗지피티·클로드) 창을 positions 타일로 띄우고 **클립보드 감시 시작** (`!질문`→sendToAll, `!!`→collectAll). 기존 동작 그대로.
- `launchSolo(aiName)` — `aiName` 하나의 URL로 **같은 창 4개**를 positions 타일로 띄움. **클립보드 감시·전송·수집 없음.**
- `stop()` — 클립보드 감시 인터벌 해제 + 크롬 컨텍스트 close.
- 상태 콜백으로 메인에 `{running, mode, ai}` 통지 → UI 갱신.

기존 함수 재사용: `sendToNotion/Gemini/ChatGPT/Claude`, `collectFrom*`, `positions`, `services`, `launchPersistentContext` 설정.

## 동작 상세

**세션 단일성**: 메인이 `running` 플래그 보유. 실행 중이면 모든 실행 버튼 잠금(UI opacity + 클릭 무시), 닫기 버튼만 활성. `stop()` 후 잠금 해제.

**최초 로그인**: 터미널 `stdin` Enter 게이트는 **제거**(GUI엔 stdin 없음). 창은 그냥 열려 있고 사용자가 필요 시 로그인, 세션은 `~/.ai-ask/profile`에 지속. 로그인 전 전송 시도는 기존 try/catch로 `✗` 반환하며 안전 실패. 첫 실행 안내 문구는 UI에 1줄 표기.

**독립 모드 전송/수집 없음**: `launchSolo`는 clipboard `setInterval`을 **시작하지 않는다**. 창 4개만 띄우고 끝.

**종료**: 앱 창을 닫거나 종료 버튼 → `stop()`으로 크롬 컨텍스트 정리(프로필 락 해제) 후 앱 종료.

## 패키징

`package.json`의 기존 electron-builder 설정 활용 → `.dmg`/`.zip`. 아이콘은 기존 `AppIcon.icns`/`assets/` 사용. 시스템 Google Chrome 필요(기존 요구사항 동일, README 유지).

## 범위 밖 (YAGNI)

- 모드 1·2 동시 실행 (프로필 분리·별도 로그인 필요 → v1 제외).
- 독립 모드에 전송/수집 자동화 추가.
- AI 목록 커스터마이즈, 창 개수 변경, 창 배치 커스터마이즈.
- 자동 업데이트, 코드 서명/공증(로컬 배포 우선).

## 리스크

- 각 AI 사이트 DOM 변경 시 셀렉터 깨짐(기존과 동일한 상시 리스크). 모드 1에만 해당, 모드 2는 전송 로직이 없어 영향 없음.
- Electron + 시스템 크롬 동시 구동 시 리소스. 창 8개 이상 뜨지 않도록 세션 단일성으로 방지.
