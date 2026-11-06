// Stage 1 end to end: two real Junto programs, real local server runtime, fake Discord that checks PKCE.
// Off screen, isolated data folders. Usage: node testes\e2e-etapa1.js [photo folder]
const { _electron } = require('A:/opt/node/node_modules/@playwright/cli/node_modules/playwright');
const http = require('http'), crypto = require('crypto'), net = require('net'), os = require('os'), path = require('path'), fs = require('fs');
const { spawn, execSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const appDir = path.join(raiz, 'app');
const electron = path.join(appDir, 'node_modules/electron/dist/electron.exe');
const fotos = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junto-e2e-'));
const espera = ms => new Promise(r => setTimeout(r, ms));
const livre = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

let ok = 0, falhas = 0, cspEsperado = false;
const conf = (nome, cond, extra) => { if (cond) { ok++; console.log('ok   ' + nome); } else { falhas++; console.log('FALHA ' + nome + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function ate(nome, f, ms = 15000) {
  const fim = Date.now() + ms; let v;
  while (Date.now() < fim) { try { v = await f(); if (v) { conf(nome, true); return v; } } catch (e) { v = e.message; } await espera(150); }
  conf(nome, false, v); return null;
}

const CONTAS = {
  ana: { id: '111111111111111111', username: 'ana', global_name: 'Ana Souza', avatar: null },
  beto: { id: '222222222222222222', username: 'beto', global_name: 'Beto', avatar: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  hack: { id: '333333333333333333', username: 'hack', global_name: '<img src=x onerror="window.__xss=1">|"z', avatar: null },
};
const desafios = new Map(); let pkceRuim = 0, comSegredo = 0, respostaDiscord = null, semAgente = 0;
const discord = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/') && !req.headers['user-agent']) semAgente++;
  if (u.pathname.startsWith('/authorize/')) {
    const conta = u.pathname.split('/')[2];
    const code = 'codigo-' + conta + '-' + crypto.randomBytes(4).toString('hex');
    desafios.set(code, { conta, desafio: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri') });
    const volta = new URL(u.searchParams.get('redirect_uri'));
    if (conta === 'negado') volta.searchParams.set('error', 'access_denied'); else volta.searchParams.set('code', code);
    volta.searchParams.set('state', u.searchParams.get('state'));
    res.writeHead(302, { Location: volta.toString() }); return res.end();
  }
  let corpo = ''; req.on('data', d => corpo += d); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (respostaDiscord) { res.statusCode = respostaDiscord; return res.end('{}'); }
    if (u.pathname.endsWith('/oauth2/token')) {
      const p = new URLSearchParams(corpo), d = desafios.get(p.get('code'));
      if (p.has('client_secret')) comSegredo++;
      const calc = d && crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url');
      if (!d || calc !== d.desafio || p.get('redirect_uri') !== d.redirect) { pkceRuim++; res.statusCode = 400; return res.end('{"error":"invalid_grant"}'); }
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

async function abrir(conta, portaS, portaD) {
  const dados = path.join(tmp, conta); fs.mkdirSync(dados, { recursive: true });
  const app = await _electron.launch({
    executablePath: electron,
    args: ['--user-data-dir=' + dados, appDir],
    env: { ...process.env, JUNTO_SERVIDOR: 'http://127.0.0.1:' + portaS, JUNTO_DISCORD_CLIENT_ID: 'teste', JUNTO_DISCORD_AUTORIZAR: 'http://127.0.0.1:' + portaD + '/authorize/' + conta, JUNTO_DADOS: dados, JUNTO_SEM_NAVEGADOR: '1', JUNTO_OCULTO: '1' },
  });
  const p = await app.firstWindow();
  p.on('pageerror', e => { falhas++; console.log('FALHA erro JS ' + conta + ': ' + e.message); });
  p.on('console', m => { if (m.type() === 'error' && !cspEsperado && !/cdn\.discordapp|ERR_|Failed to load/.test(m.text())) { falhas++; console.log('FALHA console ' + conta + ': ' + m.text()); } });
  await p.waitForSelector('#janela', { timeout: 15000 });
  programas.push(app);
  return { app, p, conta };
}
const texto = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
const nomes = p => p.evaluate(() => [...document.querySelectorAll('.pess')].map(e => e.textContent.trim()));
// Every photographed state is also measured, after animations settle. A long hostile name is cut on purpose.
const foto = async (p, n) => {
  await p.waitForTimeout(450);
  const m = (await medir(p)).filter(x => !(n === 'nome-hostil' && x.startsWith('corte')));
  conf('sem corte: ' + n, m.length === 0, m);
  if (fotos) await p.screenshot({ path: path.join(fotos, 'app-' + n + '.png') });
};
const medir = p => p.evaluate(() => {
  const j = document.getElementById('janela'); const J = j.getBoundingClientRect(), o = [];
  document.querySelectorAll('#raiz *').forEach(e => {
    if (e.closest('svg') || e.closest('.tira')) return;
    const q = e.getBoundingClientRect(); if (!q.width || !q.height) return;
    if (q.right > J.right + 1 || q.left < J.left - 1) o.push('x ' + e.className);
    if (!e.closest('.rola,.mio') && q.bottom > J.bottom + 1) o.push('y ' + e.className);
    if (!e.children.length && e.textContent.trim() && getComputedStyle(e).overflow === 'hidden' && e.scrollWidth > e.clientWidth + 1) o.push('corte ' + e.textContent.trim().slice(0, 30));
  });
  return [...new Set(o)];
});
const entrar = async (A, n) => { await A.p.click('[data-act="entrar"]'); return ate(n + ' entrou e saiu do login', async () => A.p.evaluate(() => M.S.tela === 'principal' && !M.S.carregando)); };

(async () => {
  await new Promise(r => discord.listen(0, '127.0.0.1', r));
  const portaD = discord.address().port, portaS = await livre();
  const persist = path.join(tmp, 'servidor');
  conf('servidor local subiu', await subirServidor(portaS, portaD, persist));

  // 1. login, sizes
  const A = await abrir('ana', portaS, portaD);
  const tam = await A.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { b: w.getContentBounds(), res: w.isResizable(), max: w.isMaximizable() }; });
  conf('janela 400x712 fixa', tam.b.width === 400 && tam.b.height === 712 && !tam.res && !tam.max, tam);
  conf('abre no login sem sessao', await A.p.evaluate(() => M.S.tela === 'login'));
  conf('janela fora da tela no teste', await A.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().x < -1000));
  cspEsperado = true;
  conf('script embutido bloqueado pela CSP', await A.p.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__csp=1'; document.head.appendChild(s); s.remove(); return !window.__csp; }));
  conf('imagem de fora bloqueada pela CSP', await A.p.evaluate(() => new Promise(r => { document.addEventListener('securitypolicyviolation', e => { if (e.effectiveDirective === 'img-src') r(true); }); const i = new Image(); i.src = 'http://127.0.0.1:9/x.png'; setTimeout(() => r(false), 1500); })));
  conf('window.open negado', await A.p.evaluate(() => window.open('https://example.com') === null));
  cspEsperado = false;
  await foto(A.p, 'login');
  await entrar(A, 'Ana');
  conf('PKCE conferido, sem segredo', pkceRuim === 0 && comSegredo === 0, { pkceRuim, comSegredo });
  await ate('sem amigos mostra vazio', () => texto(A.p, '.centro .tit').then(t => t === 'Ninguém por aqui ainda'));
  await foto(A.p, 'vazio');
  conf('sessao nao chega na tela', await A.p.evaluate(() => !JSON.stringify(Object.keys(window.junto)).includes('token') && !document.documentElement.outerHTML.includes('tok-')));
  conf('Disponibilizar ligado na etapa 2', await A.p.evaluate(() => !!document.querySelector('.flut:not(.desl)')));

  // 2. request to someone who has never opened Junto, by name
  await A.p.click('[data-act="camada:amigos"]');
  await A.p.fill('input.campo', '<x>');
  await A.p.press('input.campo', 'Enter');
  await ate('nome invalido avisa', () => texto(A.p, '.faixa.erro').then(t => t && t.includes('não parece')));
  conf('nome invalido mantem texto', await A.p.inputValue('input.campo') === '<x>');
  await foto(A.p, 'pedido-erro');
  await A.p.fill('input.campo', 'ana');
  await A.p.click('[data-act="pedir"]');
  await ate('proprio nome avisa', () => texto(A.p, '.faixa.erro').then(t => t && t.includes('próprio')));
  await A.p.fill('input.campo', '@Beto');
  await A.p.press('input.campo', 'Enter');
  await ate('pedido enviado limpa campo', async () => (await texto(A.p, '.faixa') || '').includes('Pedido enviado') && await A.p.inputValue('input.campo') === '');
  await ate('aparece em Enviados', () => A.p.evaluate(() => M.D.enviados.some(e => e.usuario === 'beto')));
  await foto(A.p, 'pedido-enviado');

  // 3. second program receives it after first login
  const B = await abrir('beto', portaS, portaD);
  await entrar(B, 'Beto');
  await ate('Beto recebe pedido de Ana', () => B.p.evaluate(() => M.D.recebidos.some(r => r.nome === 'Ana Souza')));
  await B.p.click('[data-act="camada:amigos"]');
  await B.p.waitForSelector('[data-act^="aceitar:"]');
  await foto(B.p, 'pedido-recebido');
  conf('Disponibilizar ligado no segundo programa', await B.p.evaluate(() => !!document.querySelector('.flut:not(.desl)')));
  // typing survives a push from the server
  await B.p.fill('input.campo', 'digitando');
  await A.p.evaluate(() => window.junto.enviar({ t: 'pedir', usuario: 'outra.pessoa' }));
  await A.p.evaluate(() => window.junto.enviar({ t: 'cancelar', usuario: 'outra.pessoa' }));
  await B.p.click('[data-act^="aceitar:"]');
  await ate('Ana ve Beto online', async () => (await nomes(A.p)).includes('Beto') && await A.p.evaluate(() => M.AMIGOS[0].est === 'on'));
  await ate('Beto ve Ana online', async () => (await nomes(B.p)).includes('Ana Souza'.slice(0, 20)) || await B.p.evaluate(() => M.AMIGOS.some(a => a.nome === 'Ana Souza' && a.est === 'on')));
  conf('campo digitado sobrevive a atualizacao', await B.p.inputValue('input.campo') === 'digitando');
  await A.p.keyboard.press('Escape'); await B.p.keyboard.press('Escape');
  await ate('folha fecha com Esc', () => A.p.evaluate(() => M.S.camada === null));
  await A.p.waitForTimeout(400);
  await foto(A.p, 'amigo-online');
  conf('foto do Discord aplicada', await A.p.evaluate(() => /cdn\.discordapp\.com\/avatars\/222222222222222222\/a{32}\.png/.test(document.querySelector('.pess .av').style.background)));
  conf('layout principal sem corte', (await medir(A.p)).length === 0, await medir(A.p));

  // 4. presence
  await B.app.close(); programas.splice(programas.indexOf(B.app), 1);
  await ate('Beto fechou: Ana ve offline', () => A.p.evaluate(() => M.AMIGOS.length === 1 && M.AMIGOS[0].est === 'off'));
  await foto(A.p, 'amigo-offline');

  // 5. hostile name
  const H = await abrir('hack', portaS, portaD);
  await entrar(H, 'Conta com nome hostil');
  await H.p.evaluate(() => window.junto.enviar({ t: 'pedir', usuario: 'ana' }));
  await ate('nome hostil chega como texto', () => A.p.evaluate(() => M.D.recebidos.length === 1));
  await A.p.click('[data-act="camada:amigos"]');
  await A.p.waitForTimeout(300);
  conf('nome hostil nao vira HTML', await A.p.evaluate(() => !window.__xss && !document.querySelector('#raiz img') && document.querySelector('.pedido b').textContent.includes('<img')));
  await A.p.hover('[data-act^="aceitar:"]'); await A.p.waitForTimeout(800);
  conf('dica mostra nome como texto', await A.p.evaluate(() => !window.__xss && !document.querySelector('#dica img') && document.querySelector('#dica').textContent.includes('<img')));
  await A.p.mouse.move(5, 5);
  await foto(A.p, 'nome-hostil');
  await A.p.click('[data-act^="recusar:"]');
  await ate('recusar some da lista', () => A.p.evaluate(() => M.D.recebidos.length === 0));
  await A.p.keyboard.press('Escape');
  await H.app.close(); programas.splice(programas.indexOf(H.app), 1);

  // 6. connection loss and return
  encerrarServidor();
  await ate('sem servidor avisa', () => A.p.evaluate(() => M.S.offline === true), 40000);
  await A.p.waitForTimeout(300);
  await foto(A.p, 'sem-conexao');
  conf('layout sem conexao sem corte', (await medir(A.p)).length === 0, await medir(A.p));
  await A.p.evaluate(() => window.junto.enviar({ t: 'cancelar', usuario: 'x' }).catch(e => e)).catch(() => { });
  conf('servidor voltou', await subirServidor(portaS, portaD, persist));
  await ate('reconecta sozinho, dados mantidos', () => A.p.evaluate(() => M.S.offline === false && M.AMIGOS.some(a => a.nome === 'Beto')), 60000);

  // 7. options persist, session survives restart, menu removes friend
  await A.p.click('[data-act="camada:opcoes"]');
  await foto(A.p, 'opcoes');
  conf('nome real em Opcoes', (await texto(A.p, '.mio .pedido b')) === 'Ana Souza');
  await A.p.click('[data-act="opc:win"]'); // off by default; turning it on reveals 'min'
  await A.p.click('[data-act="opc:min"]');
  await A.p.waitForTimeout(200);
  await A.p.keyboard.press('Escape');
  await A.app.close(); programas.splice(programas.indexOf(A.app), 1);
  const A2 = await abrir('ana', portaS, portaD);
  await ate('sessao lembrada ao reabrir', () => A2.p.evaluate(() => M.S.tela === 'principal' && !M.S.carregando && M.AMIGOS.length === 1));
  await ate('opcao lembrada ao reabrir', () => A2.p.evaluate(() => M.S.opc.min === true && M.S.opc.win === true));
  await A2.p.waitForTimeout(300);
  await A2.p.click('.pess');
  await A2.p.waitForSelector('.menu');
  await foto(A2.p, 'menu');
  await A2.p.click('[data-act^="remover:"]');
  await ate('remover amigo volta a vazio', () => A2.p.evaluate(() => M.AMIGOS.length === 0 && M.S.vazio));

  // 8. close button, sair
  const hold = async (ms) => { const b = await A2.p.locator('[data-act="fechar"]').boundingBox(); await A2.p.mouse.move(b.x + 10, b.y + 10); await A2.p.mouse.down(); await A2.p.waitForTimeout(ms); };
  await hold(60); await A2.p.mouse.up();
  await ate('clique no X vai para a bandeja', () => A2.app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible()));
  await A2.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].showInactive(); });
  await A2.p.waitForTimeout(200);
  await A2.p.click('[data-act="camada:opcoes"]');
  const sessaoVelha = fs.readFileSync(path.join(tmp, 'ana', 'sessao.bin'));
  await A2.p.click('[data-act="sair-conta"]');
  await ate('sair volta ao login', () => A2.p.evaluate(() => M.S.tela === 'login'));
  await A2.p.waitForTimeout(500);
  conf('arquivo de sessao apagado', !fs.existsSync(path.join(tmp, 'ana', 'sessao.bin')));
  const log = fs.readFileSync(path.join(tmp, 'ana', 'junto.log'), 'utf8');
  conf('log sem token nem codigo', !/tok-|codigo-/.test(log));

  // 9. login errors
  respostaDiscord = 500;
  await A2.p.click('[data-act="entrar"]');
  await ate('Discord fora mostra erro', () => A2.p.evaluate(() => M.S.tela === 'erro-login'), 20000);
  await foto(A2.p, 'erro-login');
  respostaDiscord = null;
  const closer = A2.app.waitForEvent('close');
  await hold(1200).catch(() => { }); // the page dies during the hold: that is the expected result
  await closer; programas.splice(programas.indexOf(A2.app), 1);
  conf('segurar X sai do programa', true);

  // Session the server no longer accepts: the screen must not stay on "carregando".
  fs.writeFileSync(path.join(tmp, 'ana', 'sessao.bin'), sessaoVelha);
  const V = await abrir('ana', portaS, portaD);
  await ate('sessao vencida volta ao login', () => V.p.evaluate(() => M.S.tela === 'login'));
  await ate('sessao vencida apaga o arquivo', () => !fs.existsSync(path.join(tmp, 'ana', 'sessao.bin')));
  await V.app.close(); programas.splice(programas.indexOf(V.app), 1);
  conf('Discord recebeu User-Agent', semAgente === 0, semAgente);

  const N = await abrir('negado', portaS, portaD);
  await N.p.click('[data-act="entrar"]');
  await ate('recusar no Discord volta ao login sem erro', () => N.p.evaluate(() => M.S.tela === 'login'));
  await N.app.close(); programas.splice(programas.indexOf(N.app), 1);

  console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas);
})().catch(e => { falhas++; console.log('FALHA geral: ' + (e.stack || e.message)); console.log('\nRESULTADO ok=' + ok + ' falhas=' + falhas); }).finally(async () => {
  for (const a of programas) { try { await a.close(); } catch (e) { } }
  encerrarServidor(); discord.close();
  setTimeout(() => process.exit(falhas ? 1 : 0), 300);
});
