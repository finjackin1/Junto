'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { criarCliente, validar, urlWs, ATRASOS } = require('../cliente');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(f, ms = 3000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await f()) return; await espera(10); }
  throw new Error('tempo esgotado esperando condicao');
}

// Fake Worker: onConexao(ws, req) decides what to do; "rejeitar" refuses the upgrade with a status.
function servidorFalso({ onConexao = () => {}, rejeitar = null } = {}) {
  const http_ = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const conexoes = [];
  http_.on('upgrade', (req, socket, head) => {
    conexoes.push({ auth: req.headers.authorization });
    if (rejeitar && rejeitar.status) {
      socket.write(`HTTP/1.1 ${rejeitar.status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConexao(ws, req));
  });
  return new Promise((r) => http_.listen(0, '127.0.0.1', () => r({
    url: `http://127.0.0.1:${http_.address().port}`,
    conexoes,
    wss,
    fechar: () => { for (const c of wss.clients) c.terminate(); wss.close(); http_.close(); http_.closeAllConnections(); },
  })));
}

const rapido = { atrasos: [5, 10, 20, 40, 80, 150], jitter: (d) => d };

test('validar: allow-list e campos', () => {
  assert.deepEqual(validar({ t: 'pedir', usuario: '@Beto', extra: 1 }), { t: 'pedir', usuario: '@Beto' });
  assert.deepEqual(validar({ t: 'aceitar', id: '123' }), { t: 'aceitar', id: '123' });
  assert.equal(validar({ t: 'estado' }), null);
  assert.equal(validar({ t: 'pedir' }), null);
  assert.equal(validar({ t: 'remover', id: '../x' }), null);
  assert.equal(validar({ t: 'pedir', usuario: 'a'.repeat(101) }), null);
  assert.equal(validar(null), null);
});

test('urlWs troca http por ws e https por wss', () => {
  assert.equal(urlWs('http://127.0.0.1:1/'), 'ws://127.0.0.1:1/ws');
  assert.equal(urlWs('https://x.workers.dev'), 'wss://x.workers.dev/ws');
});

test('atrasos de reconexao do contrato', () => assert.deepEqual(ATRASOS, [1000, 2000, 4000, 8000, 16000, 30000]));

test('conecta com Authorization, recebe estado, responde por n, repete estado ao recarregar', async () => {
  const estadoMsg = { t: 'estado', eu: { id: '1' }, amigos: [], recebidos: [], enviados: [] };
  const s = await servidorFalso({
    onConexao: (ws) => {
      ws.send(JSON.stringify(estadoMsg));
      ws.on('message', (d) => {
        const t = d.toString();
        if (t === 'ping') return ws.send('pong');
        const m = JSON.parse(t);
        ws.send(JSON.stringify(m.usuario === 'ruim' ? { t: 'resposta', n: m.n, ok: false, erro: 'nome_invalido' } : { t: 'resposta', n: m.n, ok: true }));
      });
    },
  });
  const estados = []; const conexoes = [];
  const c = criarCliente({ servidor: s.url, obterToken: () => 'tok-1', aoEstado: (e) => estados.push(e), aoConexao: (x) => conexoes.push(x), ...rapido, intervaloPing: 20 });
  c.iniciar();
  await ate(() => estados.length === 1);
  assert.equal(s.conexoes[0].auth, 'Bearer tok-1');
  assert.deepEqual(conexoes, ['on']);
  assert.deepEqual(await c.enviar({ t: 'pedir', usuario: 'beto' }), { ok: true });
  assert.deepEqual(await c.enviar({ t: 'pedir', usuario: 'ruim' }), { ok: false, erro: 'nome_invalido' });
  assert.deepEqual(await c.enviar({ t: 'pedir' }), { ok: false, erro: 'pedido_invalido' });
  c.reenviar();
  assert.equal(estados.length, 2);
  assert.deepEqual(conexoes, ['on', 'on']);
  c.parar();
  assert.equal(c.ultimoEstado(), null);
  s.fechar();
});

test('sequencia de reconexao 1,2,4,8,16,30 (escala), reinicia apos conexao bem sucedida', async () => {
  const s =await servidorFalso({ onConexao: (ws) => { ws.send(JSON.stringify({ t: 'estado' })); setTimeout(() => ws.terminate(), 30); } });
  // First phase: refuse with 500 so every attempt fails.
  const agendas = []; const conexoes = [];
  const falho = await servidorFalso({ rejeitar: { status: 500 } });
  const c = criarCliente({
    servidor: falho.url, obterToken: () => 'tok', aoAgendar: (d) => agendas.push(d), aoConexao: (x) => conexoes.push(x), ...rapido,
  });
  c.iniciar();
  await ate(() => agendas.length >= 7, 4000);
  assert.deepEqual(agendas.slice(0, 7), [5, 10, 20, 40, 80, 150, 150]);
  assert.ok(conexoes.includes('reconectando'));
  c.parar();
  falho.fechar();

  // Second phase: connects, then drops: delay goes back to the first step.
  const agendas2 = [];
  const c2 = criarCliente({ servidor: s.url, obterToken: () => 'tok', aoAgendar: (d) => agendas2.push(d), ...rapido });
  c2.iniciar();
  await ate(() => agendas2.length >= 3, 3000);
  assert.deepEqual(agendas2.slice(0, 3), [5, 5, 5]);
  c2.parar();
  s.fechar();
});

test('401 no upgrade: limpa sessao, avisa uma vez e para de tentar', async () => {
  const s = await servidorFalso({ rejeitar: { status: 401 } });
  let fim = 0; const agendas = [];
  const c = criarCliente({ servidor: s.url, obterToken: () => 'velho', aoSessaoFim: () => { fim++; }, aoAgendar: (d) => agendas.push(d), ...rapido });
  c.iniciar();
  await ate(() => fim === 1);
  await espera(150);
  assert.equal(fim, 1);
  assert.equal(s.conexoes.length, 1);
  assert.equal(agendas.length, 0);
  assert.equal(c.ativo(), false);
  s.fechar();
});

test('silencio por mais que o limite derruba e reconecta', async () => {
  const s = await servidorFalso({ onConexao: () => { /* never answers */ } });
  const agendas = [];
  const c = criarCliente({ servidor: s.url, obterToken: () => 'tok', aoAgendar: (d) => agendas.push(d), ...rapido, intervaloPing: 1e6, silencioMax: 60, verificarCada: 10 });
  c.iniciar();
  await ate(() => agendas.length >= 1 && s.conexoes.length >= 2, 3000);
  c.parar();
  s.fechar();
});

test('enviar sem conexao rejeita sem_conexao; resposta que nao vem rejeita no limite', async () => {
  const c0 = criarCliente({ servidor: 'http://127.0.0.1:9', obterToken: () => 'tok', ...rapido });
  await assert.rejects(c0.enviar({ t: 'pedir', usuario: 'beto' }), /sem_conexao/);
  const s = await servidorFalso({ onConexao: () => {} });
  const c = criarCliente({ servidor: s.url, obterToken: () => 'tok', respostaMs: 80, ...rapido });
  c.iniciar();
  await ate(() => c.conexao() === 'on');
  await assert.rejects(c.enviar({ t: 'pedir', usuario: 'beto' }), /sem_conexao/);
  c.parar();
  s.fechar();
});

test('manda ping de texto no intervalo', async () => {
  const pings = [];
  const s = await servidorFalso({ onConexao: (ws) => ws.on('message', (d) => { if (d.toString().startsWith('{')) return; pings.push(d.toString()); ws.send('pong'); }) });
  const c = criarCliente({ servidor: s.url, obterToken: () => 'tok', ...rapido, intervaloPing: 20 });
  c.iniciar();
  await ate(() => pings.length >= 2);
  assert.ok(pings.every((p) => p === 'ping'));
  c.parar();
  s.fechar();
});

test('etapa 2: validar mensagens de sessao', () => {
  assert.deepEqual(validar({ t: 'oferecer', tipo: 'ver', modo: 'fila', x: 1 }), { t: 'oferecer', tipo: 'ver', modo: 'fila' });
  assert.equal(validar({ t: 'oferecer', tipo: 'x', modo: 'fila' }), null);
  assert.deepEqual(validar({ t: 'parar', lixo: 1 }), { t: 'parar' });
  assert.deepEqual(validar({ t: 'entrar_sessao', dono: '123' }), { t: 'entrar_sessao', dono: '123' });
  assert.equal(validar({ t: 'entrar_sessao', dono: 'a/b' }), null);
  assert.equal(validar({ t: 'buscar', pos: -1 }), null);
  assert.deepEqual(validar({ t: 'tocar' }), { t: 'tocar' });
  assert.deepEqual(validar({ t: 'adicionar', url: 'https://a.b/c', titulo: 't', sub: 's', dur: null }), { t: 'adicionar', url: 'https://a.b/c', titulo: 't', sub: 's', dur: null });
  assert.equal(validar({ t: 'adicionar', url: 'file:///x', titulo: 't', sub: 's', dur: 1 }), null);
  assert.equal(validar({ t: 'fim', item: '../x' }), null);
  assert.deepEqual(validar({ t: 'tirar', id: 'Ab_-1234' }), { t: 'tirar', id: 'Ab_-1234' });
});

test('etapa 2: hora alimenta o relogio e sessao chega ao ouvinte', async () => {
  const recebidos = [];
  const offsets = [];
  const s = await servidorFalso({ onConexao: (ws) => {
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.t === 'hora') ws.send(JSON.stringify({ t: 'hora', n: m.n, c: m.c, s: Date.now() + 5000 }));
    });
    ws.send(JSON.stringify({ t: 'sessao', dono: '1', tipo: 'ouvir', modo: 'todos', gente: [], fila: [], P: { item: null, tocando: false, pos: 0, base: 0 }, agora: 1 }));
  } });
  const c = criarCliente({ servidor: s.url, obterToken: () => 'tok', ...rapido, horaEntre: 10, aoSessao: (m) => recebidos.push(m), aoOffset: (o) => offsets.push(o) });
  c.iniciar();
  try {
    await ate(() => offsets.length >= 5 && recebidos.length >= 1);
    assert.ok(Math.abs(c.offset() - 5000) < 200, 'offset ' + c.offset());
    assert.ok(Math.abs(c.agoraServidor() - Date.now() - 5000) < 200);
    assert.equal(recebidos[0].dono, '1');
  } finally { c.parar(); s.fechar(); }
});
