// Stage 2 end to end: three real Junto programs, real local server runtime, fake Discord, fake yt-dlp, local media server.
// Off screen, isolated data folders. Usage: node testes\e2e-etapa2.js [photo folder]
const { _electron } = require('A:/opt/node/node_modules/@playwright/cli/node_modules/playwright');
const http = require('http'), crypto = require('crypto'), net = require('net'), os = require('os'), path = require('path'), fs = require('fs');
const { spawn, execSync, execFileSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const appDir = path.join(raiz, 'app');
const electron = path.join(appDir, 'node_modules/electron/dist/electron.exe');
const FFMPEG = 'A:/Documentos/Claude-Projects/FNarra/ferramentas/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe';
const fotos = process.argv[2];
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

// ---------- test media: generated once, served with Range support ----------
function gerarMidia() {
  fs.mkdirSync(midiaDir, { recursive: true });
  const a = path.join(midiaDir, 'audio.m4a'), v = path.join(midiaDir, 'video.mp4');
  if (!fs.existsSync(a)) execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', a]);
  if (!fs.existsSync(v)) execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '25', '-an', '-movflags', '+faststart', v]);
}
const servidorMidia = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const arq = path.join(midiaDir, path.basename(u.pathname));
  if (!fs.existsSync(arq) || !fs.statSync(arq).isFile()) { res.statusCode = 404; return res.end(); }
  const tam = fs.statSync(arq).size, tipo = arq.endsWith('.mp4') ? 'video/mp4' : 'audio/mp4';
  const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const cab = { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (r) {
    let ini = r[1] === '' ? tam - Number(r[2]) : Number(r[1]), fim = r[1] !== '' && r[2] !== '' ? Number(r[2]) : tam - 1;
    if (ini > fim || ini >= tam) { res.writeHead(416, { 'Content-Range': 'bytes */' + tam }); return res.end(); }
    res.writeHead(206, { ...cab, 'Content-Range': `bytes ${ini}-${fim}/${tam}`, 'Content-Length': fim - ini + 1 });
    return fs.createReadStream(arq, { start: ini, end: fim }).pipe(res);
  }
  res.writeHead(200, { ...cab, 'Content-Length': tam });
  fs.createReadStream(arq).pipe(res);
});

// ---------- fake yt-dlp (run as node by midia.js): yt-dlp -J style JSON ----------
function escreverFakeYtdlp() {
  const f = path.join(tmp, 'fake-ytdlp.js');
  fs.writeFileSync(f, `
const url = process.argv[process.argv.length - 1];
const base = process.env.JUNTO_FAKE_MIDIA;
if (/privado/.test(url)) { process.stderr.write("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video\\n"); process.exit(1); }
const n = (/faixa\\/(\\d+)/.exec(url) || [0, '0'])[1];
process.stdout.write(JSON.stringify({
  title: 'Faixa ' + n, uploader: 'Teste ' + n, duration: 60,
  formats: [
    { format_id: 'a', url: base + '/audio.m4a?i=' + n, ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 64, tbr: 64 },
    { format_id: 'v', url: base + '/video.mp4?i=' + n, ext: 'mp4', acodec: 'none', vcodec: 'avc1.64001e', height: 360, tbr: 400 },
  ],
}));
`);
  return f;
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
    env: { ...process.env, JUNTO_SERVIDOR: 'http://127.0.0.1:' + ctx.portaS, JUNTO_DISCORD_CLIENT_ID: 'teste', JUNTO_DISCORD_AUTORIZAR: 'http://127.0.0.1:' + ctx.portaD + '/authorize/' + conta, JUNTO_DADOS: dados, JUNTO_SEM_NAVEGADOR: '1', JUNTO_OCULTO: '1', JUNTO_TESTE_MIDIA: '1', JUNTO_YTDLP: ctx.fake, JUNTO_FAKE_MIDIA: ctx.midiaUrl },
  });
  const p = await app.firstWindow();
  p.on('pageerror', e => { falhas++; console.log('FALHA erro JS ' + conta + ': ' + e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/cdn\.discordapp|ERR_|Failed to load/.test(m.text())) { falhas++; console.log('FALHA console ' + conta + ': ' + m.text()); } });
  await p.waitForSelector('#janela', { timeout: 15000 });
  programas.push(app);
  return { app, p, conta };
}
const medir = p => p.evaluate(() => {
  const j = document.getElementById('janela'); const J = j.getBoundingClientRect(), o = [];
  document.querySelectorAll('#raiz *').forEach(e => {
    if (e.closest('svg') || e.closest('.tira') || e.classList.contains('luz')) return; // .luz bleeds on purpose, clipped by .palco
    const q = e.getBoundingClientRect(); if (!q.width || !q.height) return;
    if (q.right > J.right + 1 || q.left < J.left - 1) o.push('x ' + e.className);
    if (!e.closest('.rola,.mio') && q.bottom > J.bottom + 1) o.push('y ' + e.className);
    if (!e.children.length && e.textContent.trim() && getComputedStyle(e).overflow === 'hidden' && e.scrollWidth > e.clientWidth + 1) o.push('corte ' + e.textContent.trim().slice(0, 30));
  });
  return [...new Set(o)];
});
const foto = async (p, n) => {
  await p.waitForTimeout(450);
  const m = await medir(p);
  conf('sem corte: ' + n, m.length === 0, m);
  if (fotos) await p.screenshot({ path: path.join(fotos, 'app2-' + n + '.png') });
};
const entrar = async (A, n) => { await A.p.click('[data-act="entrar"]'); return ate(n + ' entrou', () => A.p.evaluate(() => M.S.tela === 'principal' && !M.S.carregando)); };
const texto = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
const tocaOk = p => p.evaluate(() => { const a = document.querySelector('audio'); return !!a && !a.paused && a.currentTime > 0.8; });
const CAMPO = 'input.campo[aria-label="Link para a fila"]';
// Dead-button check: every visible [data-act] must do something (no 'noop', no "next version" placeholder).
const semMorto = async (X, n) => {
  const m = await X.p.evaluate(() => [...document.querySelectorAll('#raiz [data-act]')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height; })
    .filter(e => e.dataset.act === 'noop' || /próxima versão/i.test(e.dataset.dica || '')).map(e => (e.dataset.dica || e.textContent).slice(0, 40)));
  conf('sem botao morto: ' + n, m.length === 0, m);
};
const logDe = X => { try { return fs.readFileSync(path.join(tmp, X.conta, 'junto.log'), 'utf8'); } catch (e) { return ''; } };
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

(async () => {
  gerarMidia();
  await new Promise(r => servidorMidia.listen(0, '127.0.0.1', r));
  await new Promise(r => discord.listen(0, '127.0.0.1', r));
  const portaD = discord.address().port, portaS = await livre();
  ctx = { portaD, portaS, fake: escreverFakeYtdlp(), midiaUrl: 'http://127.0.0.1:' + servidorMidia.address().port };
  conf('servidor local subiu', await subirServidor(portaS, portaD, path.join(tmp, 'servidor')));

  const A = await abrir('ana'), B = await abrir('beto');
  await entrar(A, 'Ana'); await entrar(B, 'Beto');
  await A.p.evaluate(() => window.junto.enviar({ t: 'pedir', usuario: 'beto' }));
  await A.p.evaluate(() => window.junto.enviar({ t: 'pedir', usuario: 'caio' }));
  await ate('Beto recebe pedido', () => B.p.evaluate(() => M.D.recebidos.length === 1));
  await B.p.evaluate(() => window.junto.enviar({ t: 'aceitar', id: M.D.recebidos[0].id }));
  await ate('Ana e Beto amigos', () => A.p.evaluate(() => M.AMIGOS.length === 1 && M.AMIGOS[0].est === 'on'));

  // ---- 0. options really do something; version is the real one ----
  await semMorto(A, 'principal');
  await B.p.click('[data-act="camada:opcoes"]');
  const ver = require(path.join(appDir, 'package.json')).version;
  await ate('opcoes mostram a versao real', () => B.p.evaluate(v => document.querySelector('.folha').textContent.includes('Versão ' + v) && !/Em dia/.test(document.querySelector('.folha').textContent), ver));
  conf('sem chave Iniciar mais rapido', await B.p.evaluate(() => !document.querySelector('[data-act="opc:rap"]')));
  await semMorto(B, 'opcoes');
  conf('iniciar com o Windows vem desligado', await B.p.evaluate(() => !document.querySelector('[data-act="opc:min"]')));
  await B.p.click('[data-act="opc:win"]');
  await ate('chave salva no arquivo', () => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'beto', 'opcoes.json'), 'utf8')).win === true; } catch (e) { return false; } });
  await ate('minimizado aparece ao ligar', () => B.p.evaluate(() => !!document.querySelector('[data-act="opc:min"]')));
  await B.p.click('[data-act="opc:win"]');
  await ate('chave desliga de novo', () => B.p.evaluate(() => !document.querySelector('[data-act="opc:min"]')));
  await B.p.click('.folha [data-act="fecha-camada"]');
  await A.p.click('[data-act="camada:amigos"]'); await semMorto(A, 'amigos'); await A.p.click('.folha [data-act="fecha-camada"]');

  // ---- 1. offer (ouvir, todos), card, connect ----
  await A.p.click('[data-act="camada:oferecer"]');
  await A.p.click('[data-act="oftipo:ouvir"]'); await A.p.click('[data-act="ofmodo:todos"]');
  await foto(A.p, 'oferecer');
  await semMorto(A, 'oferecer');
  conf('sem botao de arquivo no oferecer', await A.p.evaluate(() => !document.querySelector('[data-dica*="arquivo"]') && !/arquivo/.test(document.querySelector('.folha input.campo').placeholder)));
  await A.p.press('.folha input.campo', 'Enter'); // Enter in the link field = Disponibilizar
  await ate('Ana na propria sessao', () => A.p.evaluate(() => M.S.tela === 'sessao' && M.S.conn === 'eu'));
  conf('titulo da sessao propria: Sua sessao', await A.p.evaluate(() => document.querySelector('.topo2 .corta').textContent === 'Sua sessão'), await texto(A.p, '.topo2 .corta'));
  conf('selo mostra o modo real', (await texto(A.p, '.inf .selo')) === 'Todos controlam', await texto(A.p, '.inf .selo'));
  conf('controles ligados para o dono', await A.p.evaluate(() => !document.querySelector('[data-act="tocar"]').disabled));
  await ate('Beto ve o cartao', () => B.p.evaluate(() => !!document.querySelector('.card')));
  await ate('Beto recebeu aviso de oferta', () => /aviso: teste .*Ana Souza disponibilizou/.test(logDe(B)));
  conf('Ana nao se avisa da propria oferta', !/aviso: teste/.test(logDe(A)));
  await foto(B.p, 'lista-com-cartao');
  await B.p.click('.card');
  await ate('Beto entrou na sessao', () => B.p.evaluate(() => M.S.tela === 'sessao' && M.S.conn !== 'eu' && M.S.conn !== null));
  await ate('Ana ve Beto na sessao (avatar uma vez cada)', () => A.p.evaluate(() => document.querySelectorAll('.inf .av').length === 2));
  conf('titulo na sessao do amigo: Com Ana', (await texto(B.p, '.topo2 .corta')) === 'Com Ana Souza', await texto(B.p, '.topo2 .corta'));

  // ---- 2. bad link, permission link, then real link (via button) ----
  conf('fila tem botao Por na fila', await B.p.evaluate(() => !!document.querySelector('button[data-act="add-link"]')));
  await B.p.fill(CAMPO, 'nao e link'); await B.p.click('button[data-act="add-link"]');
  await ate('texto que nao e link avisa', () => B.p.evaluate(() => /não é um link/.test((document.querySelector('.faixa.erro') || {}).textContent || '')));
  conf('texto invalido continua no campo', await B.p.evaluate(c => document.querySelector(c).value === 'nao e link', CAMPO));
  await adicionar(B, 'http://fake.test/privado/1');
  await ate('faixa sem permissao em quem adicionou', () => B.p.evaluate(() => /Sem permissão/.test((document.querySelector('.faixa.erro') || {}).textContent || '')));
  await foto(B.p, 'sem-permissao');
  conf('link sem permissao nao entrou na fila', (await filaDe(A.p)).length === 0, await filaDe(A.p));
  await A.p.fill(CAMPO, 'http://fake.test/faixa/1'); await A.p.click('button[data-act="add-link"]');
  await ate('campo esvazia depois de adicionar', () => A.p.evaluate(c => document.querySelector(c).value === '', CAMPO));
  await ate('fila da Ana tem Faixa 1', async () => (await filaDe(A.p) || []).join() === 'Faixa 1');
  await ate('Beto ve Faixa 1', async () => (await filaDe(B.p) || []).join() === 'Faixa 1');
  await ate('Ana toca', () => tocaOk(A.p), 20000);
  await ate('Beto toca', () => tocaOk(B.p), 20000);
  await semMorto(A, 'sessao dono'); await semMorto(B, 'sessao amigo');
  await B.p.click('[data-act="volume"]');
  await ate('volume: clique tira o som', () => B.p.evaluate(() => document.querySelector('audio').muted === true && localStorage.getItem('junto.mudo') === '1'));
  conf('volume: so no PC do Beto', await A.p.evaluate(() => document.querySelector('audio').muted === false));
  await B.p.click('[data-act="volume"]');
  await ate('volume: clique devolve o som', () => B.p.evaluate(() => document.querySelector('audio').muted === false));
  await B.p.hover('[data-act="volume"]'); await B.p.mouse.wheel(0, 100); await B.p.mouse.wheel(0, 100);
  await ate('volume: roda abaixa 10%', () => B.p.evaluate(() => Math.abs(document.querySelector('audio').volume - 0.9) < 0.001 && localStorage.getItem('junto.vol') === '0.9'));
  await B.p.mouse.wheel(0, -100); await B.p.mouse.wheel(0, -100);
  await ate('volume: roda sobe de volta', () => B.p.evaluate(() => document.querySelector('audio').volume === 1));
  await foto(A.p, 'sessao-dono');
  await foto(B.p, 'sessao-amigo');

  // ---- 3. sync ----
  console.log('--- sincronia ---');
  const s1 = await medirSync(A, B, 'A x B (10 s)');
  const todos = [s1];

  // ---- 4. pause by B reaches A ----
  await B.p.click('[data-act="tocar"]');
  await ate('pausa do Beto chega na Ana', () => A.p.evaluate(() => M.S.tocando === false && document.querySelector('audio').paused));
  await B.p.click('[data-act="tocar"]');
  await ate('retomar do Beto chega na Ana', () => A.p.evaluate(() => M.S.tocando === true && !document.querySelector('audio').paused), 8000);
  await espera(2500);

  // ---- 5. late join: third program ----
  const C = await abrir('caio');
  await entrar(C, 'Caio');
  await ate('Caio recebe pedido da Ana', () => C.p.evaluate(() => M.D.recebidos.length === 1));
  await C.p.evaluate(() => window.junto.enviar({ t: 'aceitar', id: M.D.recebidos[0].id }));
  await ate('Caio ve o cartao', () => C.p.evaluate(() => !!document.querySelector('.card')));
  await C.p.click('.card');
  await ate('Caio entrou tarde e toca', () => tocaOk(C.p), 25000);
  await espera(3000);
  const s2 = await medirSync(A, C, 'A x C (entrou tarde)', 10, 500); todos.push(s2);
  const s2b = await medirSync(B, C, 'B x C (entrou tarde)', 10, 500); todos.push(s2b);
  await foto(A.p, 'sessao-dono-3');

  // ---- 6. modo dono: B cannot control or add ----
  await A.p.evaluate(() => window.junto.enviar({ t: 'oferecer', tipo: 'ouvir', modo: 'dono' }));
  await ate('Beto: controles desligados (modo dono)', () => B.p.evaluate(() => [...document.querySelectorAll('[data-act="tocar"],[data-act="pular"],[data-act="voltar"]')].every(b => b.disabled) && document.querySelector('[data-act="tocar"]')));
  conf('Beto: selo Só o dono', (await texto(B.p, '.inf .selo')) === 'Só o dono', await texto(B.p, '.inf .selo'));
  conf('Beto nao ve campo de adicionar (modo dono)', await B.p.evaluate(() => !document.querySelector('input.campo')));
  conf('Ana ainda controla (modo dono)', await A.p.evaluate(() => [...document.querySelectorAll('[data-act="tocar"]')].every(b => !b.disabled)));
  conf('selo do dono mostra Só o dono', (await texto(A.p, '.inf .selo')) === 'Só o dono', await texto(A.p, '.inf .selo'));
  const r1 = await B.p.evaluate(() => window.junto.enviar({ t: 'pausar' }));
  conf('pausa do Beto rejeitada (modo dono)', r1.ok === false && r1.erro === 'sem_permissao', r1);
  const r1b = await B.p.evaluate(() => window.junto.enviar({ t: 'adicionar', url: 'http://fake.test/faixa/9', titulo: 'x', sub: '', dur: 60 }));
  conf('adicionar do Beto rejeitado (modo dono)', r1b.ok === false && r1b.erro === 'sem_permissao', r1b);
  await espera(600);
  conf('Ana continua tocando', await A.p.evaluate(() => M.S.tocando === true && !document.querySelector('audio').paused));
  await foto(B.p, 'sessao-modo-dono');

  // ---- 7. modo fila: B adds, cannot pause ----
  await A.p.evaluate(() => window.junto.enviar({ t: 'oferecer', tipo: 'ouvir', modo: 'fila' }));
  await ate('Beto ve campo de adicionar (modo fila)', () => B.p.evaluate(() => !!document.querySelector('input.campo')));
  conf('Beto sem controles (modo fila)', await B.p.evaluate(() => [...document.querySelectorAll('[data-act="tocar"]')].every(b => b.disabled)));
  await adicionar(B, 'http://fake.test/faixa/2');
  await ate('Beto adicionou Faixa 2 (modo fila)', async () => (await filaDe(A.p) || []).join() === 'Faixa 1,Faixa 2');
  const r2 = await B.p.evaluate(() => window.junto.enviar({ t: 'pausar' }));
  conf('pausa do Beto rejeitada (modo fila)', r2.ok === false && r2.erro === 'sem_permissao', r2);
  await foto(B.p, 'sessao-modo-fila');

  // ---- 8. pular advances everybody ----
  await A.p.click('[data-act="pular"]');
  await ate('pular: fila de todos tem so Faixa 2', async () => { const f = [await filaDe(A.p), await filaDe(B.p), await filaDe(C.p)]; return f.every(x => x && x.join() === 'Faixa 2'); });
  await ate('pular: os 3 tocam a Faixa 2', () => Promise.all([A, B, C].map(X => X.p.evaluate(() => { const a = document.querySelector('audio'); return a.src.includes('i=2') && !a.paused && a.currentTime > 0.5; }))).then(v => v.every(Boolean)), 25000);
  const s3 = await medirSync(A, B, 'A x B depois de pular', 10, 500); todos.push(s3);

  // ---- 9. dono stops: everybody returns to the list ----
  await C.app.close(); programas.splice(programas.indexOf(C.app), 1);
  await A.p.click('[data-act="desconectar"]');
  await ate('Beto volta para a lista quando o dono para', () => B.p.evaluate(() => M.S.tela === 'principal' && M.S.conn === null));
  await ate('cartao some', () => B.p.evaluate(() => !document.querySelector('.card')));
  await ate('Ana volta para a lista', () => A.p.evaluate(() => M.S.tela === 'principal' && M.S.conn === null));
  await ate('audio parou no Beto', () => B.p.evaluate(() => { const a = document.querySelector('audio'); return a.paused && !a.getAttribute('src'); }));

  // ---- 10. tipo ver: video window ----
  await A.p.click('[data-act="camada:oferecer"]');
  await A.p.click('[data-act="oftipo:ver"]'); await A.p.click('[data-act="ofmodo:todos"]');
  await A.p.fill('.folha input.campo', 'http://fake.test/faixa/3');
  await A.p.click('[data-act="comecar-oferta"]');
  await ate('Beto ve o novo cartao', () => B.p.evaluate(() => !!document.querySelector('.card')));
  await B.p.click('.card');
  await ate('Beto toca (ver)', () => tocaOk(B.p), 25000);
  await ate('Ana toca (ver)', () => tocaOk(A.p), 25000);
  await B.p.click('[data-act="ver-video"]');
  const V = await ate('janela de video abriu', async () => B.app.windows().find(w => /video\.html/.test(w.url())) || false, 10000) && B.app.windows().find(w => /video\.html/.test(w.url()));
  if (V) {
    await ate('video toca', () => V.evaluate(() => { const v = document.getElementById('v'); return !v.paused && v.currentTime > 0.8 && v.videoWidth === 640; }), 20000);
    await espera(3000);
    conf('video sem som (muted)', await V.evaluate(() => document.getElementById('v').muted === true));
    const d = [];
    for (let i = 0; i < 20; i++) {
      const [a, v] = await Promise.all([B.p.evaluate(() => document.querySelector('audio').currentTime - window.junto.agoraServidor() / 1000), V.evaluate(() => document.getElementById('v').currentTime - window.junto.agoraServidor() / 1000)]);
      d.push(Math.abs(a - v)); await espera(500);
    }
    const r = stat('video x audio', d); todos.push(r);
    conf('sync video x audio max < 0.5 s', r.m < 0.5, r);
    const dv = [];
    for (let i = 0; i < 10; i++) {
      const [a, v] = await Promise.all([A.p.evaluate(() => document.querySelector('audio').currentTime - window.junto.agoraServidor() / 1000), V.evaluate(() => document.getElementById('v').currentTime - window.junto.agoraServidor() / 1000)]);
      dv.push(Math.abs(a - v)); await espera(500);
    }
    const r4 = stat('video do Beto x audio da Ana', dv); todos.push(r4);
    conf('sync video do Beto x audio da Ana max < 0.5 s', r4.m < 0.5, r4);
    await foto(B.p, 'sessao-ver');
    // video window pause button reaches the session (modo todos)
    await V.evaluate(() => document.getElementById('v').click());
    await ate('clique no video pausa a sessao', () => A.p.evaluate(() => M.S.tocando === false));
    await V.keyboard.press('Escape').catch(() => { }); // the window closes under the key press
    await ate('Esc fecha a janela de video', () => B.app.windows().every(w => !/video\.html/.test(w.url())), 8000);
  }
  await ate('Beto ainda na sessao depois de fechar o video', () => B.p.evaluate(() => M.S.tela === 'sessao'));

  // ---- 11. estado.sessao null while the session screen is shown ----
  await B.app.evaluate(({ BrowserWindow }) => {
    const j = BrowserWindow.getAllWindows().find(w => /index\.html/.test(w.webContents.getURL()));
    j.webContents.send('junto:estado', { t: 'estado', eu: { id: '222222222222222222', usuario: 'beto', nome: 'Beto', avatar: null }, amigos: [], recebidos: [], enviados: [], sessao: null });
  });
  await ate('estado sem sessao leva a tela principal', () => B.p.evaluate(() => M.S.tela === 'principal' && M.S.conn === null));

  // ---- summary ----
  const maxGeral = Math.max(...todos.map(x => x.m)), mediaGeral = todos.reduce((s, x) => s + x.md, 0) / todos.length;
  console.log('SINCRONIA max=' + maxGeral.toFixed(3) + ' s  media das medias=' + mediaGeral.toFixed(3) + ' s');
  conf('sincronia geral max < 0.5 s', maxGeral < 0.5, maxGeral);
  console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas);
})().catch(e => { falhas++; console.log('FALHA geral: ' + (e.stack || e.message)); console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas); }).finally(async () => {
  for (const a of programas) { try { await a.close(); } catch (e) { } }
  encerrarServidor(); discord.close(); servidorMidia.close();
  setTimeout(() => process.exit(falhas ? 1 : 0), 300);
});
