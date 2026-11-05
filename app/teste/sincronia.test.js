const test = require('node:test');
const assert = require('node:assert');
const { criarRelogio, Relogio, posicaoAgora, criarSincronizador } = require('../tela/sincronia.js');

function elFalso() {
  const e = { currentTime: 0, paused: true, playbackRate: 1, readyState: 4, plays: 0, pauses: 0,
    play() { e.plays++; e.paused = false; return Promise.reject(new Error('x')); },
    pause() { e.pauses++; e.paused = true; } };
  return e;
}

test('relogio usa menor RTT das últimas 8', () => {
  const r = criarRelogio(() => 1000);
  r.amostra(0, 600, 100);   // rtt100 off 550
  r.amostra(0, 530, 20);    // rtt20 off 520
  r.amostra(0, 700, 200);
  assert.strictEqual(r.offset, 520);
  assert.strictEqual(r.agora(), 1520);
  for (let i = 0; i < 8; i++) r.amostra(0, 900, 300); // empurra a melhor para fora
  assert.strictEqual(r.offset, 750);
  assert.ok(typeof Relogio.agora() === 'number');
});

test('posicaoAgora', () => {
  assert.strictEqual(posicaoAgora({ tocando: true, pos: 10, base: 1000 }, 3000), 12);
  assert.strictEqual(posicaoAgora({ tocando: false, pos: 10, base: 1000 }, 3000), 10);
  assert.strictEqual(posicaoAgora({ tocando: true, pos: 0, base: 1000 }, 500), -0.5);
});

test('passo: regras', () => {
  let t = 10000; const e = elFalso();
  const s = criarSincronizador(e, { agora: () => t });
  s.definir({ item: 'a', tocando: true, pos: 0, base: 11000 }, 100);
  e.currentTime = 5; s.passo();
  assert.ok(e.paused && e.currentTime === 0, 'espera em 0');
  t = 21000; e.currentTime = 0; s.passo(); // alvo 10
  assert.strictEqual(e.currentTime, 10.15);
  assert.strictEqual(e.plays, 1);
  e.currentTime = 10.3; e.paused = false; s.passo();
  assert.ok(Math.abs(e.playbackRate - 0.9) < 1e-9);
  e.currentTime = 9.9; s.passo();
  assert.ok(Math.abs(e.playbackRate - 1.1) < 1e-9);
  e.currentTime = 10.01; s.passo();
  assert.strictEqual(e.playbackRate, 1);
  s.definir({ item: 'a', tocando: false, pos: 20, base: 0 }, 100);
  e.paused = false; e.currentTime = 3; s.passo();
  assert.ok(e.paused); assert.strictEqual(e.currentTime, 20);
});

test('simulação: dois elementos com atrasos de carga convergem', () => {
  let t = 0;
  const mk = (atraso) => {
    const e = elFalso();
    e.play = () => { e.paused = false; return Promise.resolve(); };
    e.carregaEm = atraso;
    return e;
  };
  const a = mk(1000), b = mk(3500);
  const sa = criarSincronizador(a, { agora: () => t + 5 });
  const sb = criarSincronizador(b, { agora: () => t - 3 });
  const P = { item: 'x', tocando: true, pos: 0, base: 2500 };
  sa.definir(P, 600); sb.definir(P, 600);
  for (t = 0; t <= 10000; t += 50) {
    for (const [e, s] of [[a, sa], [b, sb]]) {
      if (t % 250 === 0) s.passo();
      if (!e.paused && t >= e.carregaEm) e.currentTime += e.playbackRate * 0.05;
    }
  }
  assert.ok(Math.abs(a.currentTime - b.currentTime) < 0.1, `diff ${a.currentTime - b.currentTime}`);
});
