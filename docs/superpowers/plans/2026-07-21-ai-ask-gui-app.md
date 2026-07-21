# AI Ask GUI 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 터미널 스크립트 `browser.mjs`를, 버튼 2개(4개 AI 동시 / 같은 AI 4개 독립)를 가진 맥 GUI 앱(Electron)으로 만든다.

**Architecture:** Electron 메인 프로세스가 버튼 창(renderer)을 띄우고, 버튼 클릭을 IPC로 받아 `ai-controller.cjs`(Playwright로 시스템 Google Chrome 구동)를 호출한다. 로그인 프로필(`~/.ai-ask/profile`)을 공유하며 한 번에 한 세션만 실행한다.

**Tech Stack:** Electron, Playwright(설치된 Google Chrome 구동), Node CommonJS.

## Global Constraints

- macOS 전용. 시스템 Google Chrome 필요(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
- 로그인 프로필 공유: `~/.ai-ask/profile` (userDataDir). 크롬이 같은 프로필 두 번 못 열므로 **동시 세션 1개**.
- 모드 2(독립)는 클립보드 감시·자동 전송·자동 수집을 **하지 않는다**.
- 모드 1(4개 AI)의 전송/수집 동작·셀렉터는 기존 `browser.mjs`와 **동일하게 보존**.
- 4개 AI 순서/URL/창 위치: Notion(`https://www.notion.so/ai`), Gemini(`https://gemini.google.com/app`), ChatGPT(`https://chatgpt.com`), Claude(`https://claude.ai`). positions: 좌→우 514px 폭 타일 4개.
- 시크릿 노출 금지, 프로젝트 폴더 밖 수정 금지.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `ai-controller.cjs` | (신규) Playwright 구동 엔진. `launchMulti()`/`launchSolo(ai)`/`stop()`/`onStatus(cb)`. 기존 전송·수집·클립보드 로직 이관 |
| `browser.mjs` | (수정) 얇은 CLI 래퍼. controller 로드 후 `launchMulti()`만 호출 |
| `main.cjs` | (신규) Electron 메인. 버튼 창 생성, IPC 수신, 세션 단일성, 종료 정리 |
| `preload.cjs` | (신규) 렌더러에 `window.aiAsk` API 안전 노출 |
| `index.html` | (신규) 버튼 UI(목업대로) + 상태/잠금 처리 |
| `package.json` | (수정) `main`→`main.cjs`, electron devDep, scripts, builder icon 경로 |
| `assets/icon.icns` | (신규) 루트 `AppIcon.icns` 복사본 (electron-builder 참조 경로) |

---

## Task 1: 엔진 분리 — ai-controller.cjs + browser.mjs 래퍼화

**Files:**
- Create: `ai-controller.cjs`
- Modify: `browser.mjs` (전체 교체)
- Test: `test-controller.cjs` (순수 헬퍼 단위 검증)

**Interfaces:**
- Produces:
  - `resolveSolo(aiName: string) → { name, url } | null` — 순수 함수. 잘못된 이름이면 null.
  - `launchMulti(): Promise<void>` — 4개 AI 창 + 클립보드 감시 시작 (기존 동작).
  - `launchSolo(aiName: string): Promise<void>` — 같은 AI 창 4개, 클립보드 감시 없음.
  - `stop(): Promise<void>` — 인터벌 해제 + 컨텍스트 close.
  - `onStatus(cb: (s:{running:boolean,mode:?string,ai:?string}) => void): void`
  - `AI_LIST: [{key,name,url}]` — UI가 참조할 4개 AI 목록.

- [ ] **Step 1: `resolveSolo`의 실패 테스트 작성** — `test-controller.cjs`

```js
const assert = require('assert');
const { resolveSolo, AI_LIST } = require('./ai-controller.cjs');

// 유효한 키 4개
for (const ai of ['notion','gemini','chatgpt','claude']) {
  const r = resolveSolo(ai);
  assert.ok(r && r.url && r.name, `resolveSolo(${ai}) 유효해야 함`);
}
// 잘못된 키
assert.strictEqual(resolveSolo('bard'), null, '잘못된 키는 null');
assert.strictEqual(AI_LIST.length, 4, 'AI 4개');
console.log('OK: resolveSolo/AI_LIST');
```

- [ ] **Step 2: 실패 확인**

Run: `node test-controller.cjs`
Expected: FAIL (`Cannot find module './ai-controller.cjs'`)

- [ ] **Step 3: `ai-controller.cjs` 작성** — 기존 `browser.mjs` 로직을 CJS로 이관하고 solo/stop/status 추가

```js
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { existsSync, mkdirSync } = require('fs');
const { homedir } = require('os');

const TRIGGER_PREFIX = '!';
const COLLECT_PREFIX = '!!';
const PROFILE_DIR = `${homedir()}/.ai-ask/profile`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const AI_LIST = [
  { key: 'notion',  name: 'Notion',  url: 'https://www.notion.so/ai' },
  { key: 'gemini',  name: 'Gemini',  url: 'https://gemini.google.com/app' },
  { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com' },
  { key: 'claude',  name: 'Claude',  url: 'https://claude.ai' },
];

const positions = [
  { left: 0,    top: 0, width: 514, height: 1400 },
  { left: 514,  top: 0, width: 514, height: 1400 },
  { left: 1028, top: 0, width: 514, height: 1400 },
  { left: 1542, top: 0, width: 514, height: 1400 },
];

function resolveSolo(aiName) {
  return AI_LIST.find(a => a.key === aiName) || null;
}

let context = null;
let clipboardTimer = null;
let statusCb = () => {};
function onStatus(cb) { statusCb = cb; }
function emit(s) { try { statusCb(s); } catch {} }

// ── 창 4개 띄우기 (공통) ──
// windowSpecs: [{name,url}] 길이 4. 반환: { [name]: page }
async function openWindows(windowSpecs) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    executablePath: CHROME,
    args: ['--disable-blink-features=AutomationControlled','--no-first-run','--no-default-browser-check'],
    viewport: null,
  });
  const pages = {};
  for (let i = 0; i < windowSpecs.length; i++) {
    const { name, url } = windowSpecs[i];
    let page;
    if (i === 0) {
      page = context.pages()[0] || await context.newPage();
    } else {
      const cdp = await context.newCDPSession(context.pages()[0]);
      await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
      await new Promise(r => setTimeout(r, 500));
      const all = context.pages();
      page = all.find(p => p.url() === 'about:blank' && !Object.values(pages).includes(p)) || all[all.length - 1];
    }
    const s = await context.newCDPSession(page);
    const { windowId } = await s.send('Browser.getWindowForTarget');
    await s.send('Browser.setWindowBounds', { windowId, bounds: positions[i] });
    try { await page.goto(url, { waitUntil: 'load', timeout: 20000 }); } catch {}
    await page.waitForTimeout(1000);
    // 같은 AI 4개일 때 name이 겹치므로 키에 인덱스 부여
    pages[`${name}#${i}`] = page;
  }
  return pages;
}

// ── 전송/수집 (기존 browser.mjs와 동일 셀렉터) ──
async function sendToNotion(page, text) {
  try {
    await page.keyboard.press('Meta+j');
    await page.waitForTimeout(1500);
    const input = page.locator('[placeholder*="무엇이든"], [placeholder*="Ask"], [role="textbox"]').last();
    await input.click(); await input.fill(text);
    await page.waitForTimeout(300); await page.keyboard.press('Enter');
    return '✓';
  } catch (e) { return '✗ ' + e.message.slice(0, 40); }
}
async function sendToGemini(page, text) {
  try {
    const input = page.locator('.ql-editor, [contenteditable="true"], [role="textbox"], textarea').first();
    await input.click({ timeout: 5000 });
    await page.evaluate((t) => {
      const ed = document.querySelector('.ql-editor, [contenteditable="true"], [role="textbox"]');
      ed.focus(); document.execCommand('insertText', false, t);
    }, text);
    await page.waitForTimeout(300); await page.keyboard.press('Enter');
    return '✓';
  } catch (e) { return '✗ ' + e.message.slice(0, 40); }
}
async function sendToChatGPT(page, text) {
  try {
    const input = page.locator('#prompt-textarea').first();
    await input.click(); await input.fill(text);
    await page.waitForTimeout(300); await page.keyboard.press('Enter');
    return '✓';
  } catch (e) { return '✗ ' + e.message.slice(0, 40); }
}
async function sendToClaude(page, text) {
  try {
    await page.evaluate((t) => {
      const ed = document.querySelector('div.tiptap.ProseMirror');
      ed.focus(); document.execCommand('insertText', false, t);
    }, text);
    await page.waitForTimeout(500);
    await page.locator('button[aria-label="메시지 보내기"]').click({ timeout: 3000 });
    return '✓';
  } catch (e) { return '✗ ' + e.message.slice(0, 40); }
}

// name(#index 제거) → send 함수
const SENDERS = { Notion: sendToNotion, Gemini: sendToGemini, ChatGPT: sendToChatGPT, Claude: sendToClaude };

async function collectFromNotion(page) {
  try { return (await page.evaluate(() => {
    const m = document.querySelectorAll('[class*="response"],[class*="answer"],[class*="output"],[data-block-id]');
    const last = m[m.length-1]; return last ? last.innerText.trim() : '';
  })) || '(답변을 찾을 수 없음)'; } catch (e) { return '(수집 실패: ' + e.message.slice(0,30) + ')'; }
}
async function collectFromGemini(page) {
  try { return (await page.evaluate(() => {
    const all = document.querySelectorAll('[class*="response"],[class*="message"],[class*="model"],[class*="answer"],[class*="markdown"],[class*="content"]');
    let longest=''; all.forEach(el=>{const t=el.innerText.trim(); if(t.length>longest.length && el.offsetHeight>0) longest=t;}); return longest;
  })) || '(답변을 찾을 수 없음)'; } catch (e) { return '(수집 실패: ' + e.message.slice(0,30) + ')'; }
}
async function collectFromChatGPT(page) {
  try { return (await page.evaluate(() => {
    const r = document.querySelectorAll('[data-message-author-role="assistant"]');
    const last = r[r.length-1]; return last ? last.innerText.trim() : '';
  })) || '(답변을 찾을 수 없음)'; } catch (e) { return '(수집 실패: ' + e.message.slice(0,30) + ')'; }
}
async function collectFromClaude(page) {
  try { return (await page.evaluate(() => {
    const r = document.querySelectorAll('[data-is-streaming],.font-claude-message,[class*="response"],[class*="message"]');
    const last = r[r.length-1]; return last ? last.innerText.trim() : '';
  })) || '(답변을 찾을 수 없음)'; } catch (e) { return '(수집 실패: ' + e.message.slice(0,30) + ')'; }
}
const COLLECTORS = { Notion: collectFromNotion, Gemini: collectFromGemini, ChatGPT: collectFromChatGPT, Claude: collectFromClaude };

// ── 모드 1: 4개 AI + 클립보드 감시 ──
async function launchMulti() {
  const pages = await openWindows(AI_LIST.map(a => ({ name: a.name, url: a.url })));
  // name#0 형태 → 원래 name으로 매핑 (4개가 서로 다른 AI이므로 각 1개)
  const byName = {};
  for (const key of Object.keys(pages)) byName[key.split('#')[0]] = pages[key];

  function getClipboard() { try { return execSync('pbpaste', { encoding: 'utf-8' }).trim(); } catch { return ''; } }
  let last = getClipboard(); let busy = false;

  async function sendToAll(text) {
    const results = await Promise.all(Object.entries(byName).map(([n,p]) => SENDERS[n](p, text).then(r=>[n,r])));
    results.forEach(([n,r]) => console.log(`  ${r} ${n}`));
  }
  async function collectAll() {
    const entries = Object.entries(byName);
    const parts = await Promise.all(entries.map(([n,p]) => COLLECTORS[n](p)));
    const out = parts.map((t,i)=>`<답변${i+1}>\n${t}\n</답변${i+1}>`).join('\n\n');
    execSync('pbcopy', { input: out });
    console.log('  ✅ 4개 AI 답변 클립보드 복사 완료');
  }

  clipboardTimer = setInterval(async () => {
    if (busy) return;
    const cur = getClipboard();
    if (cur && cur !== last) {
      last = cur;
      if (cur === COLLECT_PREFIX) { busy=true; await collectAll(); last=getClipboard(); busy=false; }
      else if (cur.startsWith(TRIGGER_PREFIX)) {
        const q = cur.slice(TRIGGER_PREFIX.length).trim();
        if (q) { busy=true; await sendToAll(q); busy=false; }
      }
    }
  }, 1000);

  emit({ running: true, mode: 'multi', ai: null });
}

// ── 모드 2: 같은 AI 4개, 감시 없음 ──
async function launchSolo(aiName) {
  const ai = resolveSolo(aiName);
  if (!ai) throw new Error('알 수 없는 AI: ' + aiName);
  await openWindows(Array.from({ length: 4 }, () => ({ name: ai.name, url: ai.url })));
  emit({ running: true, mode: 'solo', ai: ai.key });
}

async function stop() {
  if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null; }
  if (context) { try { await context.close(); } catch {} context = null; }
  emit({ running: false, mode: null, ai: null });
}

module.exports = { AI_LIST, resolveSolo, launchMulti, launchSolo, stop, onStatus };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node test-controller.cjs`
Expected: `OK: resolveSolo/AI_LIST`

- [ ] **Step 5: `browser.mjs`를 얇은 래퍼로 교체**

```js
// 터미널 직접 실행용 폴백: 4개 AI 모드만 구동
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const controller = require('./ai-controller.cjs');

console.log('🚀 AI Ask (CLI) — 4개 AI 모드');
await controller.launchMulti();
console.log('준비 완료. !질문 복사→전송, !! 복사→수집. 종료: Ctrl+C');
```

- [ ] **Step 6: CLI 스모크(수동) — 창이 뜨므로 사용자와 함께 실행**

Run: `node browser.mjs`
Expected: 크롬 창 4개(노션·제미나이·챗지피티·클로드)가 뜨고, `!안녕` 복사 시 각 창에 전송됨. (기존과 동일)

- [ ] **Step 7: 커밋**

```bash
git add ai-controller.cjs browser.mjs test-controller.cjs
git commit -m "refactor: 엔진을 ai-controller.cjs로 분리, launchSolo 추가, browser.mjs 래퍼화"
```

---

## Task 2: Electron 버튼 앱 — main.cjs + preload.cjs + index.html

**Files:**
- Create: `main.cjs`, `preload.cjs`, `index.html`
- Modify: `package.json` (main, scripts, devDep)

**Interfaces:**
- Consumes: `ai-controller.cjs`의 `AI_LIST/launchMulti/launchSolo/stop/onStatus`.
- Renderer API (preload): `window.aiAsk = { launchMulti(), launchSolo(key), stop(), onStatus(cb), list }`.

- [ ] **Step 1: `preload.cjs` 작성**

```js
const { contextBridge, ipcRenderer } = require('electron');
const { AI_LIST } = require('./ai-controller.cjs');

contextBridge.exposeInMainWorld('aiAsk', {
  list: AI_LIST.map(a => ({ key: a.key, name: a.name })),
  launchMulti: () => ipcRenderer.invoke('launch-multi'),
  launchSolo: (key) => ipcRenderer.invoke('launch-solo', key),
  stop: () => ipcRenderer.invoke('stop'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
});
```

- [ ] **Step 2: `main.cjs` 작성** — 세션 단일성 + 상태 브로드캐스트 + 프로필 락 정리

```js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { homedir } = require('os');
const controller = require('./ai-controller.cjs');

let win = null;
let running = false;

function createWindow() {
  win = new BrowserWindow({
    width: 400, height: 560, resizable: false, fullscreenable: false,
    title: 'AI Ask',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile('index.html');
  controller.onStatus((s) => { running = s.running; if (win) win.webContents.send('status', s); });
}

// 이전 세션의 프로필 락 잔재 정리 (기존 .command와 동일 취지)
function clearLock() {
  try { fs.rmSync(`${homedir()}/.ai-ask/profile/SingletonLock`, { force: true }); } catch {}
}

ipcMain.handle('launch-multi', async () => {
  if (running) return { ok: false, reason: 'busy' };
  clearLock(); await controller.launchMulti(); return { ok: true };
});
ipcMain.handle('launch-solo', async (_e, key) => {
  if (running) return { ok: false, reason: 'busy' };
  clearLock(); await controller.launchSolo(key); return { ok: true };
});
ipcMain.handle('stop', async () => { await controller.stop(); return { ok: true }; });

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => { await controller.stop(); app.quit(); });
app.on('before-quit', async () => { await controller.stop(); });
```

- [ ] **Step 3: `index.html` 작성** (목업 UI + 잠금/상태 처리)

```html
<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 body{font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;background:#f5f6f8;color:#0f2540;padding:20px;user-select:none}
 .brand{display:flex;align-items:center;gap:10px;margin-bottom:16px}
 .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#073967,#0d5aa0);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
 h1{font-size:17px} .brand p{font-size:11px;color:#7a8494;margin-top:1px}
 .lbl{font-size:11px;font-weight:700;color:#8a93a2;margin:14px 2px 8px}
 #multi{width:100%;height:50px;border:0;border-radius:11px;background:linear-gradient(#0a4a86,#073967);color:#fff;font-size:15px;font-weight:700;cursor:pointer}
 .desc{font-size:11px;color:#8a93a2;margin:7px 2px 0;line-height:1.5}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:4px}
 .ai{height:44px;border:1.5px solid #e2e6ec;border-radius:10px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#2a3342}
 .ai.sel{border-color:#10a37f;background:#eafaf5;box-shadow:0 0 0 3px rgba(16,163,127,.14)}
 .bar{margin-top:18px;display:flex;align-items:center;justify-content:space-between;background:#eef1f4;border-radius:9px;padding:10px 12px}
 .st{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:#4a5362}
 .led{width:9px;height:9px;border-radius:50%;background:#c2c8d0}
 .led.on{background:#28c840;box-shadow:0 0 0 3px rgba(40,200,64,.18)}
 #quit{border:0;background:#e3e7ec;color:#5b6473;font-size:12px;font-weight:700;padding:7px 14px;border-radius:7px;cursor:pointer}
 .disabled{opacity:.45;pointer-events:none}
</style></head><body>
 <div class="brand"><div class="logo">AI</div><div><h1>AI Ask</h1><p>4개 AI 동시 · 같은 AI 4개 독립</p></div></div>
 <div class="lbl">모드 1 · 4개 AI 동시</div>
 <button id="multi">4개 AI 띄우기</button>
 <div class="desc" id="multiDesc">노션·제미나이·챗지피티·클로드 창 4개. 어디서든 <b>!질문</b> 복사→전송, <b>!!</b> 복사→수집</div>
 <div class="lbl">모드 2 · 같은 AI 4개 (독립)</div>
 <div class="grid" id="grid"></div>
 <div class="bar"><div class="st"><span class="led" id="led"></span><span id="stx">꺼짐</span></div><button id="quit">종료</button></div>
<script>
 const grid=document.getElementById('grid'), multi=document.getElementById('multi'), quit=document.getElementById('quit');
 const led=document.getElementById('led'), stx=document.getElementById('stx');
 const btns={};
 aiAsk.list.forEach(a=>{const b=document.createElement('button');b.className='ai';b.textContent=a.name+' ×4';
   b.onclick=()=>aiAsk.launchSolo(a.key);grid.appendChild(b);btns[a.key]=b;});
 multi.onclick=()=>aiAsk.launchMulti();
 quit.onclick=()=>aiAsk.stop();
 function lockAll(on){[multi,...Object.values(btns)].forEach(el=>el.classList.toggle('disabled',on));}
 aiAsk.onStatus(s=>{
   led.classList.toggle('on',s.running);
   Object.values(btns).forEach(b=>b.classList.remove('sel'));
   if(s.running){lockAll(true);
     stx.textContent = s.mode==='multi' ? '실행 중 · 4개 AI' : '실행 중 · '+(btns[s.ai]?btns[s.ai].textContent:'');
     if(s.mode==='solo'&&btns[s.ai])btns[s.ai].classList.add('sel');
     quit.textContent='닫기';quit.style.background='#ffe3e0';quit.style.color='#c0392b';
   } else {lockAll(false);stx.textContent='꺼짐';quit.textContent='종료';quit.style.background='#e3e7ec';quit.style.color='#5b6473';}
 });
</script></body></html>
```

- [ ] **Step 4: `package.json` 수정** — main, scripts, electron devDep, builder icon

```jsonc
// "main": "main.cjs"
// scripts: { "start": "electron .", "cli": "node browser.mjs", "dist": "electron-builder" }
// devDependencies: { "electron": "^33", "electron-builder": "^25" }
// build.mac.icon: "assets/icon.icns"
```

- [ ] **Step 5: electron 설치**

Run: `pnpm add -D electron@^33 electron-builder@^25`
Expected: 설치 성공, `node_modules/.bin/electron` 생김

- [ ] **Step 6: 앱 스모크(수동, 창 뜸) — 사용자와 함께**

Run: `pnpm start`
Expected: 400×560 버튼 창이 뜸. "4개 AI 띄우기" → 크롬 창 4개+클립보드 동작. 되돌아와 "닫기" → 크롬 닫힘, 상태 "꺼짐". 이어서 "챗지피티 ×4" → 챗지피티 창 4개, 클립보드 감시 없음, 챗지피티 버튼 초록 선택 표시. "닫기" → 정리.

- [ ] **Step 7: 커밋**

```bash
git add main.cjs preload.cjs index.html package.json pnpm-lock.yaml package-lock.json
git commit -m "feat: Electron 버튼 앱 셸 추가 (4개 AI / 같은 AI 4개 독립)"
```

---

## Task 3: 패키징 — 더블클릭 .app 빌드

**Files:**
- Create: `assets/icon.icns` (루트 `AppIcon.icns` 복사)
- Modify: `package.json` (build.files에 신규 파일 포함 확인)

- [ ] **Step 1: 아이콘 준비**

Run: `cp AppIcon.icns assets/icon.icns`
Expected: `assets/icon.icns` 생성

- [ ] **Step 2: build.files 정합** — `package.json` build.files에 앱 실행에 필요한 파일 나열

```jsonc
// build.files: ["main.cjs","preload.cjs","index.html","ai-controller.cjs","browser.mjs","assets/**/*","node_modules/**/*"]
```

- [ ] **Step 3: 빌드(무거움: electron 바이너리 다운로드)**

Run: `pnpm dist`
Expected: `dist/mac*/AI Ask.app` 및 `.dmg` 생성. (코드서명 미설정이라 첫 실행 시 우클릭→열기 필요할 수 있음 — README에 안내)

- [ ] **Step 4: 빌드 산출물 확인**

Run: `ls -la dist/`
Expected: `AI Ask.app` 또는 `.dmg` 존재. 더블클릭 시 버튼 창이 뜸(수동 확인).

- [ ] **Step 5: README 갱신 + 커밋**

README에 GUI 앱 사용법(더블클릭, 두 모드, 첫 실행 우클릭→열기)을 추가.

```bash
git add assets/icon.icns package.json README.md
git commit -m "build: .app 패키징 설정 + README 갱신"
```

---

## Self-Review 결과

- **Spec 커버리지**: 모드1(Task1 launchMulti+Task2 버튼)·모드2(Task1 launchSolo+Task2 버튼)·세션 단일성(Task2 running/락)·프로필 공유(controller PROFILE_DIR)·패키징(Task3)·browser.mjs 래퍼(Task1) 모두 태스크 있음.
- **플레이스홀더**: 없음(코드 전량 기재). 단, 브라우저 자동화 특성상 최종 검증은 수동 스모크(창이 뜸) — TDD 자동화 불가 구간은 명시.
- **타입 정합**: `AI_LIST` 항목 `{key,name,url}`, preload는 `{key,name}`만 노출, `resolveSolo`는 key로 조회, status `{running,mode,ai}` — 전 태스크 일관.
- **알려진 한계**: 코드서명/공증 미포함(로컬 배포). Notion 창 name 매핑은 모드1에서 4개가 서로 다른 AI라 `#index` 제거 후 유일. 모드2는 send/collect 미사용이라 name 충돌 무관.
