'use strict';
// Junto main process, stage 1: window, tray, Discord login, stored session, WebSocket client, options, bridge.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, session, safeStorage, Notification } = require('electron');

const { criarLog } = require('./log');
const { criarOpcoes } = require('./opcoes');
const { criarSessao } = require('./sessao');
const { criarLogin } = require('./login');
const { criarCliente, validar } = require('./cliente');
const { criarMidia } = require('./midia');
const { criarAtualizacao } = require('./atualizacao');

const env = process.env;
const oculto = env.JUNTO_OCULTO === '1';
// Started by Windows at logon with "Iniciar minimizado" on: stay in the tray.
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

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https://cdn.discordapp.com data:; media-src https:" + (env.JUNTO_TESTE_MIDIA === '1' && !app.isPackaged ? ' http://127.0.0.1:*' : ''); // local media server only in e2e tests

function enviarTela(canal, dado) {
  if (janela && !janela.isDestroyed() && !janela.webContents.isDestroyed()) janela.webContents.send(canal, dado);
}

function enviarVideo(canal, dado) {
  if (videoJanela && !videoJanela.isDestroyed() && !videoJanela.webContents.isDestroyed()) videoJanela.webContents.send(canal, dado);
}

function fecharVideo() {
  if (videoJanela && !videoJanela.isDestroyed()) videoJanela.close();
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
  videoJanela = v;
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
  v.once('ready-to-show', () => { if (oculto) v.showInactive(); else v.show(); });
  v.on('closed', () => { if (videoJanela === v) videoJanela = null; if (!saindo) mostrar(); });
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

  janela.once('ready-to-show', () => { if (oculto) janela.showInactive(); else if (!naBandeja) janela.show(); });
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
    aoSessaoFim: () => { sessao.apagar(); sessaoFimPendente = true; enviarTela('junto:sessao-fim'); },
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

function registrarIpc() {
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
    await sessao.sair();
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
    if (a === 'fechar') fecharVideo();
    else if (a === 'tocar') enviarTela('junto:video-acao', 'tocar');
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
    if (cliente) cliente.parar();
    if (tray) { tray.destroy(); tray = null; }
  });

  app.setAppUserModelId(process.execPath); // Windows needs it to show notifications
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onHeadersReceived((det, cb) => {
      cb({ responseHeaders: { ...det.responseHeaders, 'Content-Security-Policy': [CSP] } });
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

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
      ativo: app.isPackaged || !!env.JUNTO_TESTE_ATUALIZACAO,
    });
    atualizacao.iniciar();
    log('app: iniciado');
  });
}
