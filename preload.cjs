const { contextBridge, ipcRenderer } = require('electron');
const { AI_LIST } = require('./ai-controller.cjs');

contextBridge.exposeInMainWorld('aiAsk', {
  list: AI_LIST.map(a => ({ key: a.key, name: a.name })),
  launchMulti: () => ipcRenderer.invoke('launch-multi'),
  launchSolo: (key) => ipcRenderer.invoke('launch-solo', key),
  stop: () => ipcRenderer.invoke('stop'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
});
