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
  v.addEventListener('click', () => J.acao('tocar'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') J.acao('fechar');
    else if (e.key === ' ') { e.preventDefault(); J.acao('tocar'); }
    else if (e.key === 'f' || e.key === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  });
})();
