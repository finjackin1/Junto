// Video window: one muted <video> kept in sync with the session clock. The sound plays in the main window.
(function () {
  const J = window.junto;
  const v = document.getElementById('v');
  v.muted = true;
  const sinc = Sincronia.criarSincronizador(v, { agora: () => J.agoraServidor() });
  let url = null, pronto = false, aovivo = false, pc = null;

  // Live share: the main window sends the friend's video over a local WebRTC link.
  function fecharAoVivo() { if (pc) { try { pc.close(); } catch (e) { /* closed */ } pc = null; } v.srcObject = null; }
  J.aoLocal(async d => {
    if (!d || !aovivo) return;
    if (d.tipo === 'fim') { fecharAoVivo(); return; }
    if (d.tipo !== 'oferta' || typeof d.sdp !== 'string') return;
    fecharAoVivo();
    const p = new RTCPeerConnection({ iceServers: [] });
    pc = p;
    p.addEventListener('track', ev => { if (pc === p) { v.srcObject = ev.streams[0] || new MediaStream([ev.track]); v.play().catch(() => {}); } });
    try {
      await p.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      await p.setLocalDescription(await p.createAnswer());
      if (p.iceGatheringState !== 'complete') await new Promise(ok => { const t = setTimeout(ok, 1000); p.addEventListener('icegatheringstatechange', () => { if (p.iceGatheringState === 'complete') { clearTimeout(t); ok(); } }); });
      if (pc === p) J.local({ tipo: 'resposta', sdp: p.localDescription.sdp });
    } catch (e) { fecharAoVivo(); }
  });

  J.aoVideo(d => {
    if (!d) return;
    if (d.aovivo) {
      if (!aovivo) { aovivo = true; url = null; pronto = false; sinc.definir(null); v.removeAttribute('src'); v.load(); J.local({ tipo: 'quero' }); }
      document.getElementById('tit').textContent = [d.titulo, 'Ao vivo'].filter(Boolean).join(' · ');
      document.title = d.titulo ? 'Junto: ' + d.titulo : 'Junto: ao vivo';
      return;
    }
    if (aovivo) { aovivo = false; fecharAoVivo(); }
    if (d.video !== url) {
      url = d.video; pronto = false;
      if (url) v.src = url; else { v.removeAttribute('src'); v.load(); }
    }
    sinc.definir(d.P, d.dur);
    document.getElementById('tit').textContent = [d.titulo, d.sub].filter(Boolean).join(' · ');
    document.title = d.titulo ? 'Junto: ' + d.titulo : 'Junto: vídeo';
  });
  // live stream: no session clock, the sync step would pause it
  v.addEventListener('loadedmetadata', () => { if (!aovivo) pronto = true; });
  setInterval(() => { if (pronto && !aovivo) sinc.passo(); }, 250);

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
  v.addEventListener('click', () => { clearTimeout(timerClique); if (!aovivo) timerClique = setTimeout(() => J.acao('tocar'), 250); });
  v.addEventListener('dblclick', () => { clearTimeout(timerClique); telaCheia(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (cheia) telaCheia(); else J.acao('fechar'); }
    else if (e.key === ' ') { e.preventDefault(); if (!aovivo) J.acao('tocar'); }
    else if (e.key === 'f' || e.key === 'F') telaCheia();
  });
})();
