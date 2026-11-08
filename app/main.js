'use strict';
// Junto main process, stage 1: window, tray, Discord login, stored session, WebSocket client, options, bridge.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn, execFile } = require('node:child_process');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, session, safeStorage, Notification, desktopCapturer } = require('electron');

const { criarLog } = require('./log');
const { criarOpcoes } = require('./opcoes');
const { criarSessao } = require('./sessao');
const { criarLogin } = require('./login');
const { criarCliente, validar } = require('./cliente');
const { criarMidia } = require('./midia');
const { criarAtualizacao } = require('./atualizacao');

const env = process.env;
const oculto = env.JUNTO_OCULTO === '1';
// Test runs never make sound (user's headphones). Must be set before app ready.
if (oculto || env.JUNTO_TESTE_ATUALIZACAO || env.JUNTO_DADOS) app.commandLine.appendSwitch('mute-audio');// Started by Windows at logon with "Iniciar minimizado" on: stay in the tray.
const naBandeja = process.argv.includes('--minimizado');
const dados = env.JUNTO_DADOS || app.getPath('userData');
if (env.JUNTO_DADOS) app.setPath('userData', env.JUNTO_DADOS);

function lerConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch { /* defaults */ }
  return {
    servidor: env.JUNTO_SERVIDOR || c.servidor || '',
    discordClientId: env.JUNTO_DISCORD_CLIENT_ID || c.discordClientId || '',
    autorizar: env.JUNTO_DISCORD_AUTORIZAR || '',
  };
}

const log = criarLog({ dir: dados });
const config = lerConfig();
const opcoes = criarOpcoes({ dir: dados, log });
const TELA = path.join(__dirname, 'tela', 'index.html');
const TELA_URL = pathToFileURL(TELA).href;
const VIDEO = path.join(__dirname, 'tela', 'video.html');
const VIDEO_URL = pathToFileURL(VIDEO).href;
const ICONE = path.join(__dirname, 'icone.png');
// packaged: build unpacks nativo/*.exe next to app.asar (--asar.unpack), spawn cannot run from inside the archive
// Tests (dev only): JUNTO_AUDIO points at a .js fake (silent tone source), run with this executable as plain node.
const AUDIO_FAKE = !app.isPackaged && /\.js$/i.test(env.JUNTO_AUDIO || '') ? env.JUNTO_AUDIO : null;
const AUDIO_EXE = AUDIO_FAKE || path.join(__dirname.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked'), 'nativo', 'junto-audio.exe');
const audioCmd = (args) => (AUDIO_FAKE ? [process.execPath, [AUDIO_FAKE, ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }] : [AUDIO_EXE, args, {}]);
const NAVEGADORES = ['chrome.exe', 'msedge.exe', 'brave.exe', 'firefox.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe', 'browser.exe', 'zen.exe', 'librewolf.exe', 'waterfox.exe', 'thorium.exe', 'floorp.exe', 'chromium.exe'];

let janela = null;
let tray = null;
let saindo = false;
let sessao = null;
let login = null;
let cliente = null;
let midia = null;
let videoJanela = null;
let videoDados = null; // last payload from the main window, replayed when the video window loads
let ultOffset = 0;
let emSessao = false; // true while a media session is open (auto-update waits)
let atualizacao = null;
// Live share: window chosen in the picker (used by getDisplayMedia in the main window) and the audio helper process.
let fontes = [];          // last desktopCapturer list
let fonteEscolhida = null; // { id, sistema } — sistema: send the whole PC sound (helper failed)
let audioProc = null;

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https://cdn.discordapp.com data:; media-src https:" + (env.JUNTO_TESTE_MIDIA === '1' && !app.isPackaged ? ' http://127.0.0.1:*' : ''); // local media server only in e2e tests

function enviarTela(canal, dado) {
  if (janela && !janela.isDestroyed() && !janela.webContents.isDestroyed()) janela.webContents.send(canal, dado);
}

function enviarVideo(canal, dado) {
  if (videoJanela && !videoJanela.isDestroyed() && !videoJanela.webContents.isDestroyed()) videoJanela.webContents.send(canal, dado);
}

let fechandoVideo = false; // closed by the program (session ended, item without video): do not pop the main window
function fecharVideo() {
  if (videoJanela && !videoJanela.isDestroyed()) { fechandoVideo = true; videoJanela.close(); }
}

// Separate 16:9 window for the video element. Same security settings as the main window; Esc or close returns to it.
function abrirVideo() {
  if (videoJanela && !videoJanela.isDestroyed()) { if (!oculto) { videoJanela.show(); videoJanela.focus(); } return; }
  const opts = {
    width: 960,
    height: 540,
    minWidth: 320,
    minHeight: 180,
    useContentSize: true,
    resizable: true,
    backgroundColor: '#000000',
    show: false,
    icon: ICONE,
    title: 'Junto: vídeo',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-video.js'),
    },
  };
  if (oculto) { opts.x = -3000; opts.y = -3000; opts.skipTaskbar = true; }
  const v = new BrowserWindow(opts);
  videoJanela = v; fechandoVideo = false;
  v.setMenu(null);
  v.setAspectRatio(16 / 9);
  const wc = v.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const bloquear = (e, url) => { if (!url.startsWith(VIDEO_URL)) e.preventDefault(); };
  wc.on('will-navigate', bloquear);
  wc.on('will-redirect', bloquear);
  wc.on('did-finish-load', () => {
    enviarVideo('junto:offset', ultOffset);
    if (videoDados) enviarVideo('junto:video-dados', videoDados);
  });
  // Native window fullscreen (HTML requestFullscreen crashed the renderer); the page only learns the state.
  v.on('enter-full-screen', () => enviarVideo('junto:tela-cheia', true));
  v.on('leave-full-screen', () => enviarVideo('junto:tela-cheia', false));
  v.once('ready-to-show', () => { if (oculto) v.showInactive(); else v.show(); });
  v.on('closed', () => {
    const peloPrograma = fechandoVideo; fechandoVideo = false;
    if (videoJanela === v) videoJanela = null;
    enviarTela('junto:video-acao', 'fechado'); // live share stops feeding it
    if (!saindo && !peloPrograma) mostrar(); // user closed it (X / Alt+F4): back to the main window
  });
  v.loadFile(VIDEO);
}

function mostrar() {
  if (!janela || janela.isDestroyed()) return;
  if (janela.isMinimized()) janela.restore();
  if (oculto) { janela.showInactive(); return; }
  janela.show();
  janela.focus();
}

function criarJanela() {
  const opts = {
    width: 400,
    height: 712,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#11131C',
    show: false,
    icon: ICONE,
    title: 'Junto',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // live share keeps capturing and sending while the window sits in the tray
      preload: path.join(__dirname, 'preload.js'),
    },
  };
  if (oculto) { opts.x = -3000; opts.y = -3000; opts.skipTaskbar = true; }
  janela = new BrowserWindow(opts);
  janela.setMenu(null);

  const wc = janela.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const bloquear = (e, url) => { if (!url.startsWith(TELA_URL)) e.preventDefault(); };
  wc.on('will-navigate', bloquear);
  wc.on('will-redirect', bloquear);
  // A 401 can arrive before the screen has loaded; the screen would then wait forever on "carregando".
  wc.on('did-finish-load', () => { if (cliente) cliente.reenviar(); if (sessaoFimPendente) enviarTela('junto:sessao-fim'); enviarTela('junto:offset', ultOffset); });

  // Started minimized but logged out: the tray alone would hide the login, so show the window.
  janela.once('ready-to-show', () => { if (oculto) janela.showInactive(); else if (!naBandeja || !(sessao && sessao.token())) janela.show(); });
  // Alt+F4 and the like hide to the tray; only "sair" really quits.
  janela.on('close', (e) => { if (!saindo) { e.preventDefault(); janela.hide(); } });
  // Windows shutdown/logoff: before-quit is not emitted, and hiding to the tray would block it.
  janela.on('session-end', () => { saindo = true; });
  janela.on('closed', () => { janela = null; });

  janela.loadFile(TELA, { hash: sessao && sessao.token() ? 'principal' : 'login' });
}

// "Iniciar com o Windows" / "Iniciar minimizado": Windows startup entry for this exe (packaged only).
function aplicarOpcoes(o) {
  if (!app.isPackaged || oculto || !o) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!o.win, path: process.execPath, args: o.min ? ['--minimizado'] : [] });
  } catch (e) { log('opcoes: inicio com o Windows falhou', e && e.message); }
}

function criarTray() {
  let img = nativeImage.createFromPath(ICONE);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Junto');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: mostrar },
    { label: 'Sair do Junto', click: () => sairDeVez() },
  ]));
  tray.on('click', mostrar);
}

function sairDeVez() {
  saindo = true;
  app.quit();
}

let sessaoFimPendente = false;
function iniciarCliente() {
  sessaoFimPendente = false;
  emSessao = false;
  if (cliente) cliente.parar();
  cliente = criarCliente({
    servidor: config.servidor,
    obterToken: () => sessao.token(),
    aoEstado: (e) => enviarTela('junto:estado', e),
    aoConexao: (c) => enviarTela('junto:conexao', c),
    aoSessao: (m) => { emSessao = !m.fim; enviarTela('junto:sessao', m); },
    aoOffset: (o) => { ultOffset = o; enviarTela('junto:offset', o); enviarVideo('junto:offset', o); },
    aoSessaoFim: () => { emSessao = false; sessao.apagar(); sessaoFimPendente = true; enviarTela('junto:sessao-fim'); },
    aoSinal: (s) => enviarTela('junto:sinal', s),
    log,
  });
  cliente.iniciar();
}

function remetenteVideoOk(evento) {
  const f = evento.senderFrame;
  return !!(f && typeof f.url === 'string' && f.url.startsWith(VIDEO_URL));
}

function remetenteOk(evento) {
  const f = evento.senderFrame;
  return !!(f && typeof f.url === 'string' && f.url.startsWith(TELA_URL));
}

// ---------- live share: window picker, audio helper ----------
function infoJanelas(hwnds) {
  return new Promise((ok) => {
    if (!hwnds.length || !fs.existsSync(AUDIO_EXE)) { ok(new Map()); return; }
    const [cmd, args, o] = audioCmd(['info', ...hwnds]);
    execFile(cmd, args, { ...o, timeout: 5000, windowsHide: true }, (err, out) => {
      const m = new Map();
      if (!err) for (const l of String(out).split(/\r?\n/)) { const [h, pid, exe] = l.trim().split(' '); if (h) m.set(h, { pid: Number(pid) || 0, exe: (exe || '').toLowerCase() }); }
      ok(m);
    });
  });
}

const hwndDe = (id) => { const m = /^window:(\d+):/.exec(String(id)); return m ? m[1] : null; };

async function listarFontes() {
  const lista = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
  const meus = new Set([janela, videoJanela].filter((w) => w && !w.isDestroyed()).map((w) => w.getMediaSourceId()));
  fontes = lista.filter((s) => !meus.has(s.id) && hwndDe(s.id));
  const info = await infoJanelas(fontes.map((s) => hwndDe(s.id)));
  const r = fontes.map((s) => {
    const i = info.get(hwndDe(s.id)) || { exe: '' };
    return { id: s.id, nome: String(s.name || '').slice(0, 200), exe: i.exe, navegador: NAVEGADORES.includes(i.exe), miniatura: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null };
  });
  r.sort((a, b) => (b.navegador - a.navegador));
  return r;
}

function pararAudio() {
  const p = audioProc; audioProc = null;
  if (!p) return;
  try { p.stdin.end(); } catch { /* gone */ }
  setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 1000);
}

// Sound of the chosen window only (its process tree), PCM s16le 48 kHz stereo pushed to the main window.
function iniciarAudio(id) {
  pararAudio();
  const h = hwndDe(id);
  if (!h || !fs.existsSync(AUDIO_EXE)) { enviarTela('junto:audio-estado', 'erro'); return; }
  const [cmd, args, o] = audioCmd(['captar', h]);
  const p = spawn(cmd, args, { ...o, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  audioProc = p;
  let resto = Buffer.alloc(0);
  p.stdout.on('data', (b) => {
    if (audioProc !== p) return;
    let d = resto.length ? Buffer.concat([resto, b]) : b;
    const n = d.length - (d.length % 4); // whole stereo frames only
    resto = d.subarray(n);
    if (n) enviarTela('junto:audio-pcm', d.subarray(0, n));
  });
  let err = '';
  p.stderr.on('data', (b) => {
    err += b;
    if (/^ok /m.test(err) && audioProc === p) { enviarTela('junto:audio-estado', 'ok'); err = ''; }
  });
  p.on('error', (e) => { log('audio: falhou', e && e.message); if (audioProc === p) { audioProc = null; enviarTela('junto:audio-estado', 'erro'); } });
  p.on('exit', (c) => { log('audio: saiu', c, err.trim().slice(0, 120)); if (audioProc === p) { audioProc = null; enviarTela('junto:audio-estado', 'erro'); } });
}

function registrarIpc() {
  ipcMain.handle('junto:fontes', async (ev) => {
    if (!remetenteOk(ev)) return [];
    try { return await listarFontes(); } catch (e) { log('fontes: erro', e && e.message); return []; }
  });
  ipcMain.handle('junto:escolher-fonte', (ev, id, sistema) => {
    if (!remetenteOk(ev)) return false;
    if (id === null) { fonteEscolhida = null; return true; }
    if (!fontes.some((s) => s.id === id)) return false;
    fonteEscolhida = { id, sistema: sistema === true };
    return true;
  });
  ipcMain.on('junto:audio', (ev, acao) => {
    if (!remetenteOk(ev)) return;
    if (acao === 'iniciar' && fonteEscolhida) iniciarAudio(fonteEscolhida.id); else pararAudio();
  });
  // Main window <-> video window: local WebRTC link that carries the live video (a MediaStream can't cross windows).
  ipcMain.on('junto:local', (ev, d) => {
    if (!d || typeof d !== 'object' || !['quero', 'oferta', 'resposta', 'fim'].includes(d.tipo)) return;
    const limpo = { tipo: d.tipo, sdp: typeof d.sdp === 'string' ? d.sdp.slice(0, 20000) : undefined };
    if (remetenteOk(ev)) enviarVideo('junto:local', limpo);
    else if (remetenteVideoOk(ev)) enviarTela('junto:local', limpo);
  });

  ipcMain.handle('junto:entrar', async (ev) => {
    if (!remetenteOk(ev)) return { ok: false, erro: 'discord_fora' };
    const r = await login.entrar();
    if (!r.ok) return { ok: false, erro: r.erro };
    await sessao.salvar(r.token);
    iniciarCliente();
    return { ok: true };
  });

  ipcMain.on('junto:cancelar-entrada', (ev) => { if (remetenteOk(ev)) login.cancelar(); });

  ipcMain.handle('junto:sair', async (ev) => {
    if (!remetenteOk(ev)) return;
    if (cliente) cliente.parar();
    emSessao = false;
    await sessao.sair();
  });

  // TURN relay servers for live share (from our server; credentials last 24 h, reused for 12 h)
  let iceCache = null;
  ipcMain.handle('junto:ice', async (ev) => {
    if (!remetenteOk(ev)) return [];
    if (iceCache && Date.now() - iceCache.em < 12 * 3600e3) return iceCache.lista;
    const t = sessao && sessao.token();
    if (!t || !config.servidor) return [];
    try {
      const r = await fetch(config.servidor.replace(/\/+$/, '') + '/turn', { headers: { authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(5000) });
      const d = r.ok ? await r.json() : null;
      const lista = d && Array.isArray(d.iceServers) ? d.iceServers : [];
      if (lista.length) iceCache = { em: Date.now(), lista };
      return lista;
    } catch (e) { log('ice: falhou', e && e.message); return []; }
  });

  ipcMain.handle('junto:enviar', async (ev, msg) => {
    if (!remetenteOk(ev)) throw new Error('sem_conexao');
    const limpa = validar(msg);
    if (!limpa) return { ok: false, erro: 'pedido_invalido' };
    if (!cliente) throw new Error('sem_conexao');
    return cliente.enviar(limpa);
  });

  // one in-flight yt-dlp per window and channel: a new resolve (or cancel) kills the previous one
  const chaveRes = (ev, canal) => ev.sender.id + ':' + (canal === 'add' ? 'add' : 'item');
  ipcMain.on('junto:cancelar-resolver', (ev) => { if (remetenteOk(ev)) midia.cancelar(chaveRes(ev, 'item')); });
  ipcMain.handle('junto:resolver', async (ev, url, tipo, canal) => {
    if (!remetenteOk(ev) || typeof url !== 'string' || url.length > 2048) return { ok: false, erro: 'falhou' };
    try { return await midia.resolver(url, tipo === 'ver' ? 'ver' : 'ouvir', chaveRes(ev, canal)); } catch (e) { log('resolver: erro', e && e.message); return { ok: false, erro: 'falhou' }; }
  });

  ipcMain.on('junto:abrir-video', (ev) => { if (remetenteOk(ev)) abrirVideo(); });
  ipcMain.on('junto:fechar-video', (ev) => { if (remetenteOk(ev)) { videoDados = null; fecharVideo(); } });
  ipcMain.on('junto:video-dados', (ev, d) => {
    if (!remetenteOk(ev) || !d || typeof d !== 'object') return;
    videoDados = {
      video: typeof d.video === 'string' && (/^https:\/\//i.test(d.video) || (env.JUNTO_TESTE_MIDIA === '1' && !app.isPackaged && /^http:\/\/127\.0\.0\.1[:/]/.test(d.video))) ? d.video : null,
      item: typeof d.item === 'string' ? d.item : null,
      aovivo: d.aovivo === true,
      titulo: String(d.titulo || '').slice(0, 300),
      sub: String(d.sub || '').slice(0, 200),
      dur: typeof d.dur === 'number' ? d.dur : null,
      P: d.P && typeof d.P === 'object'
        ? { item: d.P.item == null ? null : String(d.P.item), tocando: d.P.tocando === true, pos: Number(d.P.pos) || 0, base: Number(d.P.base) || 0 }
        : null,
    };
    enviarVideo('junto:video-dados', videoDados);
  });
  ipcMain.on('junto:video-acao', (ev, a) => {
    if (!remetenteVideoOk(ev)) return;
    if (a === 'fechar') { if (videoJanela && !videoJanela.isDestroyed()) videoJanela.close(); } // user's Esc/close: main window comes back
    else if (a === 'tocar') enviarTela('junto:video-acao', 'tocar');
    else if (a === 'telacheia' && videoJanela && !videoJanela.isDestroyed()) videoJanela.setFullScreen(!videoJanela.isFullScreen());
  });

  ipcMain.on('junto:janela', (ev, acao) => {
    if (!remetenteOk(ev) || !janela) return;
    if (acao === 'min') janela.minimize();
    else if (acao === 'fechar') janela.hide();
    else if (acao === 'sair') sairDeVez();
    else if (acao === 'mostrar') mostrar();
  });

  ipcMain.handle('junto:opcoes', (ev) => (remetenteOk(ev) ? opcoes.ler() : null));
  ipcMain.handle('junto:salvar-opcoes', async (ev, obj) => {
    if (!remetenteOk(ev)) return;
    aplicarOpcoes(await opcoes.salvar(obj));
  });
  ipcMain.on('junto:avisar', (ev, titulo, texto) => {
    if (!remetenteOk(ev)) return;
    if (oculto) { log('aviso: teste', String(titulo)); return; } // tests: never pop a toast on the user's screen
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: String(titulo || 'Junto'), body: String(texto || ''), icon: ICONE });
    n.on('click', mostrar);
    n.on('show', () => log('aviso: mostrado'));
    n.on('failed', (_e, err) => log('aviso: falhou', err));
    n.show();
  });
  ipcMain.handle('junto:versao', (ev) => (remetenteOk(ev) ? app.getVersion() : null));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { mostrar(); });
  app.on('window-all-closed', () => { /* stays in the tray */ });
  app.on('before-quit', () => {
    saindo = true;
    if (atualizacao) atualizacao.aoSair();
    if (midia) midia.cancelarTudo();
    pararAudio();
    if (cliente) cliente.parar();
    if (tray) { tray.destroy(); tray = null; }
  });

  app.setAppUserModelId(process.execPath); // Windows needs it to show notifications
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onHeadersReceived((det, cb) => {
      cb({ responseHeaders: { ...det.responseHeaders, 'Content-Security-Policy': [CSP] } });
    });
    // Only the main window may capture (live share); everything else is denied.
    const daTela = (wc) => !!(janela && !janela.isDestroyed() && wc === janela.webContents);
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb, det) => cb(daTela(wc) && (perm === 'display-capture' || (perm === 'media' && !!det && Array.isArray(det.mediaTypes) && !det.mediaTypes.includes('audio') && !!fonteEscolhida))));
    session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
      const f = fonteEscolhida && fontes.find((s) => s.id === fonteEscolhida.id);
      if (!f || !janela || janela.isDestroyed() || req.frame !== janela.webContents.mainFrame) { cb({}); return; }
      cb(fonteEscolhida.sistema ? { video: f, audio: 'loopback' } : { video: f });
    });

    sessao = criarSessao({ dir: dados, safeStorage, log, servidor: () => config.servidor });
    sessao.carregar();
    login = criarLogin({
      servidor: config.servidor,
      clientId: config.discordClientId,
      autorizar: config.autorizar,
      abrir: (url) => {
        if (env.JUNTO_SEM_NAVEGADOR === '1') {
          // Test mode: follow the authorize URL's redirects ourselves instead of opening a browser.
          fetch(url, { redirect: 'follow' }).catch((e) => log('login: fetch de teste falhou', e && e.message));
          return undefined;
        }
        return shell.openExternal(url);
      },
      log,
    });
    midia = criarMidia({ dados, recursos: app.isPackaged ? process.resourcesPath : __dirname, log, dev: !app.isPackaged });
    registrarIpc();
    criarJanela();
    criarTray();
    aplicarOpcoes(opcoes.ler());
    if (sessao.token()) iniciarCliente();
    atualizacao = criarAtualizacao({
      atual: app.getVersion(), log, emSessao: () => emSessao, sair: () => app.quit(),
      minimizado: () => !janela || janela.isDestroyed() || (!janela.isVisible() && !janela.isMinimized()), // in the tray, not on the taskbar
      ativo: app.isPackaged || !!env.JUNTO_TESTE_ATUALIZACAO,
    });
    atualizacao.iniciar();
    log('app: iniciado');
  });
}
