'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarMidia, execPadrao, hostBloqueado } = require('../midia');

process.env.JUNTO_YTDLP = 'fake';
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'junto-m-'));
const INFO = {
  title: 'T', uploader: 'U', channel: 'C', duration: 42,
  formats: [
    { url: 'a-low', acodec: 'mp4a.40.5', vcodec: 'none', ext: 'm4a', abr: 48 },
    { url: 'a-hi', acodec: 'opus', vcodec: 'none', ext: 'webm', abr: 130 },
    { url: 'a-flac', acodec: 'flac', vcodec: 'none', ext: 'flac', abr: 900 },
    { url: 'v-1080', acodec: 'none', vcodec: 'avc1.64', ext: 'mp4', height: 1080, tbr: 3000 },
    { url: 'v-720', acodec: 'none', vcodec: 'vp9', ext: 'webm', height: 720, tbr: 1500 },
    { url: 'v-av1', acodec: 'none', vcodec: 'av01', ext: 'mp4', height: 480, tbr: 900 },
  ],
};
const ok = (info) => ({ code: 0, out: JSON.stringify(info), err: '' });
const mk = (exec, dados = pasta()) => ({ dados, m: criarMidia({ dados, recursos: dados, exec, dev: true }) });

test('midia: ouvir escolhe melhor audio m4a/opus; ver video<=720 + audio', async () => {
  const { m } = mk(async () => ok(INFO));
  const o = await m.resolver('https://x.com/v', 'ouvir');
  assert.deepEqual(o, { ok: true, titulo: 'T', sub: 'U', dur: 42, audio: 'a-hi' });
  const v = await m.resolver('https://x.com/v', 'ver');
  assert.equal(v.video, 'v-720');
  assert.equal(v.audio, 'a-hi');
});

test('midia: ver prefere mp4 progressivo <=720; sub e dur com fallback', async () => {
  const info = { title: 'T', channel: 'C', formats: [...INFO.formats, { url: 'p-360', acodec: 'mp4a', vcodec: 'avc1', ext: 'mp4', height: 360 }, { url: 'p-720', acodec: 'mp4a', vcodec: 'avc1', ext: 'mp4', height: 720 }] };
  const { m } = mk(async () => ok(info));
  const v = await m.resolver('https://x.com/v', 'ver');
  assert.equal(v.video, 'p-720'); assert.equal(v.audio, 'p-720');
  assert.equal(v.sub, 'C'); assert.equal(v.dur, null);
});

test('midia: classifica permissao sem atualizar', async () => {
  for (const err of ['ERROR: Private video', 'members-only content', 'Sign in to confirm your age', 'not available in your country', 'login required']) {
    const calls = [];
    const { m } = mk(async (e, a) => { calls.push(a); return { code: 1, out: '', err }; });
    assert.deepEqual(await m.resolver('https://x.com/v', 'ouvir'), { ok: false, erro: 'sem_permissao' });
    assert.equal(calls.length, 1);
  }
});

test('midia: erro generico atualiza 1x por dia e tenta de novo', async () => {
  const calls = [];
  const dados = pasta();
  const { m } = mk(async (e, a) => { calls.push(a[0]); return { code: 1, out: '', err: 'boom' }; }, dados);
  assert.deepEqual(await m.resolver('https://x.com/v', 'ouvir'), { ok: false, erro: 'falhou' });
  assert.deepEqual(calls, ['-J', '-U', '-J']);
  calls.length = 0;
  await m.resolver('https://x.com/v', 'ouvir');
  assert.deepEqual(calls, ['-J', '-J']); // no second update within 24 h
  fs.writeFileSync(path.join(dados, 'ferramentas', 'yt-dlp-atualizado.txt'), String(Date.now() - 25 * 3600 * 1000));
  calls.length = 0;
  await m.resolver('https://x.com/v', 'ouvir');
  assert.deepEqual(calls, ['-J', '-U', '-J']);
});

test('midia: retry apos update pode funcionar', async () => {
  let n = 0;
  const { m } = mk(async (e, a) => (a[0] === '-J' && n++ === 0 ? { code: 1, out: '', err: 'x' } : a[0] === '-U' ? { code: 0, out: '', err: '' } : ok(INFO)));
  assert.equal((await m.resolver('https://x.com/v', 'ouvir')).ok, true);
});

test('midia: url invalida nao executa nada; args sem shell com --', async () => {
  const calls = [];
  const { m } = mk(async (e, a) => { calls.push(a); return ok(INFO); });
  for (const u of ['file:///c:/x', 'javascript:1', '', null, 'https://x.com/' + 'a'.repeat(2050), 'https://x.com/a b'])
    assert.deepEqual(await m.resolver(u, 'ouvir'), { ok: false, erro: 'falhou' });
  assert.equal(calls.length, 0);
  await m.resolver('https://x.com/v?a=1&b=2', 'ouvir');
  assert.deepEqual(calls[0].slice(-2), ['--', 'https://x.com/v?a=1&b=2']);
  assert.ok(calls[0].includes('--no-playlist'));
});

test('midia: execPadrao mata processo no timeout', async () => {
  const t0 = Date.now();
  const r = await execPadrao(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { timeout: 300 });
  assert.equal(r.timeout, true);
  assert.ok(Date.now() - t0 < 5000);
});

test('midia: filtro de host bloqueia local/privado, so literal', async () => {
  for (const h of ['localhost', 'a.localhost', 'x.local', '127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '0.0.0.0', '[::1]', '[fc00::1]', '[fd12::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '2130706433'])
    assert.equal(hostBloqueado('http://' + h + '/v'), true, h);
  for (const h of ['x.com', 'fake.test', '172.32.0.1', '172.15.0.1', '192.169.0.1', '8.8.8.8', '[2001:db8::1]'])
    assert.equal(hostBloqueado('https://' + h + '/v'), false, h);
  assert.equal(hostBloqueado('http://127.0.0.1:9/v', true), false);
  assert.equal(hostBloqueado('http://127.0.0.2/v', true), true);
  assert.equal(hostBloqueado('http://10.0.0.1/v', true), true);
  const calls = [];
  const { m } = mk(async (e, a) => { calls.push(a); return ok(INFO); });
  assert.deepEqual(await m.resolver('http://192.168.0.1/v', 'ouvir'), { ok: false, erro: 'falhou' });
  assert.deepEqual(await m.resolver('http://127.0.0.1:8080/v', 'ouvir'), { ok: false, erro: 'falhou' });
  assert.equal(calls.length, 0);
});

test('midia: execPadrao mata processo com saida acima de 20 MB', async () => {
  const r = await execPadrao(process.execPath, ['-e', "const b='x'.repeat(1<<20);const t=setInterval(()=>process.stdout.write(b),1);setTimeout(()=>clearInterval(t),60000)"], { timeout: 20000 });
  assert.equal(r.grande, true);
  assert.equal(r.timeout, false);
});

test('midia: novo resolver na mesma chave mata o anterior; cancelarTudo mata todos', async () => {
  const mortos = [];
  const exec = (e, a, o) => new Promise((res) => {
    const p = { kill: () => { mortos.push(a[a.length - 1]); res({ code: -1, out: '', err: '' }); } };
    o.aoSpawn(p);
  });
  const { m } = mk(exec);
  const r1 = m.resolver('https://x.com/1', 'ouvir', 'j:item');
  const r2 = m.resolver('https://x.com/2', 'ouvir', 'j:item');
  assert.deepEqual(await r1, { ok: false, erro: 'falhou' });
  assert.deepEqual(mortos, ['https://x.com/1']);
  const r3 = m.resolver('https://x.com/3', 'ouvir', 'j:add');
  m.cancelarTudo();
  await r2; await r3;
  assert.deepEqual(mortos.sort(), ['https://x.com/1', 'https://x.com/2', 'https://x.com/3']);
});

// bundled yt-dlp vs the copy in dados\ferramentas (dev:false: JUNTO_YTDLP is ignored)
function copiaSetup(verCopia, verEmb) {
  const dados = pasta(), rec = pasta();
  fs.mkdirSync(path.join(dados, 'ferramentas'));
  const alvo = path.join(dados, 'ferramentas', 'yt-dlp.exe'), orig = path.join(rec, 'yt-dlp.exe');
  fs.writeFileSync(orig, 'EMB'); if (verCopia) fs.writeFileSync(alvo, 'COPIA');
  const calls = [];
  const exec = async (exe, a) => {
    calls.push(a[0] === '--version' ? 'v:' + path.basename(path.dirname(exe)) : a[0]);
    if (a[0] === '--version') { const v = exe === orig ? verEmb : verCopia; return v ? { code: 0, out: v + '\n', err: '' } : { code: 1, out: '', err: 'x' }; }
    return ok(INFO);
  };
  const novo = () => criarMidia({ dados, recursos: rec, exec, dev: false });
  return { dados, alvo, calls, novo };
}

test('midia: embutido mais novo substitui a copia; marca impede nova checagem', async () => {
  const s = copiaSetup('2025.01.09', '2025.01.10');
  await s.novo().resolver('https://x.com/v', 'ouvir');
  assert.equal(fs.readFileSync(s.alvo, 'utf8'), 'EMB');
  assert.equal(s.calls.filter(c => c.startsWith('v:')).length, 2);
  s.calls.length = 0;
  await s.novo().resolver('https://x.com/v', 'ouvir'); // same marker: no version run
  assert.deepEqual(s.calls, ['-J']);
});

test('midia: comparacao numerica por partes (2025.1.10 > 2025.1.9; .N conta)', async () => {
  for (const [c, e, troca] of [['2025.01.09', '2025.01.10.1', true], ['2025.01.10', '2025.01.10.1', true], ['2025.01.10.1', '2025.01.10', false], ['2024.12.31', '2025.01.01', true]]) {
    const s = copiaSetup(c, e);
    await s.novo().resolver('https://x.com/v', 'ouvir');
    assert.equal(fs.readFileSync(s.alvo, 'utf8'), troca ? 'EMB' : 'COPIA', c + ' vs ' + e);
  }
});

test('midia: embutido mais velho mantem a copia (e grava a marca)', async () => {
  const s = copiaSetup('2025.06.01', '2025.01.10');
  await s.novo().resolver('https://x.com/v', 'ouvir');
  assert.equal(fs.readFileSync(s.alvo, 'utf8'), 'COPIA');
  s.calls.length = 0;
  await s.novo().resolver('https://x.com/v', 'ouvir');
  assert.deepEqual(s.calls, ['-J']);
});

test('midia: copia ausente ou sem --version e copiada', async () => {
  const a = copiaSetup(null, '2025.01.10');
  await a.novo().resolver('https://x.com/v', 'ouvir');
  assert.equal(fs.readFileSync(a.alvo, 'utf8'), 'EMB');
  assert.deepEqual(a.calls, ['-J']); // missing: copied without a version run
  const b = copiaSetup('2025.01.10', '2025.01.10');
  const exec = async (exe, x) => (x[0] === '--version' ? (exe === b.alvo ? { code: 1, out: '', err: 'x' } : { code: 0, out: '2020.01.01', err: '' }) : ok(INFO));
  const rec2 = pasta(); fs.writeFileSync(path.join(rec2, 'yt-dlp.exe'), 'EMB');
  await criarMidia({ dados: b.dados, recursos: rec2, exec, dev: false }).resolver('https://x.com/v', 'ouvir');
  assert.equal(fs.readFileSync(b.alvo, 'utf8'), 'EMB');
});
