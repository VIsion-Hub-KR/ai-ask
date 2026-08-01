const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { homedir } = require('os');
const controller = require('./ai-controller.cjs');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 480,
    minWidth: 360,
    minHeight: 300,
    fullscreenable: false,
    title: 'AI Ask',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 샌드박스 preload는 로컬 모듈(ai-controller.cjs) require 불가 → 해제.
      // contextIsolation은 유지하여 렌더러 노출은 aiAsk API로 제한.
      sandbox: false,
    },
  });
  win.loadFile('index.html');

  // 내용 높이에 창을 딱 맞춘다 (아래 여백 제거). 버튼 수가 바뀌어도 자동.
  win.webContents.on('did-finish-load', fitToContent);

  controller.onStatus((s) => {
    if (win && !win.isDestroyed()) win.webContents.send('status', s);
  });
}

// 내용 높이에 창을 맞추되, 모니터 작업 영역보다 커지지 않게 잘라서
// 작은 모니터에서도 하단 종료 버튼이 화면 밖으로 나가지 않게 한다 (넘치는 내용은 스크롤).
async function fitToContent() {
  if (!win || win.isDestroyed()) return;
  try {
    const h = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
    if (!win || win.isDestroyed()) return;
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const frame = win.getSize()[1] - win.getContentSize()[1]; // 타이틀바 높이
    const maxH = wa.height - frame;
    win.setContentSize(win.getContentSize()[0], Math.min(Math.max(300, Math.ceil(h)), maxH));
    // 창 아래쪽이 화면 밖으로 나가 있으면 화면 안으로 끌어올린다.
    const b = win.getBounds();
    const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
    if (y !== b.y) win.setPosition(b.x, y);
  } catch {}
}

// 이전 세션의 프로필 락 잔재 정리 (기존 AI-Ask.command와 동일 취지)
function clearLock() {
  try { fs.rmSync(`${homedir()}/.ai-ask/profile/SingletonLock`, { force: true }); } catch {}
}

// displayId → 그 모니터의 작업 영역(메뉴바·독 제외). null이면 주 모니터.
function resolveArea(displayId) {
  if (displayId == null) return screen.getPrimaryDisplay().workArea;
  const d = screen.getAllDisplays().find((x) => x.id === displayId);
  return (d || screen.getPrimaryDisplay()).workArea;
}

// 렌더러(디스플레이 정렬 그림)용 모니터 목록.
ipcMain.handle('get-displays', () => {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label,
    primary: d.id === primaryId,
    bounds: d.bounds,
  }));
});

// picker 펼침/접힘으로 내용 높이가 바뀔 때 창을 다시 딱 맞춘다.
ipcMain.handle('refit', fitToContent);

ipcMain.handle('launch-multi', async (_e, displayId, order) => {
  clearLock();
  await controller.launchMulti(resolveArea(displayId), order);
  return { ok: true };
});

ipcMain.handle('launch-solo', async (_e, key, displayId) => {
  clearLock();
  await controller.launchSolo(key, resolveArea(displayId));
  return { ok: true };
});

ipcMain.handle('apply-links', async (_e, text, displayId, order) => {
  clearLock();
  return controller.applyLinks(text, resolveArea(displayId), order);
});

ipcMain.handle('stop', async () => {
  await controller.stop();
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', async () => {
  await controller.stop();
  app.quit();
});

app.on('before-quit', async () => {
  await controller.stop();
});
