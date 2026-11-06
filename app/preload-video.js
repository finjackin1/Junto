'use strict';
// Preload of the video window: clock offset, the media/state pushed by the main window (through main), close, play/pause, fullscreen.
const { contextBridge, ipcRenderer } = require('electron');
let offset = 0;
ipcRenderer.on('junto:offset', (_e, o) => { if (typeof o === 'number' && Number.isFinite(o)) offset = o; });

contextBridge.exposeInMainWorld('junto', {
  agoraServidor: () => Date.now() + offset,
  aoVideo: (cb) => { if (typeof cb === 'function') ipcRenderer.on('junto:video-dados', (_e, d) => { cb(d); }); },
  acao: (a) => { if (a === 'tocar' || a === 'fechar' || a === 'telacheia') ipcRenderer.send('junto:video-acao', a); },
  aoTelaCheia: (cb) => { if (typeof cb === 'function') ipcRenderer.on('junto:tela-cheia', (_e, f) => { cb(f === true); }); },
});
