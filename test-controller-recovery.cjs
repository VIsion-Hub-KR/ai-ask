// Exercise disconnect/relaunch against real Chrome with an isolated, temporary profile.
const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');

test('browser disconnect stops polling and permits serialized relaunch', { timeout: 20000 }, async () => {
  const cacheDir = path.join(__dirname, 'node_modules/.cache');
  mkdirSync(cacheDir, { recursive: true });
  const profileHome = mkdtempSync(path.join(cacheDir, 'ai-ask-recovery-'));
  const contexts = [];
  const statuses = [];
  let clipboardReads = 0;
  let launchAttempts = 0;
  const realLaunch = chromium.launchPersistentContext.bind(chromium);
  const homeMock = mock.method(os, 'homedir', () => profileHome);
  const clipboardMock = mock.method(childProcess, 'execSync', command => {
    assert.equal(command, 'pbpaste', 'The fixture must not send clipboard data');
    clipboardReads++;
    return '';
  });
  const launchMock = mock.method(chromium, 'launchPersistentContext', async (profile, options) => {
    launchAttempts++;
    const browserContext = await realLaunch(profile, { ...options, headless: true });
    contexts.push(browserContext);
    return browserContext;
  });
  delete require.cache[require.resolve('./ai-controller.cjs')];
  const controller = require('./ai-controller.cjs');
  controller.onStatus(status => statuses.push(status));
  const launch = () => controller.launchMulti({ x: 0, y: 0, width: 1200, height: 800 }, ['notion'], {
    notion: 'data:text/html,<title>AI Ask recovery fixture</title>',
  });
  try {
    await launch();
    assert.equal(statuses.at(-1).running, true);
    await contexts[0].close();
    assert.deepEqual(statuses.at(-1), { running: false, mode: null, ai: null, openAis: [] });
    const readsAfterClose = clipboardReads;
    await delay(1100);
    assert.equal(clipboardReads, readsAfterClose, 'Clipboard polling must stop on disconnect');

    await launch();
    assert.equal(contexts.length, 2, 'Relaunch must create a fresh browser context');
    assert.equal(statuses.at(-1).running, true);
    const notificationsBeforeStaleClose = statuses.length;
    contexts[0].emit('close');
    assert.equal(statuses.length, notificationsBeforeStaleClose, 'An old context cannot reset the new session');

    const stoppedBefore = statuses.filter(status => !status.running).length;
    await controller.stop();
    assert.deepEqual(statuses.at(-1), { running: false, mode: null, ai: null, openAis: [] });
    assert.equal(statuses.filter(status => !status.running).length, stoppedBefore + 1,
      'Normal stop must notify once even when browser close also fires');

    // Pause the real four-window launch at its 500 ms Target.createTarget delay.
    // A disconnect must not release launch ownership before that launch unwinds.
    const originalTimeout = global.setTimeout;
    let releaseDelay;
    let signalDelay;
    const splitDelay = new Promise(resolve => { signalDelay = resolve; });
    const timerMock = mock.method(global, 'setTimeout', (callback, ms, ...args) => {
      if (ms === 500 && !releaseDelay && new Error().stack.includes('openSplitWindows')) {
        releaseDelay = () => originalTimeout(callback, 0, ...args);
        signalDelay();
        return;
      }
      return originalTimeout(callback, ms, ...args);
    });
    const beforeInterruptedLaunch = launchAttempts;
    const interrupted = controller.launchMulti({ x: 0, y: 0, width: 1200, height: 800 }, ['notion', 'gemini'], {
      notion: 'data:text/html,<title>First local fixture</title>',
      gemini: 'data:text/html,<title>Second local fixture</title>',
    });
    interrupted.catch(() => {});
    let results;
    let attemptsDuringRetry;
    try {
      await splitDelay;
      await contexts.at(-1).close();
      const retry = launch();
      attemptsDuringRetry = launchAttempts;
      releaseDelay();
      results = await Promise.allSettled([interrupted, retry]);
    } finally {
      timerMock.mock.restore();
      if (releaseDelay) releaseDelay();
    }
    assert.equal(attemptsDuringRetry, beforeInterruptedLaunch + 1,
      'A retry must wait until the interrupted launch releases its own lock');
    assert.equal(results[0].status, 'rejected', 'The old launch must abort after disconnect');
    assert.equal(statuses.at(-1).running, false);
    await launch();
    assert.equal(launchAttempts, beforeInterruptedLaunch + 2);
    assert.equal(statuses.at(-1).running, true);
    await controller.stop();
    const readsAfterFinalStop = clipboardReads;
    await delay(1100);
    assert.equal(clipboardReads, readsAfterFinalStop, 'Interrupted launches must not leave an orphan poller');
  } finally {
    await controller.stop();
    for (const browserContext of contexts)
      await browserContext.close();
    launchMock.mock.restore();
    clipboardMock.mock.restore();
    homeMock.mock.restore();
    rmSync(profileHome, { recursive: true, force: true });
  }
});
