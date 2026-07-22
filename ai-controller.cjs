// AI Ask 엔진 — Playwright로 시스템 Google Chrome을 구동한다.
// - launchMulti(): 4개 AI(노션·제미나이·챗지피티·클로드) 창 + 클립보드 감시(!질문/!!)
// - launchSolo(aiKey): 같은 AI 창 4개 (감시·전송·수집 없음, 완전 독립)
// - stop(): 감시 해제 + 크롬 컨텍스트 close
// 로그인 프로필(~/.ai-ask/profile)을 공유하므로 동시 세션은 1개.

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { mkdirSync } = require('fs');
const { homedir } = require('os');

const TRIGGER_PREFIX = '!';
const COLLECT_PREFIX = '!!';
const PROFILE_DIR = `${homedir()}/.ai-ask/profile`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Finder로 띄운 .app은 UTF-8 로케일(LANG)이 없어 pbpaste/pbcopy가 한글을
// EUC-KR로 처리 → 깨짐. 클립보드 exec 호출에 UTF-8 로케일을 강제한다.
const UTF8_ENV = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

// send: 클립보드 전송/수집(모드 1) 지원 여부. false면 창만 열리고 !질문·!!에서 건너뜀.
const AI_LIST = [
  { key: 'notion',     name: 'Notion',     url: 'https://www.notion.so/ai',       send: true },
  { key: 'gemini',     name: 'Gemini',     url: 'https://gemini.google.com/app',  send: true },
  { key: 'chatgpt',    name: 'ChatGPT',    url: 'https://chatgpt.com',            send: true },
  { key: 'claude',     name: 'Claude',     url: 'https://claude.ai',              send: true },
  { key: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai',      send: false },
  { key: 'grok',       name: 'Grok',       url: 'https://grok.com',               send: false },
];

// 창을 띄울 대상 영역(area = {x,y,width,height}, 보통 선택 모니터의 작업 영역).
// null이면 아래 FALLBACK_AREA(주 모니터 좌상단 기준)를 쓴다.
const FALLBACK_AREA = { x: 0, y: 0, width: 2056, height: 1329 };

// 주어진 영역을 가로 4등분한 창 위치 배열. 폭은 모니터 해상도에 맞춰 자동 계산.
function computePositions(area) {
  const a = area || FALLBACK_AREA;
  const colW = Math.floor(a.width / 4);
  return Array.from({ length: 4 }, (_, i) => ({
    left: Math.round(a.x + i * colW),
    top: Math.round(a.y),
    width: colW,
    height: Math.round(a.height),
  }));
}

function resolveSolo(aiName) {
  return AI_LIST.find(a => a.key === aiName) || null;
}

let context = null;
let clipboardTimer = null;
let statusCb = () => {};
function onStatus(cb) { statusCb = cb; }
function emit(s) { try { statusCb(s); } catch {} }

// 창 생성 중복 실행(레이스) 방지 — 같은 프로필로 두 번째 크롬을 켜려다 충돌하는 것 차단
let launching = false;
// 첫 세트로 띄운 4분할 창들의 첫 탭 페이지 (창 0~3의 대표 페이지)
let sessionWindows = [];
// AI별로 각 창(0~3)에 연 탭. openedTabs[aiKey][windowIndex] = page | null
// 버튼을 누르면: 그 AI 탭이 없는 창엔 새로 열고, 이미 있으면 그 탭을 맨 앞으로.
let openedTabs = {};
let sessionMode = null;   // 'multi' | 'solo' (상태바 표시용)
let sessionAi = null;     // solo로 시작했을 때의 AI 키

function isRunning() { return context !== null; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 현재 살아 있는 탭이 하나라도 있는 AI 키 목록 (버튼 녹색 표시용)
function openAiKeys() {
  return Object.keys(openedTabs).filter(k => (openedTabs[k] || []).some(p => p && !p.isClosed()));
}
function emitStatus() {
  emit({
    running: isRunning(),
    mode: sessionMode,
    ai: sessionAi,
    openAis: isRunning() ? openAiKeys() : [],
  });
}

async function ensureContext() {
  if (context) return context;
  mkdirSync(PROFILE_DIR, { recursive: true });
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    executablePath: CHROME,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: null,
  });
  return context;
}

// 첫 세트: 대상 영역(area)을 4분할로 창 4개를 연다. 반환: 순서대로의 page 배열.
async function openSplitWindows(specs, area) {
  await ensureContext();
  const positions = computePositions(area);
  const pages = [];
  for (let i = 0; i < specs.length; i++) {
    const { name, url } = specs[i];
    let page;

    if (i === 0) {
      page = context.pages()[0] || await context.newPage();
    } else {
      const cdp = await context.newCDPSession(context.pages()[0]);
      await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
      await new Promise(r => setTimeout(r, 500));
      const all = context.pages();
      page = all.find(p => p.url() === 'about:blank' && !pages.includes(p))
        || all[all.length - 1];
    }

    const s = await context.newCDPSession(page);
    const { windowId } = await s.send('Browser.getWindowForTarget');
    await s.send('Browser.setWindowBounds', { windowId, bounds: positions[i] });

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    } catch (e) {
      console.log(`  ⚠ ${name} (계속)`);
    }
    await page.waitForTimeout(1000);
    pages.push(page);
    console.log(`  ✓ ${name}`);
  }
  return pages;
}

// 특정 창(windowIndex)에 url을 새 탭으로 열고 그 page를 반환한다.
async function openTabInWindow(i, url) {
  const anchor = sessionWindows[i];
  if (!anchor || anchor.isClosed()) return null;
  await anchor.bringToFront();                 // 해당 창을 맨 앞으로
  await sleep(150);
  const before = new Set(context.pages());
  const cdp = await context.newCDPSession(anchor);
  await cdp.send('Target.createTarget', { url, newWindow: false }); // 그 창에 새 탭
  await sleep(600);
  return context.pages().find(p => !before.has(p)) || null;
}

// AI 버튼을 눌렀을 때(실행 중): 그 AI 탭이 없는 창엔 새로 열고, 모든 창에서 그 탭을 맨 앞으로.
// → 4개 창이 전부 그 AI를 보여주게 된다.
async function showOrOpen(aiKey, url) {
  if (!context) return;
  const arr = openedTabs[aiKey] || (openedTabs[aiKey] = new Array(sessionWindows.length).fill(null));
  for (let i = 0; i < sessionWindows.length; i++) {
    if (!arr[i] || arr[i].isClosed()) {
      arr[i] = await openTabInWindow(i, url);
      console.log(`  ➕ ${aiKey} 창${i} 탭 열기`);
    }
  }
  for (const p of arr) {
    if (p && !p.isClosed()) { try { await p.bringToFront(); } catch {} }
  }
  console.log(`  👁 ${aiKey} 탭 4창 모두 앞으로`);
}

// ── 각 AI 전송 (셀렉터는 기존 browser.mjs와 동일) ──

async function sendToNotion(page, text) {
  try {
    await page.keyboard.press('Meta+j');
    await page.waitForTimeout(1500);
    const input = page.locator('[placeholder*="무엇이든"], [placeholder*="Ask"], [role="textbox"]').last();
    await input.click();
    await input.fill(text);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    return '✓';
  } catch (e) {
    return '✗ ' + e.message.slice(0, 40);
  }
}

async function sendToGemini(page, text) {
  try {
    const input = page.locator('.ql-editor, [contenteditable="true"], [role="textbox"], textarea').first();
    await input.click({ timeout: 5000 });
    await page.evaluate((t) => {
      const editor = document.querySelector('.ql-editor, [contenteditable="true"], [role="textbox"]');
      editor.focus();
      document.execCommand('insertText', false, t);
    }, text);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    return '✓';
  } catch (e) {
    return '✗ ' + e.message.slice(0, 40);
  }
}

async function sendToChatGPT(page, text) {
  try {
    // ChatGPT 진짜 입력칸(#prompt-textarea)만 정확히 지정.
    const input = page.locator('#prompt-textarea').first();
    await input.click();
    await input.fill(text);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    return '✓';
  } catch (e) {
    return '✗ ' + e.message.slice(0, 40);
  }
}

async function sendToClaude(page, text) {
  try {
    await page.evaluate((t) => {
      const editor = document.querySelector('div.tiptap.ProseMirror');
      editor.focus();
      document.execCommand('insertText', false, t);
    }, text);
    await page.waitForTimeout(500);
    await page.locator('button[aria-label="메시지 보내기"]').click({ timeout: 3000 });
    return '✓';
  } catch (e) {
    return '✗ ' + e.message.slice(0, 40);
  }
}

const SENDERS = { notion: sendToNotion, gemini: sendToGemini, chatgpt: sendToChatGPT, claude: sendToClaude };

// ── 각 AI 답변 수집 ──

async function collectFromNotion(page) {
  try {
    return (await page.evaluate(() => {
      const m = document.querySelectorAll('[class*="response"], [class*="answer"], [class*="output"], [data-block-id]');
      const last = m[m.length - 1];
      return last ? last.innerText.trim() : '';
    })) || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

async function collectFromGemini(page) {
  try {
    return (await page.evaluate(() => {
      const all = document.querySelectorAll('[class*="response"], [class*="message"], [class*="model"], [class*="answer"], [class*="markdown"], [class*="content"]');
      let longest = '';
      all.forEach(el => {
        const t = el.innerText.trim();
        if (t.length > longest.length && el.offsetHeight > 0) longest = t;
      });
      return longest;
    })) || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

async function collectFromChatGPT(page) {
  try {
    return (await page.evaluate(() => {
      const r = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = r[r.length - 1];
      return last ? last.innerText.trim() : '';
    })) || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

async function collectFromClaude(page) {
  try {
    return (await page.evaluate(() => {
      const r = document.querySelectorAll('[data-is-streaming], .font-claude-message, [class*="response"], [class*="message"]');
      const last = r[r.length - 1];
      return last ? last.innerText.trim() : '';
    })) || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

const COLLECTORS = { notion: collectFromNotion, gemini: collectFromGemini, chatgpt: collectFromChatGPT, claude: collectFromClaude };

// ── 모드 1: 4개 AI + 클립보드 감시 ──

async function launchMulti(area, order) {
  if (launching) return;
  launching = true;
  try {
    // 선택 순서(키 배열)대로 왼쪽부터 배치. 없거나 잘못되면 기존 기본 4개(카탈로그 앞 4개).
    const keys = (Array.isArray(order) && order.length) ? order : AI_LIST.slice(0, 4).map(a => a.key);
    const chosen = keys.map(k => AI_LIST.find(a => a.key === k)).filter(Boolean);
    const specs = chosen.map(a => ({ name: a.name, url: a.url }));

    // 실행 중에 '4개 AI 띄우기'를 다시 누르면 각 창의 원래 첫 탭들을 앞으로 보여준다.
    if (isRunning()) {
      for (const p of sessionWindows) {
        if (p && !p.isClosed()) { try { await p.bringToFront(); } catch {} }
      }
      emitStatus();
      return;
    }

    const pages = await openSplitWindows(specs, area);
    sessionWindows = pages;
    sessionMode = 'multi';
    sessionAi = null;

    // 세션 탭 기록 초기화 — 각 모델은 자기 창(i)에만 첫 탭이 있다.
    openedTabs = {};
    chosen.forEach((a, i) => {
      openedTabs[a.key] = new Array(pages.length).fill(null);
      openedTabs[a.key][i] = pages[i];
    });

    // 브로드캐스트 대상 = 선택한 창들. 전송/수집 코드가 있는(send:true) 모델만 실제 전송·수집.
    const targets = chosen.map((a, i) => ({ key: a.key, name: a.name, page: pages[i], send: a.send }));
    const sendable = targets.filter(t => t.send && SENDERS[t.key]);

    function getClipboard() {
      try { return execSync('pbpaste', { encoding: 'utf-8', env: UTF8_ENV }).trim(); } catch { return ''; }
    }
    let last = getClipboard();
    let busy = false;

    async function sendToAll(text) {
      const preview = text.length > 60 ? text.slice(0, 60) + '...' : text;
      console.log(`\n📨 "${preview}"`);
      const results = await Promise.all(
        sendable.map(t => SENDERS[t.key](t.page, text).then(r => [t.name, r]))
      );
      for (const [n, r] of results) console.log(`  ${r} ${n}`);
      for (const t of targets) {
        if (!sendable.includes(t)) console.log(`  ⓘ ${t.name} 전송 미지원, 건너뜀`);
      }
    }

    async function collectAll() {
      console.log('\n📋 답변 수집 중...');
      const parts = await Promise.all(sendable.map(t => COLLECTORS[t.key](t.page)));
      const out = parts.map((txt, i) => {
        const label = `모델${i + 1} · ${sendable[i].name}`;
        return `<${label}>\n${txt}\n</${label}>`;
      }).join('\n\n');
      execSync('pbcopy', { input: out, env: UTF8_ENV });
      console.log(`  ✅ ${sendable.length}개 모델 답변이 클립보드에 복사되었습니다!`);
    }

    clipboardTimer = setInterval(async () => {
      if (busy) return;
      const cur = getClipboard();
      if (cur && cur !== last) {
        last = cur;
        if (cur === COLLECT_PREFIX) {
          busy = true; await collectAll(); last = getClipboard(); busy = false;
        } else if (cur.startsWith(TRIGGER_PREFIX)) {
          const q = cur.slice(TRIGGER_PREFIX.length).trim();
          if (q) { busy = true; await sendToAll(q); busy = false; }
        }
      }
    }, 1000);

    emitStatus();
  } finally {
    launching = false;
  }
}

// ── 모드 2: 같은 AI 4개, 감시 없음 ──

async function launchSolo(aiName, area) {
  const ai = resolveSolo(aiName);
  if (!ai) throw new Error('알 수 없는 AI: ' + aiName);
  if (launching) return;
  launching = true;
  try {
    // 실행 중이면: 이 AI 탭을 없는 창엔 열고, 모든 창에서 맨 앞으로 (열려 있으면 그냥 전환)
    if (isRunning()) { await showOrOpen(ai.key, ai.url); emitStatus(); return; }

    const specs = Array.from({ length: 4 }, () => ({ name: ai.name, url: ai.url }));
    const pages = await openSplitWindows(specs, area);
    sessionWindows = pages;
    sessionMode = 'solo';
    sessionAi = ai.key;
    openedTabs = {};
    openedTabs[ai.key] = pages.slice();   // 4개 창 모두 이 AI가 첫 탭
    emitStatus();
  } finally {
    launching = false;
  }
}

async function stop() {
  if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null; }
  if (context) { try { await context.close(); } catch {} context = null; }
  sessionWindows = [];
  openedTabs = {};
  sessionMode = null;
  sessionAi = null;
  launching = false;
  emit({ running: false, mode: null, ai: null, openAis: [] });
}

module.exports = { AI_LIST, resolveSolo, launchMulti, launchSolo, stop, onStatus };
