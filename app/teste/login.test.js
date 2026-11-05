'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { criarLogin, gerarPkce, desafioDe, PORTA } = require('../login');

function servidorFalso(responder) {
  const vistos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      vistos.push({ url: req.url, metodo: req.method, corpo: corpo ? JSON.parse(corpo) : null });
      const [status, json] = responder(vistos[vistos.length - 1]);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({
    url: `http://127.0.0.1:${srv.address().port}`,
    vistos,
    fechar: () => { srv.close(); srv.closeAllConnections(); },
  })));
}

const ok = () => [200, { token: 'tok_segredo_123', eu: { id: '1' } }];
const params = (url) => new URL(url).searchParams;
const volta = async (url, extra) => {
  const p = params(url);
  const u = new URL(p.get('redirect_uri'));
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return fetch(u, { redirect: 'manual' });
};

test('PKCE: vetor de teste da RFC 7636', () => {
  assert.equal(desafioDe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('PKCE: verifier 32 bytes, state 16 bytes, base64url, challenge confere', () => {
  const p = gerarPkce();
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(p.state, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(p.challenge, crypto.createHash('sha256').update(p.verifier).digest('base64url'));
  assert.notEqual(gerarPkce().verifier, p.verifier);
});

test('consent_required: refaz uma vez sem prompt=none, mesmo state e desafio', async () => {
  const s = await servidorFalso(ok);
  let de1, de2;
  const l = criarLogin({
    servidor: s.url, clientId: 'cid', porta: 0,
    abrir: async (url) => {
      de1 = params(url);
      assert.equal(de1.get('prompt'), 'none');
      const r = await volta(url, { error: 'consent_required', state: de1.get('state') });
      assert.equal(r.status, 302);
      de2 = params(r.headers.get('location'));
      assert.equal(de2.get('prompt'), null);
      assert.equal(de2.get('state'), de1.get('state'));
      assert.equal(de2.get('code_challenge'), de1.get('code_challenge'));
      const r2 = await volta(url, { code: 'abc', state: de1.get('state') });
      assert.match(await r2.text(), /Pronto/);
    },
  });
  const r = await l.entrar();
  s.fechar();
  assert.equal(r.ok, true);
});

test('consent_required duas vezes: erro, sem repetir para sempre', async () => {
  const s = await servidorFalso(ok);
  const l = criarLogin({
    servidor: s.url, clientId: 'cid', porta: 0,
    abrir: async (url) => {
      const st = params(url).get('state');
      await volta(url, { error: 'consent_required', state: st });
      const r = await volta(url, { error: 'consent_required', state: st });
      assert.equal(r.status, 200);
    },
  });
  const r = await l.entrar();
  s.fechar();
  assert.deepEqual(r, { ok: false, erro: 'discord_recusou' });
});

test('servidor recusa: a pagina do navegador nao diz pronto', async () => {
  const s = await servidorFalso(() => [401, { erro: 'discord_recusou' }]);
  let texto;
  const l = criarLogin({
    servidor: s.url, clientId: 'cid', porta: 0,
    abrir: async (url) => { texto = await (await volta(url, { code: 'abc', state: params(url).get('state') })).text(); },
  });
  const r = await l.entrar();
  s.fechar();
  assert.deepEqual(r, { ok: false, erro: 'discord_recusou' });
  assert.match(texto, /Não deu certo/);
});

test('fluxo feliz: URL do contrato, troca no servidor, porta fechada depois', async () => {
  const s = await servidorFalso(ok);
  let urlAbertas = [];
  let porta;
  const l = criarLogin({
    servidor: s.url + '/', clientId: 'cid', porta: 0,
    abrir: async (url) => {
      urlAbertas.push(url);
      porta = new URL(params(url).get('redirect_uri')).port;
      const r = await volta(url, { code: 'abc123', state: params(url).get('state') });
      assert.equal(r.status, 200);
      assert.match(await r.text(), /Pronto, pode voltar para o Junto\./);
    },
  });
  const r = await l.entrar();
  s.fechar();
  assert.deepEqual(r, { ok: true, token: 'tok_segredo_123', eu: { id: '1' } });
  const p = params(urlAbertas[0]);
  assert.match(urlAbertas[0], /^https:\/\/discord\.com\/oauth2\/authorize\?/);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('client_id'), 'cid');
  assert.equal(p.get('scope'), 'identify');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('prompt'), 'none');
  assert.match(p.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const pedido = s.vistos[0];
  assert.equal(pedido.url, '/entrar');
  assert.equal(pedido.corpo.code, 'abc123');
  assert.equal(pedido.corpo.redirectUri, p.get('redirect_uri'));
  assert.equal(desafioDe(pedido.corpo.verifier), p.get('code_challenge'));
  await assert.rejects(fetch(`http://127.0.0.1:${porta}/callback`), 'porta deve estar fechada');
  assert.equal(l.ativo(), false);
});

test('state diferente e ignorado, a tentativa continua', async () => {
  const s = await servidorFalso(ok);
  let statusRuim;
  const l = criarLogin({
    servidor: s.url, clientId: 'cid', porta: 0,
    abrir: async (url) => {
      statusRuim = (await volta(url, { code: 'falso', state: 'outro' })).status;
      await volta(url, { code: 'certo', state: params(url).get('state') });
    },
  });
  const r = await l.entrar();
  s.fechar();
  assert.equal(statusRuim, 400);
  assert.equal(r.ok, true);
  assert.equal(s.vistos.length, 1);
  assert.equal(s.vistos[0].corpo.code, 'certo');
});

test('error=access_denied vira cancelado sem chamar o servidor', async () => {
  const s = await servidorFalso(ok);
  const l = criarLogin({
    servidor: s.url, clientId: 'cid', porta: 0,
    abrir: (url) => volta(url, { error: 'access_denied', state: params(url).get('state') }),
  });
  const r = await l.entrar();
  s.fechar();
  assert.deepEqual(r, { ok: false, erro: 'cancelado' });
  assert.equal(s.vistos.length, 0);
});

test('cancelar encerra a tentativa e libera a porta', async () => {
  const l = criarLogin({ servidor: 'http://127.0.0.1:9', clientId: 'cid', porta: 0, abrir: () => {} });
  const p = l.entrar();
  assert.equal(l.ativo(), true);
  setTimeout(() => l.cancelar(), 30);
  assert.deepEqual(await p, { ok: false, erro: 'cancelado' });
  assert.equal(l.ativo(), false);
});

test('uma tentativa por vez: segundo entrar devolve a mesma', async () => {
  const l = criarLogin({ servidor: 'http://127.0.0.1:9', clientId: 'cid', porta: 0, abrir: () => {} });
  const a = l.entrar();
  const b = l.entrar();
  assert.equal(a, b);
  l.cancelar();
  await a;
});

test('porta ocupada', async () => {
  const ocupa = net.createServer();
  await new Promise((r) => ocupa.listen(0, '127.0.0.1', r));
  const l = criarLogin({ servidor: 'http://127.0.0.1:9', clientId: 'cid', porta: ocupa.address().port, abrir: () => {} });
  const r = await l.entrar();
  ocupa.close();
  assert.deepEqual(r, { ok: false, erro: 'porta_ocupada' });
});

test('tempo esgotado', async () => {
  const l = criarLogin({ servidor: 'http://127.0.0.1:9', clientId: 'cid', porta: 0, timeoutMs: 60, abrir: () => {} });
  assert.deepEqual(await l.entrar(), { ok: false, erro: 'tempo_esgotado' });
  assert.equal(l.ativo(), false);
});

test('sem configuracao', async () => {
  assert.deepEqual(await criarLogin({ servidor: '', clientId: 'x', abrir: () => {} }).entrar(), { ok: false, erro: 'sem_config' });
  assert.deepEqual(await criarLogin({ servidor: 'http://x', clientId: '', abrir: () => {} }).entrar(), { ok: false, erro: 'sem_config' });
});

test('erros do servidor: 401 recusou, 502 fora', async () => {
  for (const [status, erro] of [[401, 'discord_recusou'], [502, 'discord_fora']]) {
    const s = await servidorFalso(() => [status, { erro: 'x' }]);
    const l = criarLogin({
      servidor: s.url, clientId: 'cid', porta: 0,
      abrir: (url) => volta(url, { code: 'c', state: params(url).get('state') }),
    });
    const r = await l.entrar();
    s.fechar();
    assert.deepEqual(r, { ok: false, erro });
  }
});

test('servidor fora do ar vira discord_fora', async () => {
  const l = criarLogin({
    servidor: 'http://127.0.0.1:9', clientId: 'cid', porta: 0,
    abrir: (url) => volta(url, { code: 'c', state: params(url).get('state') }),
  });
  assert.deepEqual(await l.entrar(), { ok: false, erro: 'discord_fora' });
});

test('porta padrao do contrato', () => assert.equal(PORTA, 53682));
