// Video window: one muted <video> kept in sync with the session clock. The sound plays in the main window.
(function () {
  const J = window.junto;
  const v = document.getElementById('v');
  v.muted = true;
  const sinc = Sincronia.criarSincronizador(v, { agora: () => J.agoraServidor() });
  let url = null, pronto = false;

  J.aoVideo(d => {
    if (!d) return;
    if (d.video !== url) {
      url = d.video; pronto = false;
      if (url) v.src = url; else { v.removeAttribute('src'); v.load(); }
    }
    sinc.definir(d.P, d.dur);
    document.getElementById('tit').textContent = [d.titulo, d.sub].filter(Boolean).join(' · ');
    document.title = d.titulo ? 'Junto: ' + d.titulo : 'Junto: vídeo';
  });
  v.addEventListener('loadedmetadata', () => { pronto = true; });
  setInterval(() => { if (pronto) sinc.passo(); }, 250);

  document.getElementById('x').addEventListener('click', e => { e.stopPropagation(); J.acao('fechar'); });
  let timerClique = null, cheia = false;
  const telaCheia = () => { clearTimeout(timerClique); J.acao('telacheia'); };
  const tc = document.getElementById('tc');
  tc.addEventListener('click', e => { e.stopPropagation(); telaCheia(); });
  J.aoTelaCheia(f => {
    cheia = f; document.body.classList.toggle('cheia', f);
    tc.title = f ? 'Sair da tela cheia (F ou Esc)' : 'Tela cheia (F ou clique duplo)';
    tc.setAttribute('aria-label', f ? 'Sair da tela cheia' : 'Tela cheia');
  });
  // Single click = play/pause, double click = fullscreen; wait so a double click doesn't toggle play twice.
  v.addEventListener('click', () => { clearTimeout(timerClique); timerClique = setTimeout(() => J.acao('tocar'), 250); });
  v.addEventListener('dblclick', () => { clearTimeout(timerClique); telaCheia(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (cheia) telaCheia(); else J.acao('fechar'); }
    else if (e.key === ' ') { e.preventDefault(); J.acao('tocar'); }
    else if (e.key === 'f' || e.key === 'F') telaCheia();
  });
})();
