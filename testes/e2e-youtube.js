// Stage 2 with REAL yt-dlp + REAL YouTube link: two Junto programs, local server, fake Discord. Proves decode/stream of YouTube media.
// Usage: node testes\e2e-youtube.js [url]  (needs internet; yt-dlp at A:\opt\yt-dlp)
const { _electron } = require('A:/opt/node/node_modules/@playwright/cli/node_modules/playwright');
const http = require('http'), crypto = require('crypto'), net = require('net'), os = require('os'), path = require('path'), fs = require('fs');
const { spawn, execSync, execFileSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const appDir = path.join(raiz, 'app');
const electron = path.join(appDir, 'node_modules/electron/dist/electron.exe');
const FFMPEG = 'A:/Documentos/Claude-Projects/FNarra/ferramentas/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junto-e2e2-'));
const midiaDir = path.join(os.tmpdir(), 'junto-e2e2-midia');
const espera = ms => new Promise(r => setTimeout(r, ms));
const livre = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

let ok = 0, falhas = 0;
const conf = (nome, cond, extra) => { if (cond) { ok++; console.log('ok   ' + nome); } else { falhas++; console.log('FALHA ' + nome + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function ate(nome, f, ms = 15000) {
  const fim = Date.now() + ms; let v;
  while (Date.now() < fim) { try { v = await f(); if (v) { conf(nome, true); return v; } } catch (e) { v = e.message; } await espera(150); }
  conf(nome, false, v); return null;
}
const CONTAS = {
  ana: { id: '111111111111111111', username: 'ana', global_name: 'Ana Souza', avatar: null },
  beto: { id: '222222222222222222', username: 'beto', global_name: 'Beto', avatar: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  caio: { id: '333333333333333333', username: 'caio', global_name: 'Caio', avatar: null },
};
const desafios = new Map();
const discord = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/authorize/')) {
    const conta = u.pathname.split('/')[2];
    const code = 'codigo-' + conta + '-' + crypto.randomBytes(4).toString('hex');
    desafios.set(code, { conta, desafio: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri') });
    const volta = new URL(u.searchParams.get('redirect_uri'));
    volta.searchParams.set('code', code); volta.searchParams.set('state', u.searchParams.get('state'));
    res.writeHead(302, { Location: volta.toString() }); return res.end();
  }
  let corpo = ''; req.on('data', d => corpo += d); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (u.pathname.endsWith('/oauth2/token')) {
      const p = new URLSearchParams(corpo), d = desafios.get(p.get('code'));
      if (!d) { res.statusCode = 400; return res.end('{"error":"invalid_grant"}'); }
      return res.end(JSON.stringify({ access_token: 'tok-' + d.conta, token_type: 'Bearer', scope: 'identify' }));
    }
    if (u.pathname.endsWith('/users/@me')) {
      const c = CONTAS[(req.headers.authorization || '').replace('Bearer tok-', '')];
      if (!c) { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify(c));
    }
    res.statusCode = 404; res.end('{}');
  });
});

const programas = [];
let wrangler;
function encerrarServidor() { if (wrangler && !wrangler.killed) { try { execSync('taskkill /T /F /PID ' + wrangler.pid, { stdio: 'ignore' }); } catch (e) { } wrangler.killed = true; } }
async function subirServidor(portaS, portaD, persist) {
  wrangler = spawn('npx wrangler dev --local --port ' + portaS + ' --ip 127.0.0.1 --persist-to "' + persist + '" --var DISCORD_API:http://127.0.0.1:' + portaD + '/api --var DISCORD_CLIENT_ID:teste', { cwd: path.join(raiz, 'servidor'), shell: true, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  const fim = Date.now() + 60000;
  while (Date.now() < fim) { try { const r = await fetch('http://127.0.0.1:' + portaS + '/saude'); if (r.ok) return true; } catch (e) { } await espera(300); }
  return false;
}

let ctx;
async function abrir(conta) {
  const dados = path.join(tmp, conta); fs.mkdirSync(dados, { recursive: true });
  const app = await _electron.launch({
    executablePath: electron,
    args: ['--user-data-dir=' + dados, appDir],
    env: { ...process.env, JUNTO_SERVIDOR: 'http://127.0.0.1:' + ctx.portaS, JUNTO_DISCORD_CLIENT_ID: 'teste', JUNTO_DISCORD_AUTORIZAR: 'http://127.0.0.1:' + ctx.portaD + '/authorize/' + conta, JUNTO_DADOS: dados, JUNTO_SEM_NAVEGADOR: '1', JUNTO_OCULTO: '1', JUNTO_YTDLP: 'A:/opt/yt-dlp/yt-dlp.exe' },
  });
  const p = await app.firstWindow();
  p.on('pageerror', e => { falhas++; console.log('FALHA erro JS ' + conta + ': ' + e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/cdn\.discordapp|ERR_|Failed to load/.test(m.text())) { falhas++; console.log('FALHA console ' + conta + ': ' + m.text()); } });
  await p.waitForSelector('#janela', { timeout: 15000 });
  programas.push(app);
  return { app, p, conta };
}
const entrar = async (A, n) => { await A.p.click('[data-act="entrar"]'); return ate(n + ' entrou', () => A.p.evaluate(() => M.S.tela === 'principal' && !M.S.carregando)); };
const texto = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
const tocaOk = p => p.evaluate(() => { const a = document.querySelector('audio'); return !!a && !a.paused && a.currentTime > 0.8; });
const CAMPO = 'input.campo[aria-label="Link para a fila"]';
const adicionar = async (X, url) => { await X.p.fill(CAMPO, url); await X.p.press(CAMPO, 'Enter'); };
const filaDe = (p) => p.evaluate(() => { const a = M.achar(M.S.conn); return a ? a.fila.map(f => f[0]) : null; });
const offAudio = (p, n, passo) => p.evaluate(async ({ n, passo }) => {
  const a = document.querySelector('audio'), o = [];
  for (let i = 0; i < n; i++) { const s = window.junto.agoraServidor(); o.push(a.currentTime - s / 1000); await new Promise(r => setTimeout(r, passo)); }
  return o;
}, { n, passo });
const stat = (nome, arr) => { const m = Math.max(...arr), md = arr.reduce((s, x) => s + x, 0) / arr.length; console.log('     ' + nome + ': max=' + m.toFixed(3) + ' s  media=' + md.toFixed(3) + ' s  (n=' + arr.length + ')'); return { m, md }; };
// |posA - posB| per sample index, both pages sampling at the same time
async function medirSync(X, Y, nome, n = 20, passo = 500) {
  const [a, b] = await Promise.all([offAudio(X.p, n, passo), offAudio(Y.p, n, passo)]);
  const d = a.map((x, i) => Math.abs(x - b[i]));
  const r = stat(nome, d);
  conf('sync ' + nome + ' max < 0.5 s', r.m < 0.5, { max: r.m });
  return r;
}
const URL_YT = process.argv[2] || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // Big Buck Bunny, 10 min

(async () => {
  await new Promise(r => discord.listen(0, '127.0.0.1', r));
  const portaD = discord.address().port, portaS = await livre();
  ctx = { portaD, portaS };
  conf('servidor local subiu', await subirServidor(portaS, portaD, path.join(tmp, 'servidor')));
  const A = await abrir('ana'), B = await abrir('beto');
  await entrar(A, 'Ana'); await entrar(B, 'Beto');
  await A.p.evaluate(() => window.junto.enviar({ t: 'pedir', usuario: 'beto' }));
  await ate('Beto recebe pedido', () => B.p.evaluate(() => M.D.recebidos.length === 1));
  await B.p.evaluate(() => window.junto.enviar({ t: 'aceitar', id: M.D.recebidos[0].id }));
  await ate('Ana e Beto amigos', () => A.p.evaluate(() => M.AMIGOS.length === 1 && M.AMIGOS[0].est === 'on'));

  // ---- ver: real YouTube link ----
  await A.p.click('[data-act="camada:oferecer"]');
  await A.p.click('[data-act="oftipo:ver"]'); await A.p.click('[data-act="ofmodo:todos"]');
  await A.p.fill('.folha input.campo', URL_YT);
  await A.p.click('[data-act="comecar-oferta"]');
  await ate('Ana na propria sessao', () => A.p.evaluate(() => M.S.tela === 'sessao' && M.S.conn === 'eu'));
  const fila = await ate('fila tem o titulo real do YouTube', async () => { const f = await filaDe(A.p); return f && f.length === 1 && f[0] && !/^https?:/.test(f[0]) ? f : null; }, 60000);
  if (fila) console.log('     titulo: ' + fila[0]);
  await ate('Ana toca audio do YouTube', () => tocaOk(A.p), 60000);
  conf('audio vem do googlevideo (https)', await A.p.evaluate(() => /^https:\/\/[^/]*googlevideo\.com\//.test(document.querySelector('audio').src)), await A.p.evaluate(() => document.querySelector('audio').src.slice(0, 60)));
  await ate('Beto ve o cartao', () => B.p.evaluate(() => !!document.querySelector('.card')));
  await B.p.click('.card');
  await ate('Beto toca audio do YouTube', () => tocaOk(B.p), 60000);
  await espera(3000);
  const s1 = await medirSync(A, B, 'A x B YouTube', 16, 500);

  await B.p.click('[data-act="ver-video"]');
  const V = await ate('janela de video abriu', async () => B.app.windows().find(w => /video\.html/.test(w.url())) || false, 10000) && B.app.windows().find(w => /video\.html/.test(w.url()));
  let r;
  if (V) {
    const dim = await ate('video do YouTube toca com imagem', () => V.evaluate(() => { const v = document.getElementById('v'); return !v.paused && v.currentTime > 0.8 && v.videoWidth > 0 ? v.videoWidth + 'x' + v.videoHeight : null; }), 40000);
    if (dim) console.log('     video: ' + dim);
    await espera(3000);
    const d = [];
    for (let i = 0; i < 16; i++) {
      const [a, v] = await Promise.all([B.p.evaluate(() => document.querySelector('audio').currentTime - window.junto.agoraServidor() / 1000), V.evaluate(() => document.getElementById('v').currentTime - window.junto.agoraServidor() / 1000)]);
      d.push(Math.abs(a - v)); await espera(500);
    }
    r = stat('video x audio', d);
    conf('sync video x audio max < 0.5 s', r.m < 0.5, r);
  }
  // pause/resume reaches the other side with real media
  await B.p.click('[data-act="tocar"]');
  await ate('pausa do Beto chega na Ana', () => A.p.evaluate(() => M.S.tocando === false && document.querySelector('audio').paused));
  await B.p.click('[data-act="tocar"]');
  await ate('retomar chega na Ana', () => A.p.evaluate(() => M.S.tocando === true && !document.querySelector('audio').paused), 10000);
  await espera(3000);
  await medirSync(A, B, 'A x B depois de retomar', 10, 500);
  console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas);
})().catch(e => { falhas++; console.log('FALHA geral: ' + (e.stack || e.message)); console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas); }).finally(async () => {
  for (const a of programas) { try { await a.close(); } catch (e) { } }
  encerrarServidor(); discord.close();
  setTimeout(() => process.exit(falhas ? 1 : 0), 300);
});
