'use strict';
// Silent auto-update from GitHub releases (adapted from FCC abas\atualizacao.js).
// 1. releases/latest of REPO; asset Junto-<ver>-windows.zip (top folder Junto\ holding Junto.exe); compare tag with package.json.
// 2. download to <tmp>\junto-atualizacao, check size + sha256 (GitHub "digest"), extract with Windows tar.exe, find the folder with Junto.exe.
// 3. apply: a .cmd helper (detached, hidden) waits for this PID to exit, robocopy /MIR new -> program folder, relaunches, cleans up.
// JUNTO_TESTE_ATUALIZACAO = path/file:// URL of a fake releases JSON (test bench only, publishes nothing).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const https = require('node:https');
const { fileURLToPath } = require('node:url');

const REPO = 'finjackin1/Junto';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const ASSET = /^Junto-v?\d[\w.]*-windows\.zip$/i;
const ESPERA = 20000;
const PRIMEIRA = 15000;
const INTERVALO = 6 * 3600 * 1000;
const SYS = process.env.SystemRoot || 'C:\\Windows';
const TAR = path.join(SYS, 'System32', 'tar.exe'); // Windows bsdtar (opens zip); a Git tar first in PATH would not

// "1.2.10" > "1.2.9"; non-numeric parts count as 0
function maisNova(a, b) {
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
const ehArquivo = (u) => /^file:/i.test(u) || /^[a-z]:[\\/]/i.test(u);
const caminhoDe = (u) => (/^file:/i.test(u) ? fileURLToPath(u) : u);
const apagar = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };

// GET with redirects (GitHub asset URL redirects to objects.githubusercontent.com); returns the response stream
function pedir(url, n = 0) {
  return new Promise((ok, falha) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Junto', Accept: 'application/vnd.github+json' }, timeout: ESPERA }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n < 5) {
        res.resume();
        return pedir(new URL(res.headers.location, url).href, n + 1).then(ok, falha);
      }
      if (res.statusCode !== 200) { res.resume(); return falha(new Error('HTTP ' + res.statusCode)); }
      ok(res);
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', falha);
  });
}
async function lerJson(url) {
  if (ehArquivo(url)) return JSON.parse(fs.readFileSync(caminhoDe(url), 'utf8'));
  const res = await pedir(url);
  let t = '';
  res.setEncoding('utf8');
  for await (const p of res) t += p;
  return JSON.parse(t);
}

// {info, erro}: info = versao, nome, url, tamanho, sha256
async function ultima(url = process.env.JUNTO_TESTE_ATUALIZACAO || API) {
  let d;
  try { d = await lerJson(url); } catch (e) { return { info: null, erro: 'sem resposta do GitHub (' + e.message + ')' }; }
  const tag = String((d && d.tag_name) || '');
  const a = ((d && d.assets) || []).find((x) => ASSET.test(String(x.name || '')));
  if (!a) return { info: null, erro: `a versao ${tag || '?'} nao tem o zip do programa` };
  const dg = String(a.digest || '');
  return { info: { versao: tag.replace(/^v/i, ''), nome: String(a.name), url: a.browser_download_url, tamanho: +a.size || 0, sha256: dg.startsWith('sha256:') ? dg.slice(7).toLowerCase() : '' }, erro: '' };
}

// download + check; {arq, erro}
async function baixar(info, pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  const destino = path.join(pasta, path.basename(info.nome)), parcial = destino + '.parcial';
  const soma = crypto.createHash('sha256');
  let baixado = 0;
  try {
    const ent = ehArquivo(info.url) ? fs.createReadStream(caminhoDe(info.url)) : await pedir(info.url);
    const sai = fs.createWriteStream(parcial);
    for await (const p of ent) {
      soma.update(p); baixado += p.length;
      if (!sai.write(p)) await new Promise((r) => sai.once('drain', r));
    }
    await new Promise((r, f) => sai.end((e) => (e ? f(e) : r())));
  } catch (e) { apagar(parcial); return { arq: null, erro: 'download falhou (' + e.message + ')' }; }
  if (info.tamanho && baixado !== info.tamanho) { apagar(parcial); return { arq: null, erro: `arquivo incompleto (${baixado} de ${info.tamanho})` }; }
  if (info.sha256 && soma.digest('hex') !== info.sha256) { apagar(parcial); return { arq: null, erro: 'sha256 diferente do publicado' }; }
  try { apagar(destino); fs.renameSync(parcial, destino); } catch (e) { return { arq: null, erro: 'nao guardei o arquivo (' + e.message + ')' }; }
  return { arq: destino, erro: '' };
}

// folder holding Junto.exe: the root or one/two levels down
function acharPasta(raiz, nivel = 0) {
  if (fs.existsSync(path.join(raiz, 'Junto.exe'))) return raiz;
  if (nivel >= 2) return null;
  for (const e of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = acharPasta(path.join(raiz, e.name), nivel + 1);
    if (r) return r;
  }
  return null;
}

// zip -> pend (the folder with Junto.exe, moved). {ok, erro}
function extrair(zip, pasta, pend) {
  const tmp = path.join(pasta, 'extraido');
  apagar(tmp); fs.mkdirSync(tmp, { recursive: true });
  try { cp.execFileSync(TAR, ['-xf', zip, '-C', tmp], { windowsHide: true, stdio: 'ignore', timeout: 300000 }); } catch { apagar(tmp); return { ok: false, erro: 'nao abri o zip baixado' }; }
  const nova = acharPasta(tmp);
  if (!nova) { apagar(tmp); return { ok: false, erro: 'o zip nao tem o Junto.exe' }; }
  try { apagar(pend); fs.renameSync(nova, pend); } catch (e) { apagar(tmp); return { ok: false, erro: 'nao preparei a versao nova (' + e.message + ')' }; }
  apagar(tmp); apagar(zip);
  return { ok: true, erro: '' };
}

// whole flow. o = { atual, pasta, url? } -> { estado: 'em-dia'|'pronta'|'ja-pronta'|'erro', versao, novo, erro }
async function procurar(o) {
  const pend = path.join(o.pasta, 'pendente'), marca = path.join(o.pasta, 'versao-pendente.txt');
  const { info, erro } = await ultima(o.url);
  if (!info) return { estado: 'erro', versao: '', novo: '', erro };
  if (!maisNova(info.versao, o.atual)) return { estado: 'em-dia', versao: info.versao, novo: '', erro: '' };
  let v = '';
  try { v = fs.readFileSync(marca, 'utf8').trim(); } catch { /* none */ }
  if (v === info.versao && fs.existsSync(path.join(pend, 'Junto.exe'))) return { estado: 'ja-pronta', versao: v, novo: pend, erro: '' };
  apagar(pend); apagar(marca);
  const b = await baixar(info, o.pasta);
  if (!b.arq) return { estado: 'erro', versao: info.versao, novo: '', erro: b.erro };
  const x = extrair(b.arq, o.pasta, pend);
  if (!x.ok) return { estado: 'erro', versao: info.versao, novo: '', erro: x.erro };
  try { fs.writeFileSync(marca, info.versao, 'utf8'); } catch { /* marker only avoids a re-download */ }
  return { estado: 'pronta', versao: info.versao, novo: pend, erro: '' };
}

// program folder must hold Junto.exe, not be a drive root, not be inside node_modules (dev run)
function pastaProgramaOk(dir) {
  if (!dir) return false;
  const d = path.resolve(dir);
  if (path.parse(d).root.toLowerCase() === d.toLowerCase()) return false;
  if (d.split(path.sep).some((s) => s.toLowerCase() === 'node_modules')) return false;
  return fs.existsSync(path.join(d, 'Junto.exe'));
}

// .cmd text: wait for pid, mirror novo -> destino, relaunch, clean up.
// abrir: 'normal' | 'min' (relaunch in the tray) | 'nao' (user quit: stay closed). Relaunch happens even if the copy failed,
// so the user is never left without the program.
function textoHelper({ pid, novo, destino, pasta, abrir = 'normal' }) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) throw new Error('pid invalido');
  return [
    '@echo off',
    'setlocal',
    `set "NOVO=${novo}"`,
    `set "DESTINO=${destino}"`,
    `set "PASTA=${pasta}"`,
    'set /a T=0',
    ':espera',
    `tasklist /FI "PID eq ${n}" /FO CSV /NH 2>nul | find ",\\"${n}\\"," >nul`,
    'if errorlevel 1 goto copia',
    'set /a T+=1',
    'if %T% GEQ 120 goto fim',
    'ping -n 2 127.0.0.1 >nul',
    'goto espera',
    ':copia',
    'robocopy "%NOVO%" "%DESTINO%" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
    ...(abrir === 'nao' ? [] : ['if exist "%DESTINO%\\Junto.exe" start "" /D "%DESTINO%" "%DESTINO%\\Junto.exe"' + (abrir === 'min' ? ' --minimizado' : '')]),
    ':fim',
    'rd /s /q "%NOVO%" >nul 2>nul',
    'del /q "%PASTA%\\*.zip" >nul 2>nul',
    'del /q "%PASTA%\\versao-pendente.txt" >nul 2>nul',
    '(goto) 2>nul & del /q "%~f0"',
    '',
  ].join('\r\n');
}

// writes helper into pasta and spawns it detached + hidden; returns the .cmd path
function lancarHelper({ pid = process.pid, novo, destino, pasta, abrir }) {
  const cmd = path.join(pasta, 'aplicar.cmd');
  fs.writeFileSync(cmd, textoHelper({ pid, novo, destino, pasta, abrir }), 'latin1');
  const f = cp.spawn(process.env.ComSpec || path.join(SYS, 'System32', 'cmd.exe'), ['/c', cmd], { detached: true, windowsHide: true, stdio: 'ignore' });
  f.on('error', () => { /* helper failed to start: nothing to do */ });
  f.unref();
  return cmd;
}

// controller. o = { atual, log, emSessao(), sair(), ativo, minimizado()?, exe?, tmp?, url?, pid?, primeira?, intervalo?, lancar? }
function criarAtualizacao(o) {
  const log = o.log || (() => {});
  const exe = o.exe || process.execPath;
  const destino = path.dirname(exe);
  const pasta = path.join(o.tmp || os.tmpdir(), 'junto-atualizacao');
  const lancar = o.lancar || lancarHelper;
  let pronta = null, ocupado = false, aplicando = false, t1 = null, t2 = null;

  function aplicar(abrir) {
    if (aplicando || !pronta) return false;
    if (!pastaProgramaOk(destino)) { log('atualizacao: pasta do programa recusada', destino); return false; }
    aplicando = true;
    try { lancar({ pid: o.pid || process.pid, novo: pronta.novo, destino, pasta, abrir }); log('atualizacao: aplicando', pronta.versao); return true; } catch (e) { aplicando = false; log('atualizacao: helper falhou', e); return false; }
  }

  async function verificar() {
    if (ocupado || aplicando || !o.ativo) return null;
    ocupado = true;
    let r = null;
    try {
      if (!pronta) {
        r = await procurar({ atual: o.atual, pasta, url: o.url });
        if (r.estado === 'erro') log('atualizacao: pulou', r.erro);
        else if (r.estado === 'pronta' || r.estado === 'ja-pronta') { pronta = { versao: r.versao, novo: r.novo }; log('atualizacao: pronta', r.versao); }
      }
      // idle restart: comes back the way it was (in the tray if the window was hidden)
      if (pronta && !o.emSessao()) { if (aplicar(o.minimizado && o.minimizado() ? 'min' : 'normal')) o.sair(); }
    } catch (e) { log('atualizacao: erro', e); } finally { ocupado = false; }
    return r;
  }

  return {
    verificar,
    iniciar() {
      if (!o.ativo) return;
      t1 = setTimeout(() => { verificar(); t2 = setInterval(verificar, o.intervalo || INTERVALO); if (t2.unref) t2.unref(); }, o.primeira == null ? PRIMEIRA : o.primeira);
      if (t1.unref) t1.unref();
    },
    parar() { clearTimeout(t1); clearInterval(t2); },
    aoSair() { if (o.ativo && pronta && !aplicando) aplicar('nao'); }, // user quit with an update pending: install, stay closed
    pendente: () => (pronta ? pronta.versao : ''),
  };
}

module.exports = { REPO, API, ASSET, maisNova, ultima, baixar, extrair, procurar, pastaProgramaOk, textoHelper, lancarHelper, criarAtualizacao };
