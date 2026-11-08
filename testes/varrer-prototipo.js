// Sweep of the chosen prototype at real size: overflow, clipped text, JS errors, field behavior. Usage: node testes\varrer-prototipo.js [foto folder]
const { chromium } = require('./playwright');
const path = require('path');
const url = 'file:///' + path.resolve(__dirname, '../docs/prototipos/principal/ESCOLHIDA/proposta-B.html').replace(/\\/g, '/');
const fotos = process.argv[2];
const cenas = ['login', 'entrando', 'erro-login', 'vazio', 'principal', 'carregando', 'sem-ofertas', 'sem-internet', 'etapa1', 'pedido-erro', 'menu', 'aviso', 'oferecer', 'oferecendo', 'amigos', 'pedido', 'opcoes', 'sessao', 'sem-controle', 'so-fila', 'esperando', 'erro-link', 'sem-conexao', 'enviando', 'video', 'oferecer-janela', 'janelas-vazio', 'aovivo', 'aovivo-caiu', 'aovivo-dono', 'sua-sessao', 'fila-vazia'];
const medir = () => {
  const j = document.getElementById('janela') || document.getElementById('videojan');
  const J = j.getBoundingClientRect(), o = [];
  document.querySelectorAll('#raiz *').forEach(e => {
    if (e.closest('svg') || e.closest('.tira') || e.classList.contains('luz') || e.classList.contains('sol')) return;
    const q = e.getBoundingClientRect();
    if (!q.width || !q.height) return;
    const sc = e.closest('.rola,.mio');
    if (q.right > J.right + 1 || q.left < J.left - 1) o.push('x ' + e.className);
    if (!sc && q.bottom > J.bottom + 1) o.push('y ' + e.className);
    const cs = getComputedStyle(e);
    if (!e.children.length && e.textContent.trim() && cs.overflow === 'hidden' && e.scrollWidth > e.clientWidth + 1) o.push('corte ' + e.textContent.trim().slice(0, 30));
  });
  return [...new Set(o)];
};
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 400, height: 712 } });
  const er = []; p.on('pageerror', e => er.push(e.message));
  let n = 0;
  for (const c of cenas) {
    await p.goto(url + '?foto#' + c); await p.waitForTimeout(250);
    const bad = await p.evaluate(medir);
    if (bad.length) { n++; console.log(c, bad); }
    if (fotos) await p.screenshot({ path: path.join(fotos, 'proto-' + c + '.png') });
  }
  await p.goto(url + '?foto#amigos'); await p.waitForTimeout(200);
  await p.fill('input.campo', 'abc'); await p.evaluate(() => M.desenhar());
  console.log('redesenho mantem', await p.inputValue('input.campo'), await p.evaluate(() => document.activeElement.tagName));
  await p.press('input.campo', 'Enter'); await p.waitForTimeout(100);
  console.log('enter', await p.evaluate(() => M.S.faixa), JSON.stringify(await p.inputValue('input.campo')));
  await p.click('[data-act="aceitar:duda"]'); await p.click('[data-act="cancelar:gui"]');
  console.log('sobra', await p.evaluate(() => [M.D.recebidos.length, M.D.enviados.length]));
  console.log('cenas', cenas.length, 'problemas', n, 'erros', JSON.stringify(er));
  await b.close();
})();
