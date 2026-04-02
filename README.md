# AI Ask

4개 AI(Notion AI, Gemini, ChatGPT, Claude)에 동시에 질문하는 도구.

## 설치

```bash
git clone <repo-url>
cd ai-ask
pnpm install
npx playwright install chromium
```

> Chrome이 `/Applications/Google Chrome.app`에 설치되어 있어야 합니다.

## 실행

```bash
pnpm start
```

또는 Finder에서 `AI-Ask.command` 더블클릭.

## 사용법

1. 첫 실행 시 4개 창이 열림 → 각 서비스에 로그인 → 터미널에서 Enter
2. 이후 실행부터는 자동 로그인
3. `!질문내용`을 복사(Cmd+C)하면 4개 AI에 동시 전송

## 예시

`!한국어로 짧은 시 써줘` 복사 → Notion AI, Gemini, ChatGPT, Claude에 동시 전달

## 데이터 저장 위치

- `~/.ai-ask/profile/` — 브라우저 프로필 (로그인 세션)
- `~/.ai-ask/config.json` — 설정
