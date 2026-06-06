import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';

const TRIGGER_PREFIX = '!';
const PROFILE_DIR = `${homedir()}/.ai-ask/profile`;
const CONFIG_PATH = `${homedir()}/.ai-ask/config.json`;

// ── 설정 ──

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  return { setupDone: false };
}

function saveConfig(config) {
  mkdirSync(`${homedir()}/.ai-ask`, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── 브라우저 시작 ──

console.log('🚀 AI Ask 시작 중...\n');

mkdirSync(PROFILE_DIR, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: null,
});

const services = [
  { name: 'Notion', url: 'https://www.notion.so/ai' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Claude', url: 'https://claude.ai' },
];

const positions = [
  { left: 0, top: 0, width: 514, height: 1400 },      // Notion (1번째)
  { left: 514, top: 0, width: 514, height: 1400 },    // Gemini (2번째)
  { left: 1028, top: 0, width: 514, height: 1400 },   // ChatGPT (3번째)
  { left: 1542, top: 0, width: 514, height: 1400 },   // Claude (4번째)
];

const pages = {};

for (let i = 0; i < services.length; i++) {
  const { name, url } = services[i];
  let page;

  if (i === 0) {
    page = context.pages()[0] || await context.newPage();
  } else {
    const cdp = await context.newCDPSession(context.pages()[0]);
    await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    await new Promise(r => setTimeout(r, 500));
    const allPages = context.pages();
    page = allPages.find(p => p.url() === 'about:blank' && !Object.values(pages).includes(p))
      || allPages[allPages.length - 1];
  }

  const cdpSession = await context.newCDPSession(page);
  const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
  await cdpSession.send('Browser.setWindowBounds', { windowId, bounds: positions[i] });

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  } catch (e) {
    console.log(`  ⚠ ${name} (계속)`);
  }
  await page.waitForTimeout(1000);
  pages[name] = page;
  console.log(`  ✓ ${name}`);
}

await Promise.all(Object.values(pages).map(p => p.waitForTimeout(2000)));

// ── 최초 실행: 로그인 안내 ──

const config = loadConfig();

if (!config.setupDone) {
  console.log('\n════════════════════════════════════════');
  console.log('  🔐 최초 실행 — 각 서비스에 로그인해주세요!');
  console.log('  4개 창에서 로그인을 완료한 후');
  console.log('  이 터미널에서 Enter를 눌러주세요.');
  console.log('════════════════════════════════════════\n');

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });
  process.stdin.pause();

  saveConfig({ setupDone: true });
  console.log('✅ 로그인 저장 완료! 다음부터는 자동 로그인됩니다.\n');
}

// ── 각 AI별 전송 ──

async function sendToNotion(text) {
  const page = pages.Notion;
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

async function sendToGemini(text) {
  const page = pages.Gemini;
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

async function sendToChatGPT(text) {
  const page = pages.ChatGPT;
  try {
    // ChatGPT 진짜 입력칸(#prompt-textarea)만 정확히 지정.
    // div[contenteditable="true"] 같은 느슨한 셀렉터는 캔버스/"메시지" 박스를 잘못 잡으므로 제외.
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

async function sendToClaude(text) {
  const page = pages.Claude;
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

async function sendToAll(text) {
  const preview = text.length > 60 ? text.slice(0, 60) + '...' : text;
  console.log(`\n📨 "${preview}"`);

  const results = await Promise.all([
    sendToNotion(text).then(r => ['Notion', r]),
    sendToGemini(text).then(r => ['Gemini', r]),
    sendToChatGPT(text).then(r => ['ChatGPT', r]),
    sendToClaude(text).then(r => ['Claude', r]),
  ]);

  for (const [name, result] of results) {
    console.log(`  ${result} ${name}`);
  }
}

// ── 답변 수집 ──

async function collectFromNotion() {
  const page = pages.Notion;
  try {
    const text = await page.evaluate(() => {
      const messages = document.querySelectorAll('[class*="response"], [class*="answer"], [class*="output"], [data-block-id]');
      const last = messages[messages.length - 1];
      return last ? last.innerText.trim() : '';
    });
    return text || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

async function collectFromGemini() {
  const page = pages.Gemini;
  try {
    const text = await page.evaluate(() => {
      const all = document.querySelectorAll('[class*="response"], [class*="message"], [class*="model"], [class*="answer"], [class*="markdown"], [class*="content"]');
      let longest = '';
      all.forEach(el => {
        const t = el.innerText.trim();
        if (t.length > longest.length && el.offsetHeight > 0) longest = t;
      });
      return longest;
    });
    return text || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

async function collectFromChatGPT() {
  const page = pages.ChatGPT;
  try {
    const text = await page.evaluate(() => {
      const responses = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = responses[responses.length - 1];
      return last ? last.innerText.trim() : '';
    });
    return text || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

async function collectFromClaude() {
  const page = pages.Claude;
  try {
    const text = await page.evaluate(() => {
      const responses = document.querySelectorAll('[data-is-streaming], .font-claude-message, [class*="response"], [class*="message"]');
      const last = responses[responses.length - 1];
      return last ? last.innerText.trim() : '';
    });
    return text || '(답변을 찾을 수 없음)';
  } catch (e) {
    return '(수집 실패: ' + e.message.slice(0, 30) + ')';
  }
}

async function collectAll() {
  console.log('\n📋 답변 수집 중...');

  const [notion, gemini, chatgpt, claude] = await Promise.all([
    collectFromNotion(),
    collectFromGemini(),
    collectFromChatGPT(),
    collectFromClaude(),
  ]);

  const result = `<답변1>\n${notion}\n</답변1>\n\n<답변2>\n${gemini}\n</답변2>\n\n<답변3>\n${chatgpt}\n</답변3>\n\n<답변4>\n${claude}\n</답변4>`;

  execSync(`pbcopy`, { input: result });

  console.log('  ✅ 4개 AI 답변이 클립보드에 복사되었습니다!');
  console.log(`  Notion: ${notion.slice(0, 50)}...`);
  console.log(`  Gemini: ${gemini.slice(0, 50)}...`);
  console.log(`  ChatGPT: ${chatgpt.slice(0, 50)}...`);
  console.log(`  Claude: ${claude.slice(0, 50)}...`);
}

// ── 클립보드 감시 ──

const COLLECT_PREFIX = '!!';

function getClipboard() {
  try {
    return execSync('pbpaste', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

let lastClipboard = getClipboard();

console.log('════════════════════════════════════════');
console.log('  AI Ask 준비 완료!');
console.log('  !질문      → 4개 AI에 동시 전송');
console.log('  !! (Ctrl+Cmd+M) → 4개 AI 답변 수집');
console.log('  예: !봄에 대한 시 써줘');
console.log('  종료: Ctrl+C');
console.log('════════════════════════════════════════\n');

let busy = false;

setInterval(async () => {
  if (busy) return;
  const current = getClipboard();
  if (current && current !== lastClipboard) {
    lastClipboard = current;
    if (current === COLLECT_PREFIX) {
      busy = true;
      await collectAll();
      lastClipboard = getClipboard();
      busy = false;
    } else if (current.startsWith(TRIGGER_PREFIX)) {
      const question = current.slice(TRIGGER_PREFIX.length).trim();
      if (question) {
        busy = true;
        await sendToAll(question);
        busy = false;
      }
    }
  }
}, 1000);
