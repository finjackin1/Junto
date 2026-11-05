'use strict';
// Media resolver (main process): yt-dlp -J --no-playlist -> direct stream URLs. Downloads nothing.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TEMPO = 30000;
const DIA = 24 * 3600 * 1000;
const MAX_SAIDA = 20 * 1024 * 1024;
const PERMISSAO = /private video|members-only|members only|sign in|age[- ]restricted|confirm your age|not available in your country|not made this video available|login required|log in|inappropriate for some users/i;

// Default exec: spawn with args array (no shell), kill on timeout. -> {code, out, err, timeout}
function execPadrao(arquivo, args, { timeout = TEMPO, aoSpawn } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', fim = false, estourou = false, grande = false;
    let p;
    try {
      // Tests point JUNTO_YTDLP at a .js fake: run it with this same executable as plain node.
      if (process.env.JUNTO_YTDLP && /\.js$/i.test(arquivo)) p = spawn(process.execPath, [arquivo, ...args], { windowsHide: true, shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      else p = spawn(arquivo, args, { windowsHide: true, shell: false });
    }
    catch (e) { return resolve({ code: -1, out: '', err: String(e.message), timeout: false }); }
    if (aoSpawn) aoSpawn(p);
    const fechar = (code) => { if (fim) return; fim = true; clearTimeout(t); resolve({ code, out, err, timeout: estourou, grande }); };
    const t = setTimeout(() => { estourou = true; try { p.kill('SIGKILL'); } catch { /* gone */ } fechar(-1); }, timeout);
    p.stdout.on('data', (d) => {
      out += d;
      if (out.length > MAX_SAIDA) { grande = true; try { p.kill('SIGKILL'); } catch { /* gone */ } fechar(-1); }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { err += e.message; fechar(-1); });
    p.on('close', (c) => fechar(c));
  });
}

// Literal host check (no DNS): loopback, private, link-local, *.local. teste=true allows exactly 127.0.0.1.
function hostBloqueado(url, teste = false) {
  let h;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return true; }
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  h = h.replace(/\.$/, '');
  if (teste && h === '127.0.0.1') return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const v4 = (a, b) => a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  const m4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m4) return v4(Number(m4[1]), Number(m4[2]));
  if (h.includes(':')) {
    const mm = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h); // IPv4-mapped (URL normalizes to hex)
    if (mm) { const x = parseInt(mm[1], 16); return v4(x >> 8, x & 255); }
    if (h === '::1' || h === '::') return true;
    const w = parseInt(h.split(':')[0] || '0', 16);
    return (w & 0xfe00) === 0xfc00 || (w & 0xffc0) === 0xfe80;
  }
  return false;
}

const alt = (f) => Number(f.height) || 0;
const temV = (f) => f.vcodec && f.vcodec !== 'none';
const temA = (f) => f.acodec && f.acodec !== 'none';
const tbr = (f) => Number(f.abr) || Number(f.tbr) || 0;

function melhorAudio(fs_) {
  const so = fs_.filter((f) => f.url && temA(f) && !temV(f));
  const ok = so.filter((f) => /^(mp4a|opus)/.test(f.acodec || '') || ['m4a', 'webm'].includes(f.ext));
  const lista = ok.length ? ok : so;
  // prefer m4a/opus (Chromium plays both), then bitrate
  lista.sort((a, b) => tbr(b) - tbr(a));
  return lista[0] || null;
}

function escolher(info, tipo) {
  const fmts = Array.isArray(info.formats) ? info.formats : [];
  const aud = melhorAudio(fmts);
  if (tipo === 'ouvir') {
    if (aud) return { audio: aud.url };
    const prog = fmts.filter((f) => f.url && temA(f) && temV(f)).sort((a, b) => tbr(a) - tbr(b))[0];
    return prog ? { audio: prog.url } : null;
  }
  const prog = fmts
    .filter((f) => f.url && temV(f) && temA(f) && f.ext === 'mp4' && alt(f) > 0 && alt(f) <= 720)
    .sort((a, b) => alt(b) - alt(a) || tbr(b) - tbr(a))[0];
  if (prog) return { audio: prog.url, video: prog.url };
  const vid = fmts
    .filter((f) => f.url && temV(f) && !temA(f) && alt(f) > 0 && alt(f) <= 720 && /^(avc1|vp0?9)/.test(f.vcodec || ''))
    .sort((a, b) => alt(b) - alt(a) || tbr(b) - tbr(a))[0];
  if (vid && aud) return { audio: aud.url, video: vid.url };
  return null;
}

function criarMidia({ dados, recursos, log = () => {}, exec = execPadrao, dev = false } = {}) {
  const teste = dev && process.env.JUNTO_TESTE_MIDIA === '1';
  const ativos = new Map(); // chave -> {morto, p}
  const pastaTools = path.join(dados, 'ferramentas');
  const marca = path.join(pastaTools, 'yt-dlp-atualizado.txt');

  const selo = path.join(pastaTools, 'yt-dlp-embutido.txt'); // size:mtime of the bundled exe last examined
  let preparo = null;

  // yt-dlp version "YYYY.MM.DD[.N]" -> [Y, M, D, N] or null
  async function versao(exe) {
    try {
      const r = await exec(exe, ['--version'], { timeout: 20000 });
      const m = r && r.code === 0 && /^\d+(\.\d+)*$/.exec(String(r.out || '').trim());
      return m ? m[0].split('.').map(Number) : null;
    } catch { return null; }
  }
  const maior = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0; } return false; };

  // The daily -U keeps the copy fresh; the bundled exe replaces it only when it is newer (checked only when the bundled file changed).
  async function preparar() {
    const alvo = path.join(pastaTools, 'yt-dlp.exe'), orig = path.join(recursos || '', 'yt-dlp.exe');
    try {
      const st = fs.statSync(orig);
      const sig = st.size + ':' + Math.floor(st.mtimeMs);
      const tem = fs.existsSync(alvo);
      let visto = ''; try { visto = fs.readFileSync(selo, 'utf8').trim(); } catch { /* none */ }
      if (tem && visto === sig) return;
      let copiar = !tem;
      if (tem) {
        const va = await versao(alvo);
        const vo = va ? await versao(orig) : null;
        copiar = !va || (!!vo && maior(vo, va));
      }
      fs.mkdirSync(pastaTools, { recursive: true });
      if (copiar) fs.copyFileSync(orig, alvo);
      fs.writeFileSync(selo, sig);
    } catch (e) { if (!fs.existsSync(alvo)) log.erro?.('yt-dlp copy failed', e); }
  }

  // Sync (no tick lost, so cancelar() still reaches the spawn) unless the first preparation is still running.
  function caminho() {
    if (dev && process.env.JUNTO_YTDLP) return process.env.JUNTO_YTDLP;
    const alvo = path.join(pastaTools, 'yt-dlp.exe');
    if (preparo === true) return alvo;
    if (!preparo) preparo = preparar().then(() => { preparo = true; });
    return preparo.then(() => alvo);
  }

  async function atualizar(exe) {
    let ultimo = 0;
    try { ultimo = Number(fs.readFileSync(marca, 'utf8')) || 0; } catch { /* never */ }
    if (Date.now() - ultimo < DIA) return false;
    try {
      fs.mkdirSync(pastaTools, { recursive: true });
      fs.writeFileSync(marca, String(Date.now()));
    } catch { /* ignore */ }
    await exec(exe, ['-U'], { timeout: 120000 });
    return true;
  }

  async function rodar(exe, url, tk) {
    if (tk.morto) return { erro: 'falhou', timeout: true };
    const r = await exec(exe, ['-J', '--no-playlist', '--no-warnings', '--', url], { timeout: TEMPO, aoSpawn: (p) => { tk.p = p; } });
    if (tk.morto) return { erro: 'falhou', timeout: true };
    if (r.grande) return { erro: 'falhou', timeout: true, err: 'saida grande' };
    if (r.timeout) return { erro: 'falhou', timeout: true };
    if (r.code === 0) {
      try {
        const info = JSON.parse(r.out);
        return { info };
      } catch { return { erro: 'falhou', err: 'json' }; }
    }
    return { erro: PERMISSAO.test(r.err || '') ? 'sem_permissao' : 'falhou', err: r.err };
  }

  function cancelar(chave) {
    const tk = ativos.get(chave);
    if (!tk) return;
    ativos.delete(chave); tk.morto = true;
    try { if (tk.p) tk.p.kill('SIGKILL'); } catch { /* gone */ }
  }

  function cancelarTudo() { for (const k of [...ativos.keys()]) cancelar(k); }

  async function resolver(url, tipo, chave) {
    if (typeof url !== 'string' || url.length > 2048 || !/^https?:\/\/[^\s]+$/i.test(url) || hostBloqueado(url, teste)) return { ok: false, erro: 'falhou' };
    const t = tipo === 'ver' ? 'ver' : 'ouvir';
    const tk = { morto: false, p: null };
    if (chave !== undefined) { cancelar(chave); ativos.set(chave, tk); }
    try { return await resolverTk(url, t, tk); } finally { if (chave !== undefined && ativos.get(chave) === tk) ativos.delete(chave); }
  }

  async function resolverTk(url, t, tk) {
    let exe = caminho();
    if (typeof exe !== 'string') exe = await exe;
    let r = await rodar(exe, url, tk);
    if (r.erro === 'sem_permissao') return { ok: false, erro: 'sem_permissao' };
    if (r.erro && !r.timeout) {
      try { await atualizar(exe); } catch (e) { log.erro?.('yt-dlp update failed', e); }
      r = await rodar(exe, url, tk);
      if (r.erro === 'sem_permissao') return { ok: false, erro: 'sem_permissao' };
    } else if (r.erro) {
      log('yt-dlp timeout');
    }
    if (r.erro) { log('resolve failed', r.err ? String(r.err).split('\n')[0].slice(0, 120) : ''); return { ok: false, erro: 'falhou' }; }
    const esc = escolher(r.info, t);
    if (!esc) { log('no usable format'); return { ok: false, erro: 'falhou' }; }
    const dur = Number(r.info.duration);
    const res = {
      ok: true,
      titulo: String(r.info.title || ''),
      sub: String(r.info.uploader || r.info.channel || ''),
      dur: Number.isFinite(dur) && dur > 0 ? dur : null,
      audio: esc.audio,
    };
    if (esc.video) res.video = esc.video;
    return res;
  }

  return { resolver, cancelar, cancelarTudo };
}

module.exports = { criarMidia, escolher, execPadrao, hostBloqueado };
