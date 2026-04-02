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
  { name: 'Notion', url: 'https://www.notion.so' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Claude', url: 'https://claude.ai' },
];

const positions = [
  { left: 0, top: 25, width: 960, height: 540 },
  { left: 960, top: 25, width: 960, height: 540 },
  { left: 0, top: 565, width: 960, height: 540 },
  { left: 960, top: 565, width: 960, height: 540 },
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

  await page.goto(url);
  pages[name] = page;
  console.log(`  ✓ ${name}`);
}

await Promise.all(Object.values(pages).map(p => p.waitForTimeout(3000)));

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
    const input = page.locator('.ql-editor, [contenteditable="true"], [aria-label*="Gemini"]').first();
    await input.click();
    await input.fill(text);
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
    const input = page.locator('#prompt-textarea, [id="prompt-textarea"] p, div[contenteditable="true"]').first();
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
    const input = page.locator('[contenteditable="true"], div.ProseMirror, fieldset p').first();
    await input.click();
    await input.fill(text);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
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

// ── 클립보드 감시 ──

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
console.log('  !를 붙여서 복사하면 4개 AI에 동시 전송');
console.log('  예: !봄에 대한 시 써줘');
console.log('  종료: Ctrl+C');
console.log('════════════════════════════════════════\n');

let busy = false;

setInterval(async () => {
  if (busy) return;
  const current = getClipboard();
  if (current && current !== lastClipboard) {
    lastClipboard = current;
    if (current.startsWith(TRIGGER_PREFIX)) {
      const question = current.slice(TRIGGER_PREFIX.length).trim();
      if (question) {
        busy = true;
        await sendToAll(question);
        busy = false;
      }
    }
  }
}, 1000);
