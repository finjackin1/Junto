'use strict';
// WebSocket client to the Worker (docs/contexto/protocolo.md, "WebSocket messages").
// No Electron dependency. Timers and the ws class are injectable for tests.
const WS = require('ws');
const { criarRelogio } = require('./tela/sincronia');

const PERMITIDAS = ['pedir', 'aceitar', 'recusar', 'cancelar', 'remover',
  'oferecer', 'parar', 'entrar_sessao', 'sair_sessao', 'adicionar', 'tirar', 'tocar', 'pausar', 'buscar', 'pular', 'voltar', 'fim', 'sinal'];
const POR_USUARIO = ['pedir', 'cancelar'];
const POR_ID = ['aceitar', 'recusar', 'remover'];
const ATRASOS = [1000, 2000, 4000, 8000, 16000, 30000];

const SEM_CAMPOS = ['parar', 'sair_sessao', 'pular', 'voltar'];
const txt = (v, max) => typeof v === 'string' && v.length <= max;
const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7;

// Stage 2 messages. Returns a clean message or null.
function validarSessao(msg) {
  const t = msg.t;
  if (SEM_CAMPOS.includes(t)) return { t };
  if (t === 'oferecer') {
    if (!['ouvir', 'ver'].includes(msg.tipo) || !['todos', 'dono', 'fila'].includes(msg.modo)) return null;
    if (msg.fonte === 'aba') return { t, tipo: msg.tipo, modo: msg.modo, fonte: 'aba', titulo: typeof msg.titulo === 'string' ? msg.titulo.slice(0, 200) : '' };
    return { t, tipo: msg.tipo, modo: msg.modo };
  }
  if (t === 'sinal') {
    const d = msg.dados;
    if (typeof msg.para !== 'string' || !/^[0-9]{1,32}$/.test(msg.para) || !d || typeof d !== 'object') return null;
    if (!['quero', 'oferta', 'resposta', 'fim'].includes(d.tipo)) return null;
    if (d.id !== undefined && !(typeof d.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(d.id))) return null;
    if (d.sdp !== undefined && !txt(d.sdp, 15000)) return null;
    const dados = { tipo: d.tipo };
    if (d.id !== undefined) dados.id = d.id;
    if (d.sdp !== undefined) dados.sdp = d.sdp;
    return { t, para: msg.para, dados };
  }
  if (t === 'entrar_sessao') return typeof msg.dono === 'string' && /^[0-9]{1,32}$/.test(msg.dono) ? { t, dono: msg.dono } : null;
  if (t === 'tirar') return typeof msg.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(msg.id) ? { t, id: msg.id } : null;
  if (t === 'fim') return typeof msg.item === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(msg.item) ? { t, item: msg.item } : null;
  if (t === 'buscar') return num(msg.pos) ? { t, pos: msg.pos } : null;
  if (t === 'tocar' || t === 'pausar') {
    if (msg.pos === undefined || msg.pos === null) return { t };
    return num(msg.pos) ? { t, pos: msg.pos } : null;
  }
  if (t === 'adicionar') {
    if (!txt(msg.url, 2048) || !/^https?:\/\/\S+$/i.test(msg.url)) return null;
    if (!txt(msg.titulo, 200) || !txt(msg.sub, 120)) return null;
    if (msg.dur !== null && msg.dur !== undefined && !num(msg.dur)) return null;
    return { t, url: msg.url, titulo: msg.titulo, sub: msg.sub, dur: msg.dur == null ? null : msg.dur };
  }
  return null;
}

// Allow-list check shared with main's IPC handler. Returns a clean message or null.
function validar(msg) {
  if (!msg || typeof msg !== 'object' || !PERMITIDAS.includes(msg.t)) return null;
  if (!['pedir', 'aceitar', 'recusar', 'cancelar', 'remover'].includes(msg.t)) return validarSessao(msg);
  if (POR_USUARIO.includes(msg.t)) {
    if (typeof msg.usuario !== 'string' || msg.usuario.length === 0 || msg.usuario.length > 100) return null;
    return { t: msg.t, usuario: msg.usuario };
  }
  if (POR_ID.includes(msg.t)) {
    if (typeof msg.id !== 'string' || !/^[0-9]{1,32}$/.test(msg.id)) return null;
    return { t: msg.t, id: msg.id };
  }
  return null;
}

function urlWs(servidor) {
  return String(servidor).replace(/\/+$/, '').replace(/^http/i, 'ws') + '/ws';
}

function criarCliente({
  servidor,
  obterToken,
  aoEstado = () => {},
  aoConexao = () => {},
  aoSessaoFim = () => {},
  aoSessao = () => {}, // stage 2: {t:"sessao"} snapshots and ends
  aoOffset = () => {}, // stage 2: clock offset (ms) changed
  aoSinal = () => {}, // live tab share: {t:"sinal",de,dados} relayed WebRTC messages
  intervaloHora = 30000,
  horaPings = 5,
  horaEntre = 200,
  aoAgendar = () => {}, // test hook: delay chosen for each reconnect
  log = () => {},
  WebSocketImpl = WS,
  atrasos = ATRASOS,
  jitter = (d) => Math.round(d * (0.75 + Math.random() * 0.5)),
  intervaloPing = 30000,
  silencioMax = 75000,
  verificarCada = 5000,
  respostaMs = 10000,
}) {
  let ws = null;
  let ligado = false; // iniciar() called and not parar()
  let tentativa = 0;
  let timerReconexao = null;
  let timerPing = null;
  let timerVigia = null;
  let timerHora = null;
  let timersHora = [];
  const relogio = criarRelogio(() => Date.now());
  let ultimaSessao = null;
  let ultimoSinal = 0;
  let ultimoEstado = null;
  let conexao = null; // null before first change, then "on" | "reconectando"
  let proximoN = 1;
  const pendentes = new Map(); // n -> { resolve, reject, timer }

  function mudarConexao(c) {
    if (conexao === c) return;
    conexao = c;
    aoConexao(c);
  }

  function rejeitarPendentes() {
    for (const [, p] of pendentes) { clearTimeout(p.timer); p.reject(new Error('sem_conexao')); }
    pendentes.clear();
  }

  function pararTimersConexao() {
    clearInterval(timerPing); timerPing = null;
    clearInterval(timerVigia); timerVigia = null;
    clearInterval(timerHora); timerHora = null;
    for (const t of timersHora) clearTimeout(t);
    timersHora = [];
  }

  function pingHora(meu) {
    try { meu.send(JSON.stringify({ t: 'hora', n: proximoN++, c: Date.now() })); } catch { /* closing */ }
  }

  function agendar() {
    if (!ligado || timerReconexao) return;
    const base = atrasos[Math.min(tentativa, atrasos.length - 1)];
    tentativa++;
    const atraso = jitter(base);
    aoAgendar(atraso, base);
    timerReconexao = setTimeout(() => { timerReconexao = null; conectar(); }, atraso);
  }

  function aoFechar(meu) {
    if (ws !== meu) return;
    ws = null;
    pararTimersConexao();
    rejeitarPendentes();
    if (!ligado) return;
    mudarConexao('reconectando');
    agendar();
  }

  function conectar() {
    if (!ligado || ws) return;
    const token = obterToken();
    if (!token) { log('cliente: sem token, parado'); ligado = false; return; }
    let meu;
    try {
      meu = new WebSocketImpl(urlWs(servidor), { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 15000 });
    } catch (e) {
      log('cliente: nao criou o socket', e && e.message);
      agendar();
      return;
    }
    ws = meu;

    meu.on('unexpected-response', (req, res) => {
      res.resume();
      if (ws !== meu) return;
      if (res.statusCode === 401) {
        log('cliente: sessao invalida (401), parando');
        ws = null; ligado = false;
        pararTimersConexao(); rejeitarPendentes();
        ultimoEstado = null;
        try { meu.terminate(); } catch { /* already gone */ }
        aoSessaoFim();
        return;
      }
      log('cliente: upgrade recusado', res.statusCode);
      try { meu.terminate(); } catch { /* already gone */ }
    });

    meu.on('open', () => {
      if (ws !== meu) return;
      tentativa = 0;
      ultimoSinal = Date.now();
      mudarConexao('on');
      timerPing = setInterval(() => { try { meu.send('ping'); } catch { /* closing */ } }, intervaloPing);
      for (let i = 0; i < horaPings; i++) timersHora.push(setTimeout(() => { if (ws === meu) pingHora(meu); }, i * horaEntre));
      timerHora = setInterval(() => pingHora(meu), intervaloHora);
      timerVigia = setInterval(() => {
        if (Date.now() - ultimoSinal >= silencioMax) {
          log('cliente: sem sinal, reconectando');
          try { meu.terminate(); } catch { /* already gone */ }
        }
      }, verificarCada);
    });

    meu.on('pong', () => { ultimoSinal = Date.now(); });

    meu.on('message', (dados) => {
      ultimoSinal = Date.now();
      const texto = dados.toString();
      if (texto === 'pong') return;
      let m;
      try { m = JSON.parse(texto); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'estado') {
        ultimoEstado = m;
        aoEstado(m);
      } else if (m.t === 'hora') {
        if (typeof m.c === 'number' && typeof m.s === 'number') {
          relogio.amostra(m.c, m.s, Date.now());
          aoOffset(relogio.offset);
        }
      } else if (m.t === 'sessao') {
        ultimaSessao = m.fim ? null : m;
        aoSessao(m);
      } else if (m.t === 'sinal') {
        if (typeof m.de === 'string' && m.dados && typeof m.dados === 'object') aoSinal({ de: m.de, dados: m.dados });
      } else if (m.t === 'resposta' && pendentes.has(m.n)) {
        const p = pendentes.get(m.n);
        pendentes.delete(m.n);
        clearTimeout(p.timer);
        const r = { ok: m.ok === true };
        if (!r.ok) r.erro = typeof m.erro === 'string' ? m.erro : 'pedido_invalido';
        p.resolve(r);
      }
    });

    meu.on('error', (e) => { log('cliente: erro de socket', e && (e.code || e.message)); });
    meu.on('close', () => aoFechar(meu));
  }

  function iniciar() {
    if (ligado) return;
    ligado = true;
    tentativa = 0;
    conectar();
  }

  function parar() {
    ligado = false;
    clearTimeout(timerReconexao); timerReconexao = null;
    pararTimersConexao();
    rejeitarPendentes();
    ultimoEstado = null;
    ultimaSessao = null;
    conexao = null;
    if (ws) {
      const w = ws; ws = null;
      try { w.terminate(); } catch { /* already gone */ }
    }
  }

  function enviar(msg) {
    const limpa = validar(msg);
    if (!limpa) return Promise.resolve({ ok: false, erro: 'pedido_invalido' });
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('sem_conexao'));
    const n = proximoN++;
    const texto = JSON.stringify({ ...limpa, n });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendentes.delete(n); reject(new Error('sem_conexao')); }, respostaMs);
      pendentes.set(n, { resolve, reject, timer });
      try { ws.send(texto); } catch (e) { clearTimeout(timer); pendentes.delete(n); reject(new Error('sem_conexao')); }
    });
  }

  // Called when the renderer (re)loads: send it the last known state again.
  function reenviar() {
    if (conexao) aoConexao(conexao);
    if (ultimoEstado) aoEstado(ultimoEstado);
    if (ultimaSessao) aoSessao(ultimaSessao);
    aoOffset(relogio.offset);
  }

  return { iniciar, parar, enviar, reenviar, agoraServidor: () => relogio.agora(), offset: () => relogio.offset, ativo: () => ligado, conexao: () => conexao, ultimoEstado: () => ultimoEstado };
}

module.exports = { criarCliente, validar, urlWs, ATRASOS };
