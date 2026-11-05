// Relogio e sincronizador de reprodução (puro). Roda no renderer (window.Sincronia) ou via require.
(function (raiz) {
  function criarRelogio(local) {
    const hora = local || (() => Date.now());
    let amostras = [];
    let offset = 0;
    return {
      // c = hora local ao enviar, s = hora do servidor, agoraLocal = hora local ao receber
      amostra(c, s, agoraLocal) {
        const rtt = agoraLocal - c;
        if (!(rtt >= 0)) return;
        amostras.push({ rtt, off: s - (c + rtt / 2) });
        if (amostras.length > 8) amostras = amostras.slice(-8);
        let melhor = amostras[0];
        for (const a of amostras) if (a.rtt < melhor.rtt) melhor = a;
        offset = melhor.off;
      },
      agora() { return hora() + offset; },
      get offset() { return offset; },
    };
  }

  function posicaoAgora(P, agoraServidor) {
    if (!P) return 0;
    return P.pos + (P.tocando ? (agoraServidor - P.base) / 1000 : 0);
  }

  function criarSincronizador(el, opc) {
    const o = opc || {};
    const agora = o.agora || (() => Date.now());
    const log = o.log || (() => {});
    let P = null, dur = null;

    function pausar() { if (!el.paused) el.pause(); }

    return {
      definir(novoP, d) { P = novoP || null; dur = typeof d === 'number' ? d : null; },
      passo() {
        if (!P || P.item == null) { pausar(); return; }
        let alvo = posicaoAgora(P, agora());
        if (dur != null && alvo > dur) alvo = dur;
        if (alvo < 0) {
          pausar();
          if (Math.abs(el.currentTime) > 0.04) el.currentTime = 0;
          el.playbackRate = 1;
          return;
        }
        const drift = el.currentTime - alvo;
        const ad = Math.abs(drift);
        if (!P.tocando) {
          pausar();
          if (ad > 0.04) el.currentTime = alvo;
          el.playbackRate = 1;
          return;
        }
        if (ad > 0.5) {
          el.currentTime = alvo + 0.15;
          el.playbackRate = 1;
          log('seek', drift);
        } else if (ad >= 0.04) {
          el.playbackRate = 1 - Math.sign(drift) * Math.min(0.1, ad);
        } else {
          el.playbackRate = 1;
        }
        if (el.paused) {
          try {
            const r = el.play();
            if (r && typeof r.catch === 'function') r.catch((e) => log('play', e));
          } catch (e) { log('play', e); }
        }
      },
    };
  }

  const Relogio = criarRelogio();
  const api = { criarRelogio, Relogio, posicaoAgora, criarSincronizador };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.Sincronia = api;
})(typeof window !== 'undefined' ? window : null);
