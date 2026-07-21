const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { homedir } = require('os');
const controller = require('./ai-controller.cjs');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 480,
    resizable: false,
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
  win.webContents.on('did-finish-load', async () => {
    try {
      const h = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
      if (win && !win.isDestroyed()) win.setContentSize(400, Math.max(300, Math.ceil(h)));
    } catch {}
  });

  controller.onStatus((s) => {
    if (win && !win.isDestroyed()) win.webContents.send('status', s);
  });
}

// 이전 세션의 프로필 락 잔재 정리 (기존 AI-Ask.command와 동일 취지)
function clearLock() {
  try { fs.rmSync(`${homedir()}/.ai-ask/profile/SingletonLock`, { force: true }); } catch {}
}

ipcMain.handle('launch-multi', async () => {
  clearLock();
  await controller.launchMulti();
  return { ok: true };
});

ipcMain.handle('launch-solo', async (_e, key) => {
  clearLock();
  await controller.launchSolo(key);
  return { ok: true };
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
