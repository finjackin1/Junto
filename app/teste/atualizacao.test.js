'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const A = require('../atualizacao');

const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'junto-teste-atu-'));
const limpar = (d) => fs.rmSync(d, { recursive: true, force: true });

// builds Junto-<v>-windows.zip with top folder Junto\ (Junto.exe + resources\x.txt); returns {zip, sha, tam}
function fazerZip(base, versao) {
  const raiz = path.join(base, 'zipraiz', 'Junto');
  fs.mkdirSync(path.join(raiz, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'Junto.exe'), 'exe-' + versao);
  fs.writeFileSync(path.join(raiz, 'resources', 'x.txt'), 'novo-' + versao);
  const zip = path.join(base, `Junto-${versao}-windows.zip`);
  cp.execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', path.join(base, 'zipraiz'), 'Junto'], { windowsHide: true });
  const buf = fs.readFileSync(zip);
  return { zip, sha: crypto.createHash('sha256').update(buf).digest('hex'), tam: buf.length };
}
function fazerJson(base, versao, z, extra = {}) {
  const f = path.join(base, 'releases.json');
  fs.writeFileSync(f, JSON.stringify({
    tag_name: 'v' + versao,
    assets: [{ name: path.basename(z.zip), browser_download_url: pathToFileURL(z.zip).href, size: z.tam, digest: 'sha256:' + z.sha, ...extra }],
  }));
  return pathToFileURL(f).href;
}

test('maisNova compares numerically', () => {
  assert.equal(A.maisNova('0.2.0', '0.1.0'), true);
  assert.equal(A.maisNova('v1.2.10', '1.2.9'), true);
  assert.equal(A.maisNova('0.1.0', '0.1.0'), false);
  assert.equal(A.maisNova('0.1.0', '0.1.1'), false);
  assert.equal(A.maisNova('1.0', '1.0.0'), false);
});

test('asset name pattern and ultima() picks the right asset', async () => {
  assert.ok(A.ASSET.test('Junto-0.2.0-windows.zip'));
  assert.ok(!A.ASSET.test('Junto-0.2.0.zip'));
  assert.ok(!A.ASSET.test('Source code.zip'));
  const d = tmp();
  try {
    const f = path.join(d, 'r.json');
    fs.writeFileSync(f, JSON.stringify({
      tag_name: 'v0.3.0',
      assets: [
        { name: 'notas.txt', browser_download_url: 'x', size: 1 },
        { name: 'Junto-0.3.0-windows.zip', browser_download_url: 'https://e/z.zip', size: 42, digest: 'sha256:ABCD' },
      ],
    }));
    const { info, erro } = await A.ultima(f);
    assert.equal(erro, '');
    assert.equal(info.versao, '0.3.0');
    assert.equal(info.nome, 'Junto-0.3.0-windows.zip');
    assert.equal(info.tamanho, 42);
    assert.equal(info.sha256, 'abcd');
    fs.writeFileSync(f, JSON.stringify({ tag_name: 'v0.3.0', assets: [{ name: 'a.txt' }] }));
    const r = await A.ultima(f);
    assert.equal(r.info, null);
    assert.match(r.erro, /zip/);
    assert.equal((await A.ultima(path.join(d, 'nao-existe.json'))).info, null);
  } finally { limpar(d); }
});

test('baixar rejects sha256 and size mismatch and leaves no file', async () => {
  const d = tmp();
  try {
    const z = fazerZip(d, '0.2.0');
    const base = { nome: path.basename(z.zip), url: pathToFileURL(z.zip).href };
    const pasta = path.join(d, 'baixa');
    const r1 = await A.baixar({ ...base, tamanho: z.tam, sha256: 'f'.repeat(64) }, pasta);
    assert.equal(r1.arq, null);
    assert.match(r1.erro, /sha256/);
    const r2 = await A.baixar({ ...base, tamanho: z.tam + 1, sha256: z.sha }, pasta);
    assert.equal(r2.arq, null);
    assert.match(r2.erro, /incompleto/);
    assert.deepEqual(fs.readdirSync(pasta), []);
    const r3 = await A.baixar({ ...base, tamanho: z.tam, sha256: z.sha }, pasta);
    assert.ok(r3.arq && fs.existsSync(r3.arq));
  } finally { limpar(d); }
});

test('procurar: fake releases JSON -> download + extract gives folder with Junto.exe', async () => {
  const d = tmp();
  try {
    const z = fazerZip(d, '0.2.0');
    const url = fazerJson(d, '0.2.0', z);
    const pasta = path.join(d, 'atu');
    const r = await A.procurar({ atual: '0.1.0', pasta, url });
    assert.equal(r.estado, 'pronta', r.erro);
    assert.equal(r.versao, '0.2.0');
    assert.equal(fs.readFileSync(path.join(r.novo, 'Junto.exe'), 'utf8'), 'exe-0.2.0');
    assert.equal(fs.readFileSync(path.join(r.novo, 'resources', 'x.txt'), 'utf8'), 'novo-0.2.0');
    assert.ok(!fs.existsSync(path.join(pasta, 'extraido')));
    // second call reuses the pending copy
    assert.equal((await A.procurar({ atual: '0.1.0', pasta, url })).estado, 'ja-pronta');
    // up to date
    assert.equal((await A.procurar({ atual: '0.2.0', pasta, url })).estado, 'em-dia');
  } finally { limpar(d); }
});

test('procurar: bad sha in release -> erro, nothing pending', async () => {
  const d = tmp();
  try {
    const z = fazerZip(d, '0.2.0');
    const url = fazerJson(d, '0.2.0', { ...z, sha: '0'.repeat(64) });
    const pasta = path.join(d, 'atu');
    const r = await A.procurar({ atual: '0.1.0', pasta, url });
    assert.equal(r.estado, 'erro');
    assert.ok(!fs.existsSync(path.join(pasta, 'pendente')));
  } finally { limpar(d); }
});

test('extrair refuses a zip without Junto.exe', () => {
  const d = tmp();
  try {
    fs.mkdirSync(path.join(d, 'z', 'Junto'), { recursive: true });
    fs.writeFileSync(path.join(d, 'z', 'Junto', 'a.txt'), 'x');
    const zip = path.join(d, 'sem.zip');
    cp.execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', path.join(d, 'z'), 'Junto'], { windowsHide: true });
    const r = A.extrair(zip, path.join(d, 'atu'), path.join(d, 'atu', 'pendente'));
    assert.equal(r.ok, false);
    assert.match(r.erro, /Junto\.exe/);
  } finally { limpar(d); }
});

test('pastaProgramaOk: needs Junto.exe, no drive root, no node_modules', () => {
  const d = tmp();
  try {
    assert.equal(A.pastaProgramaOk(d), false); // no exe
    fs.writeFileSync(path.join(d, 'Junto.exe'), 'x');
    assert.equal(A.pastaProgramaOk(d), true);
    const nm = path.join(d, 'node_modules', 'electron', 'dist');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'Junto.exe'), 'x');
    assert.equal(A.pastaProgramaOk(nm), false);
    assert.equal(A.pastaProgramaOk(path.parse(d).root), false);
    assert.equal(A.pastaProgramaOk(''), false);
  } finally { limpar(d); }
});

test('textoHelper has the paths and PID; rejects bad pid', () => {
  const t = A.textoHelper({ pid: 4321, novo: 'C:\\t\\novo', destino: 'C:\\P\\Junto', pasta: 'C:\\t' });
  assert.match(t, /PID eq 4321/);
  assert.match(t, /set "NOVO=C:\\t\\novo"/);
  assert.match(t, /set "DESTINO=C:\\P\\Junto"/);
  assert.match(t, /robocopy "%NOVO%" "%DESTINO%" \/MIR \/R:2 \/W:1/);
  assert.match(t, /Junto\.exe"/);
  assert.throws(() => A.textoHelper({ pid: '1 & calc', novo: 'a', destino: 'b', pasta: 'c' }));
  assert.doesNotMatch(t, /errorlevel 8/); // relaunch even if the copy failed
  const min = A.textoHelper({ pid: 1, novo: 'a', destino: 'b', pasta: 'c', abrir: 'min' });
  assert.match(min, /Junto\.exe" --minimizado/);
  const nao = A.textoHelper({ pid: 1, novo: 'a', destino: 'b', pasta: 'c', abrir: 'nao' });
  assert.doesNotMatch(nao, /start ""/);
});

test('helper script really mirrors novo -> destino between temp folders and cleans up', async () => {
  const d = tmp();
  try {
    const novo = path.join(d, 'atu', 'pendente'), dest = path.join(d, 'prog');
    fs.mkdirSync(path.join(novo, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(novo, 'resources', 'x.txt'), 'novo');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'velho.txt'), 'velho');
    // a no-op "Junto.exe" is NOT created in novo, so the relaunch step starts nothing harmful (start of a missing file just fails)
    const morto = cp.spawnSync(process.execPath, ['-e', '0']); // a pid that is gone
    const cmd = path.join(d, 'atu', 'aplicar.cmd');
    fs.writeFileSync(cmd, A.textoHelper({ pid: morto.pid || 99999999, novo, destino: dest, pasta: path.join(d, 'atu') }), 'latin1');
    cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', cmd], { windowsHide: true, timeout: 60000 });
    assert.equal(fs.readFileSync(path.join(dest, 'resources', 'x.txt'), 'utf8'), 'novo');
    assert.ok(!fs.existsSync(path.join(dest, 'velho.txt')));
    assert.ok(!fs.existsSync(novo));
  } finally { limpar(d); }
});

test('controller: applies right away outside a session, waits inside one, applies on quit', async () => {
  const d = tmp();
  try {
    const z = fazerZip(d, '0.2.0');
    const url = fazerJson(d, '0.2.0', z);
    const prog = path.join(d, 'prog');
    fs.mkdirSync(prog);
    fs.writeFileSync(path.join(prog, 'Junto.exe'), 'x');
    const mk = (emSessao) => {
      const ev = { lancar: 0, sair: 0, args: null };
      const c = A.criarAtualizacao({
        atual: '0.1.0', ativo: true, url, exe: path.join(prog, 'Junto.exe'), tmp: path.join(d, 't'), pid: 1234,
        emSessao: () => emSessao.v, sair: () => { ev.sair++; },
        lancar: (a) => { ev.lancar++; ev.args = a; },
      });
      return { c, ev };
    };
    // in session: pending, nothing launched; then quit applies
    const s1 = { v: true };
    const a = mk(s1);
    await a.c.verificar();
    assert.equal(a.c.pendente(), '0.2.0');
    assert.equal(a.ev.lancar, 0);
    a.c.aoSair();
    assert.equal(a.ev.lancar, 1);
    assert.equal(a.ev.args.pid, 1234);
    assert.equal(a.ev.args.destino, prog);
    assert.equal(a.ev.args.abrir, 'nao'); // user quit: stays closed after installing
    a.c.aoSair();
    assert.equal(a.ev.lancar, 1); // once only
    // out of session: applied and quit requested
    const b = mk({ v: false });
    await b.c.verificar();
    assert.equal(b.ev.lancar, 1);
    assert.equal(b.ev.sair, 1);
    assert.equal(b.ev.args.abrir, 'normal');
    // inactive: nothing
    const off = A.criarAtualizacao({ atual: '0.1.0', ativo: false, url, emSessao: () => false, sair() { }, lancar() { throw new Error('no'); } });
    assert.equal(await off.verificar(), null);
    // wrong program folder (no Junto.exe) refuses
    const ev = { lancar: 0 };
    const e = A.criarAtualizacao({ atual: '0.1.0', ativo: true, url, exe: path.join(d, 'vazio', 'Junto.exe'), tmp: path.join(d, 't2'), emSessao: () => false, sair() { }, lancar: () => { ev.lancar++; } });
    await e.verificar();
    assert.equal(ev.lancar, 0);
  } finally { limpar(d); }
});
