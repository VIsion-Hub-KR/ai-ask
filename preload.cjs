const { contextBridge, ipcRenderer } = require('electron');
const { AI_LIST } = require('./ai-controller.cjs');

contextBridge.exposeInMainWorld('aiAsk', {
  list: AI_LIST.map(a => ({ key: a.key, name: a.name, send: a.send !== false })),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  refit: () => ipcRenderer.invoke('refit'),
  launchMulti: (displayId, order) => ipcRenderer.invoke('launch-multi', displayId, order),
  launchSolo: (key, displayId) => ipcRenderer.invoke('launch-solo', key, displayId),
  stop: () => ipcRenderer.invoke('stop'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
});
