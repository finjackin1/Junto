'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarOpcoes, PADRAO } = require('../opcoes');
const { criarLog } = require('../log');
const { criarSessao } = require('../sessao');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'junto-t-'));
// Fake safeStorage: reversible, clearly not the token in clear text.
const cofre = (disponivel = true) => ({
  isEncryptionAvailable: () => disponivel,
  encryptString: (t) => Buffer.from('X' + Buffer.from(t).toString('hex')),
  decryptString: (b) => Buffer.from(b.toString().slice(1), 'hex').toString(),
});

test('opcoes: padroes, salvar parcial, ignora lixo, persiste', async () => {
  const dir = pasta();
  const o = criarOpcoes({ dir });
  assert.deepEqual(o.ler(), PADRAO);
  assert.deepEqual(PADRAO, { win: false, rap: true, min: false, av: true });
  await o.salvar({ min: true, win: 'sim', outra: 1 });
  assert.deepEqual(criarOpcoes({ dir }).ler(), { win: false, rap: true, min: true, av: true });
  assert.deepEqual(fs.readdirSync(dir), ['opcoes.json']); // no leftover tmp file
  fs.writeFileSync(path.join(dir, 'opcoes.json'), '{quebrado');
  assert.deepEqual(criarOpcoes({ dir }).ler(), PADRAO);
});

test('log: grava, mascara codigo/token e gira em 1 MB', () => {
  const dir = pasta();
  const log = criarLog({ dir, maxBytes: 300 });
  log('code=abcdefgh12345 token: ABCDEFGHIJKL e ' + 'a'.repeat(40));
  const txt = fs.readFileSync(log.arquivo, 'utf8');
  assert.ok(!/abcdefgh12345|ABCDEFGHIJKL|a{40}/.test(txt));
  for (let i = 0; i < 20; i++) log('linha numero ' + i);
  assert.ok(fs.existsSync(log.arquivo + '.1'));
  assert.ok(fs.statSync(log.arquivo).size < 600);
});

test('sessao: cifra em disco, recarrega, apaga', async () => {
  const dir = pasta();
  const s = criarSessao({ dir, safeStorage: cofre() });
  assert.equal(s.carregar(), null);
  await s.salvar('segredo-do-token');
  assert.ok(!fs.readFileSync(s.arquivo).includes('segredo-do-token'));
  assert.equal(criarSessao({ dir, safeStorage: cofre() }).carregar(), 'segredo-do-token');
  s.apagar();
  assert.equal(fs.existsSync(s.arquivo), false);
  assert.equal(criarSessao({ dir, safeStorage: cofre() }).carregar(), null);
});

test('sessao: sem criptografia fica so em memoria e registra no log', async () => {
  const dir = pasta();
  const linhas = [];
  const s = criarSessao({ dir, safeStorage: cofre(false), log: (m) => linhas.push(m) });
  await s.salvar('tok');
  assert.equal(s.token(), 'tok');
  assert.equal(fs.existsSync(s.arquivo), false);
  assert.ok(linhas.length > 0 && linhas.every((l) => !l.includes('tok-')));
  assert.equal(criarSessao({ dir, safeStorage: cofre(false) }).carregar(), null);
});

test('sessao: arquivo corrompido e ignorado', () => {
  const dir = pasta();
  fs.writeFileSync(path.join(dir, 'sessao.bin'), 'lixo');
  const s = criarSessao({ dir, safeStorage: { isEncryptionAvailable: () => true, decryptString: () => { throw new Error('x'); } } });
  assert.equal(s.carregar(), null);
});

test('sessao.sair: POST /sair com Bearer e apaga o arquivo mesmo se o servidor falhar', async () => {
  const dir = pasta();
  const chamadas = [];
  const s = criarSessao({
    dir, safeStorage: cofre(), servidor: () => 'http://srv/',
    fetchFn: async (url, op) => { chamadas.push([url, op.method, op.headers.authorization]); throw new Error('fora'); },
  });
  await s.salvar('tok123');
  await s.sair();
  assert.deepEqual(chamadas, [['http://srv/sair', 'POST', 'Bearer tok123']]);
  assert.equal(fs.existsSync(s.arquivo), false);
  assert.equal(s.token(), null);
});
