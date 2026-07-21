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
// windowSpecs: [{name,url}] 길이 4. 반환: { "name#index": page }
async function openWindows(windowSpecs) {
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
      page = all.find(p => p.url() === 'about:blank' && !Object.values(pages).includes(p))
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
    pages[`${name}#${i}`] = page;
    console.log(`  ✓ ${name}`);
  }
  return pages;
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

const SENDERS = { Notion: sendToNotion, Gemini: sendToGemini, ChatGPT: sendToChatGPT, Claude: sendToClaude };

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

const COLLECTORS = { Notion: collectFromNotion, Gemini: collectFromGemini, ChatGPT: collectFromChatGPT, Claude: collectFromClaude };

// ── 모드 1: 4개 AI + 클립보드 감시 ──

async function launchMulti() {
  const pages = await openWindows(AI_LIST.map(a => ({ name: a.name, url: a.url })));
  const byName = {};
  for (const key of Object.keys(pages)) byName[key.split('#')[0]] = pages[key];

  function getClipboard() {
    try { return execSync('pbpaste', { encoding: 'utf-8', env: UTF8_ENV }).trim(); } catch { return ''; }
  }
  let last = getClipboard();
  let busy = false;

  async function sendToAll(text) {
    const preview = text.length > 60 ? text.slice(0, 60) + '...' : text;
    console.log(`\n📨 "${preview}"`);
    const results = await Promise.all(
      Object.entries(byName).map(([n, p]) => SENDERS[n](p, text).then(r => [n, r]))
    );
    for (const [n, r] of results) console.log(`  ${r} ${n}`);
  }

  async function collectAll() {
    console.log('\n📋 답변 수집 중...');
    const entries = Object.entries(byName);
    const parts = await Promise.all(entries.map(([n, p]) => COLLECTORS[n](p)));
    const out = parts.map((t, i) => `<답변${i + 1}>\n${t}\n</답변${i + 1}>`).join('\n\n');
    execSync('pbcopy', { input: out, env: UTF8_ENV });
    console.log('  ✅ 4개 AI 답변이 클립보드에 복사되었습니다!');
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
