'use strict';
// Sandboxed preload: only electron modules are available here, so the allow-list is repeated
// (main's IPC handler validates it again, field by field). Exposes exactly the bridge in docs/contexto/protocolo.md.
const { contextBridge, ipcRenderer } = require('electron');

const PERMITIDAS = ['pedir', 'aceitar', 'recusar', 'cancelar', 'remover',
  'oferecer', 'parar', 'entrar_sessao', 'sair_sessao', 'adicionar', 'tirar', 'tocar', 'pausar', 'buscar', 'pular', 'voltar', 'fim'];
const JANELA = ['min', 'fechar', 'sair'];
let offset = 0; // server clock minus local clock, pushed by main

function ouvir(canal, cb) {
  if (typeof cb !== 'function') return;
  ipcRenderer.on(canal, (_evento, dado) => { cb(dado); });
}
ipcRenderer.on('junto:offset', (_e, o) => { if (typeof o === 'number' && Number.isFinite(o)) offset = o; });

contextBridge.exposeInMainWorld('junto', {
  entrar: () => ipcRenderer.invoke('junto:entrar'),
  cancelarEntrada: () => { ipcRenderer.send('junto:cancelar-entrada'); },
  sair: () => ipcRenderer.invoke('junto:sair'),
  enviar: (msg) => {
    if (!msg || typeof msg !== 'object' || !PERMITIDAS.includes(msg.t)) {
      return Promise.resolve({ ok: false, erro: 'pedido_invalido' });
    }
    const { t, usuario, id, tipo, modo, dono, url, titulo, sub, dur, pos, item } = msg;
    return ipcRenderer.invoke('junto:enviar', { t, usuario, id, tipo, modo, dono, url, titulo, sub, dur, pos, item })
      .catch(() => { throw new Error('sem_conexao'); });
  },
  janela: (acao) => { if (JANELA.includes(acao)) ipcRenderer.send('junto:janela', acao); },
  opcoes: () => ipcRenderer.invoke('junto:opcoes'),
  salvarOpcoes: (obj) => ipcRenderer.invoke('junto:salvar-opcoes', obj),
  aoEstado: (cb) => ouvir('junto:estado', cb),
  aoConexao: (cb) => ouvir('junto:conexao', cb),
  aoSessaoFim: (cb) => ouvir('junto:sessao-fim', cb),
  // stage 2
  resolver: (url, tipo, canal) => ipcRenderer.invoke('junto:resolver', String(url), tipo === 'ver' ? 'ver' : 'ouvir', canal === 'add' ? 'add' : 'item')
    .catch(() => ({ ok: false, erro: 'falhou' })),
  cancelarResolver: () => { ipcRenderer.send('junto:cancelar-resolver'); },
  agoraServidor: () => Date.now() + offset,
  aoSessao: (cb) => ouvir('junto:sessao', cb),
  abrirVideo: () => { ipcRenderer.send('junto:abrir-video'); },
  fecharVideo: () => { ipcRenderer.send('junto:fechar-video'); },
  videoDados: (d) => { ipcRenderer.send('junto:video-dados', d); },
  aoVideoAcao: (cb) => ouvir('junto:video-acao', cb),
});
