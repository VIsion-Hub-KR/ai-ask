# AI Ask

4개 AI(Notion AI, Gemini, ChatGPT, Claude)에 동시에 질문하는 도구.

## 사전 준비

- macOS
- Google Chrome 설치
- Node.js 18+ 설치 (https://nodejs.org)
- pnpm 설치: `npm install -g pnpm`

## 설치 (최초 1회)

```bash
# 1. 레포 클론
git clone https://github.com/orot-ai/ai-ask.git
cd ai-ask

# 2. 의존성 설치
pnpm install
```

## 실행

```bash
pnpm start
```

또는 Finder에서 `AI-Ask.command` 더블클릭.

## 최초 실행 시

4개 브라우저 창이 열립니다 (Notion, Gemini, ChatGPT, Claude).

1. **각 창에서 본인 계정으로 로그인**
2. 4개 다 로그인했으면 **터미널에서 Enter**
3. 끝! 다음부터는 자동 로그인됩니다.

## 사용법

아무 곳에서나 `!`로 시작하는 텍스트를 **복사(Cmd+C)** 하면 4개 AI에 동시 전송됩니다.

```
!봄에 대한 시 써줘
!이 에러 메시지 뭔지 설명해줘
!마케팅 문구 3개 만들어줘
```

`!` 없이 복사하면 아무 일도 안 일어나니까 안심하세요.

## 종료

터미널에서 `Ctrl+C` 또는 브라우저 창을 닫으면 됩니다.

## 데이터 저장 위치

- `~/.ai-ask/profile/` — 브라우저 프로필 (로그인 세션, 개인 PC에만 저장)
- `~/.ai-ask/config.json` — 설정

> 로그인 정보는 각자의 PC에만 저장되며 Git에 올라가지 않습니다.
