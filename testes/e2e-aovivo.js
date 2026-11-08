// Stage 3 (live share) end to end, hidden and silent: a fake "browser" window (testes\fonte-aovivo.js, moving player
// in a static page), two Junto programs, local server, fake Discord, fake audio helper (testes\fake-audio.js = 440 Hz).
// Ana shares the window; Beto must get the cropped video and the tone over WebRTC. Usage: node testes\e2e-aovivo.js
// --sandbox: Beto runs the packaged dist\Junto-win32-x64 inside Windows Sandbox (a second "PC" behind its own NAT),
// reached by Playwright over CDP. Needs Windows Sandbox on, a fresh build in dist and inbound rules for node.exe and
// the dev electron.exe on this PC. Scratch files: ..\_ferramentas\temp\junto\sandbox.
const { _electron, chromium } = require('./playwright');
const http = require('http'), crypto = require('crypto'), net = require('net'), os = require('os'), path = require('path'), fs = require('fs');
const { spawn, execSync, execFileSync } = require('child_process');
const SANDBOX = process.argv.includes('--sandbox');

const raiz = path.resolve(__dirname, '..');
const appDir = path.join(raiz, 'app');
const electron = path.join(appDir, 'node_modules/electron/dist/electron.exe');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junto-e2e-vivo-'));
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
  beto: { id: '222222222222222222', username: 'beto', global_name: 'Beto', avatar: null },
};
const desafios = new Map();
const discord = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/authorize/')) {
    const conta = u.pathname.split('/')[2];
    const code = 'codigo-' + conta + '-' + crypto.randomBytes(4).toString('hex');
    desafios.set(code, { conta });
    const volta = new URL(u.searchParams.get('redirect_uri'));
    volta.searchParams.set('code', code); volta.searchParams.set('state', u.searchParams.get('state'));
    res.writeHead(302, { Location: volta.toString() }); return res.end();
  }
  let corpo = ''; req.on('data', d => corpo += d); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (u.pathname.endsWith('/oauth2/token')) {
      const d = desafios.get(new URLSearchParams(corpo).get('code'));
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
let wrangler, fonte;
const matar = p => { if (p && !p.killed) { try { execSync('taskkill /T /F /PID ' + p.pid, { stdio: 'ignore' }); } catch (e) { } p.killed = true; } };
async function subirServidor(portaS, portaD, persist) {
  wrangler = spawn('npx wrangler dev --local --port ' + portaS + ' --ip 127.0.0.1 --persist-to "' + persist + '" --var DISCORD_API:http://127.0.0.1:' + portaD + '/api --var DISCORD_CLIENT_ID:teste', { cwd: path.join(raiz, 'servidor'), shell: true, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  const fim = Date.now() + 60000;
  while (Date.now() < fim) { try { const r = await fetch('http://127.0.0.1:' + portaS + '/saude'); if (r.ok) return true; } catch (e) { } await espera(300); }
  return false;
}
function subirFonte() {
  return new Promise((ok, erro) => {
    fonte = spawn(electron, [path.join(__dirname, 'fonte-aovivo.js')], { stdio: ['ignore', 'pipe', 'ignore'] });
    let s = '';
    fonte.stdout.on('data', d => { s += d; const m = /hwnd (\d+)/.exec(s); if (m) ok(m[1]); });
    setTimeout(() => erro(new Error('fonte nao abriu')), 20000);
  });
}

let ctx;
async function abrir(conta) {
  const dados = path.join(tmp, conta); fs.mkdirSync(dados, { recursive: true });
  const app = await _electron.launch({
    executablePath: electron,
    args: ['--user-data-dir=' + dados, appDir],
    env: { ...process.env, JUNTO_SERVIDOR: 'http://127.0.0.1:' + ctx.portaS, JUNTO_DISCORD_CLIENT_ID: 'teste', JUNTO_DISCORD_AUTORIZAR: 'http://127.0.0.1:' + ctx.portaD + '/authorize/' + conta, JUNTO_DADOS: dados, JUNTO_SEM_NAVEGADOR: '1', JUNTO_OCULTO: '1', JUNTO_AUDIO: path.join(__dirname, 'fake-audio.js'), JUNTO_FAKE_NAVEGADOR: ctx.hwnd },
  });
  const p = await app.firstWindow();
  p.on('pageerror', e => { falhas++; console.log('FALHA erro JS ' + conta + ': ' + e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/cdn\.discordapp|ERR_|Failed to load/.test(m.text())) { falhas++; console.log('FALHA console ' + conta + ': ' + m.text()); } });
  await p.waitForSelector('#janela', { timeout: 15000 });
  programas.push(app);
  return { app, p, conta };
}
// ---- Beto inside Windows Sandbox ----
let sandboxId = null, proxy = null;
const LOGON = (portaP, portaD, conta) => `
netsh advfirewall set allprofiles state off | Out-Null
$c = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1
$gw = $c.IPv4DefaultGateway.NextHop; $ip = $c.IPv4Address.IPAddress
$env:JUNTO_SERVIDOR = "http://$($gw):${portaP}"
$env:JUNTO_DISCORD_CLIENT_ID = 'teste'
$env:JUNTO_DISCORD_AUTORIZAR = "http://$($gw):${portaD}/authorize/${conta}"
$env:JUNTO_DADOS = 'C:\\teste\\dados'; $env:JUNTO_SEM_NAVEGADOR = '1'; $env:JUNTO_OCULTO = '1'
Start-Process 'C:\\Junto\\Junto.exe' -ArgumentList '--remote-debugging-port=9222'
$env:ELECTRON_RUN_AS_NODE = '1'
Start-Process 'C:\\Junto\\Junto.exe' -ArgumentList 'C:\\teste\\cdp.js'
Set-Content C:\\teste\\ip.txt "$ip $gw" -Encoding ascii
`;
// DevTools only listens on 127.0.0.1 inside the sandbox: this relay (run by Junto.exe as node) opens it on 9223.
const CDP = "require('net').createServer(c => { const s = require('net').connect(9222, '127.0.0.1'); c.pipe(s).pipe(c); c.on('error', () => s.destroy()); s.on('error', () => c.destroy()); }).listen(9223, '0.0.0.0');\n";
async function abrirSandbox(conta) {
  const dist = path.join(raiz, 'dist', 'Junto-win32-x64'), dir = path.resolve(raiz, '../_ferramentas/temp/junto/sandbox');
  if (!fs.existsSync(path.join(dist, 'Junto.exe'))) throw new Error('falta o build em ' + dist);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  // the local server only listens on 127.0.0.1 (workerd has no firewall rule): node relays it to the sandbox
  const portaP = await livre();
  proxy = net.createServer(c => { const s = net.connect(ctx.portaS, '127.0.0.1'); c.pipe(s).pipe(c); c.on('error', () => s.destroy()); s.on('error', () => c.destroy()); });
  await new Promise(r => proxy.listen(portaP, '0.0.0.0', r));
  fs.writeFileSync(path.join(dir, 'cdp.js'), CDP);
  fs.writeFileSync(path.join(dir, 'logon.ps1'), LOGON(portaP, ctx.portaD, conta));
  const pasta = (h, s, ro) => `<MappedFolder><HostFolder>${h}</HostFolder><SandboxFolder>${s}</SandboxFolder><ReadOnly>${ro}</ReadOnly></MappedFolder>`;
  const xml = '<Configuration><Networking>Enable</Networking><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection>'
    + '<MappedFolders>' + pasta(dist, 'C:\\Junto', 'true') + pasta(dir, 'C:\\teste', 'false') + '</MappedFolders>'
    + '</Configuration>';
  const saida = execFileSync('wsb', ['start', '--raw', '-c', xml]).toString();
  sandboxId = (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(saida) || [])[0];
  conf('sandbox iniciou', !!sandboxId, saida);
  // a headless sandbox has no user logon (LogonCommand never runs): start Junto as System once the network is up
  await ate('sandbox com rede', () => /IpV4Address/.test(execFileSync('wsb', ['ip', '--id', sandboxId, '--raw']).toString()), 120000);
  await ate('sandbox rodou o script', () => !!execFileSync('wsb', ['exec', '--id', sandboxId, '-r', 'System', '--raw', '-c', 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\teste\\logon.ps1']), 60000);
  const ipTxt = path.join(dir, 'ip.txt');
  const ip = await ate('sandbox ligou o Junto', () => fs.existsSync(ipTxt) && fs.readFileSync(ipTxt, 'utf8').trim().split(/\s+/)[0], 240000);
  if (!ip) throw new Error('sandbox nao respondeu');
  console.log('     sandbox: ' + fs.readFileSync(ipTxt, 'utf8').trim() + ' (ip gateway)');
  let browser = null;
  await ate('conectou no Junto do sandbox (CDP)', async () => { browser = await chromium.connectOverCDP('http://' + ip + ':9223', { timeout: 5000 }); return true; }, 60000);
  if (!browser) throw new Error('CDP do sandbox nao abriu');
  const c = browser.contexts()[0];
  const p = await ate('janela principal do sandbox', () => c.pages().find(x => /index\.html/.test(x.url())), 30000);
  p.on('pageerror', e => { falhas++; console.log('FALHA erro JS ' + conta + ': ' + e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/cdn\.discordapp|ERR_|Failed to load/.test(m.text())) { falhas++; console.log('FALHA console ' + conta + ': ' + m.text()); } });
  await p.waitForSelector('#janela', { timeout: 15000 });
  const app = { windows: () => c.pages(), close: () => browser.close() };
  programas.push(app);
  return { app, p, conta };
}
const entrar = async (A, n) => { await A.p.click('[data-act="entrar"]'); return ate(n + ' entrou', () => A.p.evaluate(() => M.S.tela === 'principal' && !M.S.carregando)); };
// Strength of 440 Hz vs the whole spectrum in a live <audio>'s stream (analysed before the muted output).
const tom = (p, expr) => p.evaluate(async (expr) => {
  const el = eval(expr), s = el && el.srcObject;
  if (!s || !s.getAudioTracks().length) return { erro: 'sem faixa de audio' };
  const c = new AudioContext(); await c.resume();
  const a = c.createAnalyser(); a.fftSize = 4096; c.createMediaStreamSource(s).connect(a);
  const b = new Float32Array(a.frequencyBinCount); let pico = -200, idx = 0;
  await new Promise(r => setTimeout(r, 1500));
  a.getFloatFrequencyData(b);
  for (let i = 1; i < b.length; i++) if (b[i] > pico) { pico = b[i]; idx = i; }
  const hz = idx * c.sampleRate / a.fftSize; c.close();
  return { hz: Math.round(hz), db: Math.round(pico), tocando: !el.paused };
}, expr);

(async () => {
  await new Promise(r => discord.listen(0, SANDBOX ? '0.0.0.0' : '127.0.0.1', r));
  const portaD = discord.address().port, portaS = await livre();
  const hwnd = await subirFonte();
  ctx = { portaD, portaS, hwnd };
  conf('janela de teste abriu', !!hwnd);
  conf('servidor local subiu', await subirServidor(portaS, portaD, path.join(tmp, 'servidor')));
  const B = SANDBOX ? await abrirSandbox('beto') : await abrir('beto'), A = await abrir('ana');
  await entrar(A, 'Ana'); await entrar(B, 'Beto');
  await A.p.evaluate(() => window.junto.enviar({ t: 'pedir', usuario: 'beto' }));
  await ate('Beto recebe pedido', () => B.p.evaluate(() => M.D.recebidos.length === 1));
  await B.p.evaluate(() => window.junto.enviar({ t: 'aceitar', id: M.D.recebidos[0].id }));
  await ate('Ana e Beto amigos', () => A.p.evaluate(() => M.AMIGOS.length === 1 && M.AMIGOS[0].est === 'on'));

  // ---- Ana picks the window ----
  await A.p.click('[data-act="camada:oferecer"]');
  await A.p.click('[data-act="oftipo:ver"]');
  await A.p.click('[data-act="offonte:janela"]');
  const idx = await ate('lista mostra a janela de teste como navegador', () => A.p.evaluate(() => { const l = M.S.janelas || []; const i = l.findIndex(w => /Filme teste/.test(w.bruto) && w.navegador); return i >= 0 ? String(i) : null; }), 20000);
  const nomes = await A.p.evaluate(() => (M.S.janelas || []).map(w => w.bruto + ' [' + w.exe + ']'));
  console.log('     janelas: ' + JSON.stringify(nomes));
  const minhaId = await A.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getMediaSourceId()));
  conf('lista nao mostra as janelas do proprio Junto', await A.p.evaluate(ids => !(M.S.janelas || []).some(w => ids.includes(w.id)), minhaId));
  if (idx === null) throw new Error('janela de teste nao apareceu');
  await A.p.click('[data-act="ofjanela:' + idx + '"]');
  await A.p.click('[data-act="comecar-aba"]');
  await ate('Ana compartilhando', () => A.p.evaluate(() => M.S.tela === 'sessao' && M.S.conn === 'eu' && AoVivo.donoAtivo()), 20000);
  await ate('som da janela pegou (helper ok)', () => A.p.evaluate(() => AoVivo.audioOk()));
  conf('titulo sem o nome do navegador', (await A.p.evaluate(() => { const a = M.achar('eu'); return a && a.titulo; })) === 'Filme teste - YouTube', await A.p.evaluate(() => { const a = M.achar('eu'); return a && a.titulo; }));
  const rec = await ate('recorte automatico achou o player', () => A.p.evaluate(() => AoVivo.recorte()), 15000);
  if (rec) {
    console.log('     recorte: ' + JSON.stringify(Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, +v.toFixed(3)]))));
    const perto = (a, b) => Math.abs(a - b) < 0.04;
    conf('recorte bate com o player (.2 .2 .6 .45)', perto(rec.x, 0.2) && perto(rec.y, 0.2) && perto(rec.w, 0.6) && perto(rec.h, 0.45), rec);
  }

  // ---- Beto watches ----
  await ate('Beto ve o cartao ao vivo', () => B.p.evaluate(() => !!document.querySelector('.card')));
  await B.p.click('.card');
  await ate('Beto entrou na sessao ao vivo', () => B.p.evaluate(() => M.S.tela === 'sessao' && M.S.conn !== null && AoVivo.assistindo()));
  await ate('WebRTC conectou', () => B.p.evaluate(() => AoVivo.conectado()), 30000);
  conf('player da fila nao toca nada', await B.p.evaluate(() => { const a = document.querySelector('audio'); return !a || (a.paused && !a.getAttribute('src')); }));
  const t = await ate('Beto recebe o tom de 440 Hz', async () => { const r = await tom(B.p, 'AoVivo.tocador'); return r.tocando && Math.abs(r.hz - 440) < 30 && r.db > -60 ? r : null; }, 20000);
  if (t) console.log('     tom: ' + JSON.stringify(t));
  await B.p.evaluate(() => AoVivo.volume(0.5, false));
  conf('volume chega no tocador ao vivo', await B.p.evaluate(() => AoVivo.tocador.volume === 0.5));

  await B.p.click('[data-act="ver-video"]');
  const V = await ate('janela de video abriu', async () => B.app.windows().find(w => /video\.html/.test(w.url())) || false, 10000) && B.app.windows().find(w => /video\.html/.test(w.url()));
  if (V) {
    const dim = await ate('video ao vivo chega na janela de video', () => V.evaluate(() => { const v = document.getElementById('v'); return v.srcObject && !v.paused && v.videoWidth > 0 ? { w: v.videoWidth, h: v.videoHeight } : null; }), 30000);
    if (dim) {
      console.log('     video: ' + dim.w + 'x' + dim.h);
      conf('video recortado (16:9 do player, nao a janela 4:3)', Math.abs(dim.w / dim.h - 16 / 9) < 0.12, dim);
    }
    // frames that reach the element (rVFC) and different pictures (pixel hash), 2 s
    const q = await V.evaluate(async () => {
      const v = document.getElementById('v'), c = new OffscreenCanvas(64, 36), g = c.getContext('2d', { willReadFrequently: true });
      let quadros = 0, ativo = true; const marcas = new Set();
      const cb = () => { quadros++; if (ativo) v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb);
      const t0 = v.currentTime;
      for (let i = 0; i < 10; i++) { g.drawImage(v, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let h = 0; for (let k = 0; k < d.length; k += 16) h = (h * 31 + d[k]) | 0; marcas.add(h); await new Promise(r => setTimeout(r, 200)); }
      ativo = false;
      // frames arriving on the track itself (independent of painting)
      let chegam = 0;
      try {
        const tr = v.srcObject.getVideoTracks()[0].clone(), rd = new MediaStreamTrackProcessor({ track: tr }).readable.getReader();
        const fim = performance.now() + 1500;
        while (performance.now() < fim) { const r = await Promise.race([rd.read(), new Promise(ok => setTimeout(() => ok(null), 500))]); if (r && r.value) { chegam++; r.value.close(); } }
        rd.cancel(); tr.stop();
      } catch (e) { chegam = 'erro ' + e.message; }
      return { quadros, imagens: marcas.size, tempo: +(v.currentTime - t0).toFixed(2), chegam, visivel: document.visibilityState };
    });
    console.log('     video em 2 s: ' + JSON.stringify(q));
    conf('video se mexe (quadros novos e imagens diferentes)', q.quadros >= 20 && q.imagens >= 5, q);
    await B.p.click('[data-act="ver-video"]').catch(() => {});
  }

  // ---- Ana stops ----
  await A.p.click('[data-act="desconectar"]');
  await ate('Beto volta para a lista quando Ana para', () => B.p.evaluate(() => M.S.tela === 'principal' && M.S.conn === null), 20000);
  await ate('cartao some', () => B.p.evaluate(() => !document.querySelector('.card')));
  await ate('Beto largou o ao vivo', () => B.p.evaluate(() => !AoVivo.assistindo() && !AoVivo.tocador.srcObject));
  await ate('Ana parou a captura', () => A.p.evaluate(() => !AoVivo.donoAtivo() && M.S.conn === null));
  console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas);
})().catch(e => { falhas++; console.log('FALHA geral: ' + (e.stack || e.message)); console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas); }).finally(async () => {
  for (const a of programas) { try { await a.close(); } catch (e) { } }
  matar(wrangler); matar(fonte); discord.close(); if (proxy) proxy.close();
  if (sandboxId) { try { execFileSync('wsb', ['stop', '--id', sandboxId], { stdio: 'ignore' }); } catch (e) { } }
  setTimeout(() => process.exit(falhas ? 1 : 0), 300);
});
