// Live share (hand-written, not copied from the prototype). The dono captures ONE window (a browser): video cropped to
// the moving area, sound of that program only (app/nativo/junto-audio.exe), sent to each member with WebRTC.
// Members play the sound here (main window) and pass the video to the video window over a local WebRTC link.
// Signalling goes through the server as {t:"sinal"}; no trickle: each SDP carries its candidates (2 s gathering cap).
(function () {
  const J = window.junto;
  if (!J || !window.RTCPeerConnection) return;
  const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  // + TURN relay from our server (for friends behind strict NAT); never blocks for long
  const ice = async () => {
    const t = J.ice ? await Promise.race([J.ice(), new Promise(ok => setTimeout(() => ok([]), 6000))]).catch(() => []) : [];
    return STUN.concat(Array.isArray(t) ? t : []);
  };
  const ESPERAS = [2000, 4000, 8000, 15000, 30000];
  const novoId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
  const log = (...a) => { try { console.log('[aovivo]', ...a); } catch { /* none */ } };
  let ouvinte = () => {}; // ponte: estado changes ('audio-erro', 'fonte-fim', 'conectado', 'caiu', ...)
  const avisar = (e, x) => { try { ouvinte(e, x); } catch (err) { log('ouvinte', err); } };

  function esperarIce(pc, ms) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(ok => {
      const fim = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', ver); ok(); };
      const ver = () => { if (pc.iceGatheringState === 'complete') fim(); };
      const t = setTimeout(fim, ms);
      pc.addEventListener('icegatheringstatechange', ver);
    });
  }
  // Music, not voice: stereo Opus at a high bitrate.
  const opus = sdp => {
    const m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
    if (!m) return sdp;
    return sdp.replace(new RegExp('a=fmtp:' + m[1] + ' ([^\\r\\n]*)'), (l, p) => 'a=fmtp:' + m[1] + ' ' + p.split(';').filter(x => !/^(stereo|sprop-stereo|maxaveragebitrate)=/.test(x)).concat(['stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=192000']).join(';'));
  };
  async function ajustar(pc, videoBps) {
    for (const s of pc.getSenders()) {
      if (!s.track) continue;
      const p = s.getParameters();
      if (!p.encodings || !p.encodings.length) continue;
      if (s.track.kind === 'video') { p.encodings[0].maxBitrate = videoBps; p.encodings[0].maxFramerate = 30; p.degradationPreference = 'maintain-framerate'; } else p.encodings[0].maxBitrate = 192000;
      try { await s.setParameters(p); } catch (e) { log('parametros', e && e.message); }
    }
  }
  const enviarSinal = (para, dados) => J.enviar({ t: 'sinal', para, dados }).then(r => { if (!r || !r.ok) log('sinal recusado', dados.tipo, r && r.erro); return r; }, () => null);

  // ---------- crop: find the rectangle where the picture moves (the video player) ----------
  function criarDetector() {
    const W = 256, H = 144, CEL = 4, GW = W / CEL, GH = H / CEL;
    const tela = new OffscreenCanvas(W, H), ctx = tela.getContext('2d', { willReadFrequently: true });
    let ant = null, cont = new Uint16Array(W * H), amostras = 0;
    function zerar() { ant = null; cont = new Uint16Array(W * H); amostras = 0; }
    function amostra(frame) {
      ctx.drawImage(frame, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      if (ant) {
        for (let i = 0, p = 0; p < W * H; p++, i += 4) {
          if (Math.abs(px[i] - ant[i]) + Math.abs(px[i + 1] - ant[i + 1]) + Math.abs(px[i + 2] - ant[i + 2]) > 30) cont[p]++;
        }
        amostras++;
      }
      ant = px;
    }
    // Largest connected block of "hot" cells, edges refined per pixel row/column. Null = no clear video area.
    function resultado() {
      if (amostras < 6) return null;
      const lim = Math.max(2, Math.round(amostras * 0.25));
      const quente = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) quente[p] = cont[p] >= lim ? 1 : 0;
      const cel = new Uint8Array(GW * GH);
      for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
        let n = 0;
        for (let y = 0; y < CEL; y++) for (let x = 0; x < CEL; x++) n += quente[(gy * CEL + y) * W + gx * CEL + x];
        cel[gy * GW + gx] = n >= 4 ? 1 : 0;
      }
      const visto = new Uint8Array(GW * GH);
      let melhor = null;
      for (let i = 0; i < GW * GH; i++) {
        if (!cel[i] || visto[i]) continue;
        const pilha = [i]; visto[i] = 1;
        let n = 0, x0 = GW, y0 = GH, x1 = -1, y1 = -1;
        while (pilha.length) {
          const c = pilha.pop(), cx = c % GW, cy = (c / GW) | 0;
          n++; x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
          // 8-neighbours two cells away: a static subtitle line or a dark scene band must not split the player
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
            const k = ny * GW + nx;
            if (cel[k] && !visto[k]) { visto[k] = 1; pilha.push(k); }
          }
        }
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        if (!melhor || area > melhor.area) melhor = { area, n, x0, y0, x1, y1 };
      }
      if (!melhor || melhor.area < GW * GH * 0.04 || melhor.n < melhor.area * 0.3) return null;
      // refine: within the block (one cell of margin), keep rows/columns with enough hot pixels
      let X0 = Math.max(0, (melhor.x0 - 1) * CEL), X1 = Math.min(W - 1, (melhor.x1 + 2) * CEL - 1);
      let Y0 = Math.max(0, (melhor.y0 - 1) * CEL), Y1 = Math.min(H - 1, (melhor.y1 + 2) * CEL - 1);
      const col = x => { let n = 0; for (let y = Y0; y <= Y1; y++) n += quente[y * W + x]; return n / (Y1 - Y0 + 1); };
      const lin = y => { let n = 0; for (let x = X0; x <= X1; x++) n += quente[y * W + x]; return n / (X1 - X0 + 1); };
      while (X0 < X1 && col(X0) < 0.08) X0++;
      while (X1 > X0 && col(X1) < 0.08) X1--;
      while (Y0 < Y1 && lin(Y0) < 0.08) Y0++;
      while (Y1 > Y0 && lin(Y1) < 0.08) Y1--;
      const r = { x: X0 / W, y: Y0 / H, w: (X1 - X0 + 1) / W, h: (Y1 - Y0 + 1) / H };
      if (r.w * r.h > 0.9) return null; // the whole window moves: send it all
      return r;
    }
    return { amostra, resultado, zerar, amostras: () => amostras };
  }

  // Fractional rect -> even-aligned pixel rect inside the frame (I420/NV12 need even offsets and sizes).
  function pixels(r, fw, fh) {
    const par = v => Math.max(0, Math.floor(v / 2) * 2);
    const x = par(r.x * fw), y = par(r.y * fh);
    const w = Math.max(64, Math.min(fw - x, par(r.w * fw))), h = Math.max(64, Math.min(fh - y, par(r.h * fh)));
    if (w > fw - x || h > fh - y) return null;
    return { x, y, width: w, height: h };
  }

  // ---------- dono ----------
  const D = { ativo: false, fonte: null, bruto: null, video: null, audio: null, escritor: null, ts: 0, pcs: new Map(), recorte: null, manual: false, detector: null, ultAmostra: 0, fimDeteccao: 0, proxDeteccao: 0, audioOk: false };

  function cortar(track) {
    const proc = new MediaStreamTrackProcessor({ track });
    const ger = new MediaStreamTrackGenerator({ kind: 'video' });
    D.detector = criarDetector();
    const agora0 = performance.now();
    D.fimDeteccao = agora0 + 4000; D.proxDeteccao = 0;
    const ts = new TransformStream({
      transform(frame, ctl) {
        const t = performance.now();
        // detection: first 4 s, then a fresh 4 s pass every 20 s (page scrolled, player resized, theatre mode...)
        if (!D.manual && D.detector && t - D.ultAmostra >= 200 && (t < D.fimDeteccao || t >= D.proxDeteccao)) {
          if (t >= D.proxDeteccao && D.proxDeteccao) { D.detector.zerar(); D.fimDeteccao = t + 4000; D.proxDeteccao = 0; }
          D.ultAmostra = t;
          try { D.detector.amostra(frame); } catch (e) { log('amostra', e && e.message); }
          if (t >= D.fimDeteccao) {
            const r = D.detector.resultado();
            if (r || D.detector.amostras() > 15) { // keep the last crop when nothing moved (paused video)
              if (r) { D.recorte = r; avisar('recorte', r); }
              D.proxDeteccao = t + 20000; D.detector.zerar();
            }
          }
        }
        const r = D.recorte && pixels(D.recorte, frame.displayWidth, frame.displayHeight);
        if (!r) { ctl.enqueue(frame); return; }
        try {
          const f = new VideoFrame(frame, { visibleRect: r, displayWidth: r.width, displayHeight: r.height });
          frame.close(); ctl.enqueue(f);
        } catch (e) { ctl.enqueue(frame); }
      },
    });
    proc.readable.pipeThrough(ts).pipeTo(ger.writable).catch(e => log('corte parou', e && e.message));
    try { ger.contentHint = 'motion'; } catch { /* old */ }
    return ger;
  }

  function criarAudio() {
    const ger = new MediaStreamTrackGenerator({ kind: 'audio' });
    D.escritor = ger.writable.getWriter(); D.ts = 0;
    return ger;
  }
  J.aoAudioPcm(b => {
    if (!D.ativo || !D.escritor || !b) return;
    const u8 = new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
    const n = u8.byteLength >> 2;
    if (!n) return;
    try {
      const ad = new AudioData({ format: 's16', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: D.ts, data: u8 });
      D.ts += Math.round(n * 1e6 / 48000);
      D.escritor.write(ad).catch(() => {});
    } catch (e) { log('audio', e && e.message); }
  });
  J.aoAudioEstado(e => {
    if (!D.ativo) return;
    D.audioOk = e === 'ok';
    if (e === 'erro') avisar('audio-erro');
  });

  async function capturar(id) {
    if (!(await J.escolherFonte(id, false))) throw new Error('fonte_sumiu');
    try {
      return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false });
    } catch (e) {
      log('getDisplayMedia falhou, tentando getUserMedia', e && e.message);
      return navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 30 } } });
    }
  }

  async function comecarDono(id) {
    pararDono(false);
    const cap = await capturar(id);
    const bruto = cap.getVideoTracks()[0];
    if (!bruto) throw new Error('sem_video');
    try { bruto.contentHint = 'motion'; } catch { /* old */ }
    Object.assign(D, { ativo: true, fonte: id, bruto, recorte: null, manual: false, audioOk: false });
    D.video = cortar(bruto);
    D.audio = criarAudio();
    bruto.addEventListener('ended', () => { if (D.bruto === bruto) avisar('fonte-fim'); });
    J.audio('iniciar');
  }

  function fecharPc(de, avisarFim) {
    const e = D.pcs.get(de);
    if (!e) return;
    D.pcs.delete(de);
    try { e.pc.close(); } catch { /* closed */ }
    if (avisarFim) enviarSinal(de, { tipo: 'fim', id: e.id });
  }

  async function aoQuero(de, id) {
    if (!D.ativo) { enviarSinal(de, { tipo: 'fim', id }); return; }
    fecharPc(de, false);
    const servidores = await ice();
    if (!D.ativo) { enviarSinal(de, { tipo: 'fim', id }); return; }
    fecharPc(de, false); // a newer "quero" may have raced in while waiting
    const pc = new RTCPeerConnection({ iceServers: servidores });
    const ent = { pc, id };
    D.pcs.set(de, ent);
    const fluxo = new MediaStream([D.video, D.audio].filter(Boolean));
    for (const t of fluxo.getTracks()) pc.addTrack(t, fluxo);
    pc.addEventListener('connectionstatechange', () => {
      log('dono pc', de, pc.connectionState);
      if (pc.connectionState === 'failed' && D.pcs.get(de) === ent) fecharPc(de, false);
    });
    try {
      const of = await pc.createOffer();
      await pc.setLocalDescription({ type: 'offer', sdp: opus(of.sdp) });
      await esperarIce(pc, 2000);
      if (D.pcs.get(de) !== ent) return;
      const sdp = pc.localDescription.sdp;
      if (sdp.length > 15000) { log('sdp grande demais', sdp.length); fecharPc(de, true); return; }
      enviarSinal(de, { tipo: 'oferta', id, sdp });
    } catch (e) { log('oferta falhou', e && e.message); fecharPc(de, true); }
  }

  async function aoResposta(de, id, sdp) {
    const e = D.pcs.get(de);
    if (!e || e.id !== id || typeof sdp !== 'string') return;
    try {
      await e.pc.setRemoteDescription({ type: 'answer', sdp });
      await ajustar(e.pc, 6000000);
    } catch (err) { log('resposta falhou', err && err.message); fecharPc(de, true); }
  }

  function pararDono(avisarTodos = true) {
    const estava = D.ativo;
    D.ativo = false;
    for (const de of [...D.pcs.keys()]) fecharPc(de, avisarTodos);
    if (estava) J.audio('parar');
    for (const t of [D.bruto, D.video, D.audio]) { try { if (t) t.stop(); } catch { /* stopped */ } }
    if (D.escritor) { try { D.escritor.close().catch(() => {}); } catch { /* closed */ } }
    Object.assign(D, { fonte: null, bruto: null, video: null, audio: null, escritor: null, recorte: null, detector: null });
    if (estava) J.escolherFonte(null);
  }

  // ---------- member ----------
  const E = { dono: null, id: null, pc: null, timer: null, tent: 0, fluxo: null, audio: null, querVideo: false };
  const tocador = document.createElement('audio');
  tocador.autoplay = true; // kept out of the page: plays detached, and the page has a single <audio> (the queue player)
  let vol = 1, mudo = false;
  function volume(v, m) { vol = v; mudo = m; tocador.volume = v; tocador.muted = m; }

  function fecharEsp() {
    clearTimeout(E.timer); E.timer = null;
    if (E.pc) { try { E.pc.close(); } catch { /* closed */ } }
    E.pc = null; E.fluxo = null;
    tocador.srcObject = null;
    videoLocal(null);
  }

  function tentarDeNovo() {
    clearTimeout(E.timer);
    if (!E.dono) return;
    const ms = ESPERAS[Math.min(E.tent, ESPERAS.length - 1)];
    E.tent++;
    E.timer = setTimeout(() => { E.timer = null; pedir(); }, ms);
  }

  function pedir() {
    if (!E.dono) return;
    fecharEsp();
    E.id = novoId();
    enviarSinal(E.dono, { tipo: 'quero', id: E.id });
    E.timer = setTimeout(() => { E.timer = null; avisar('caiu'); tentarDeNovo(); }, 10000); // no offer: dono busy or gone
  }

  async function aoOferta(de, id, sdp) {
    if (de !== E.dono || id !== E.id || typeof sdp !== 'string') return;
    clearTimeout(E.timer); E.timer = null;
    const servidores = await ice();
    if (de !== E.dono || id !== E.id) return; // left or restarted while waiting
    const pc = new RTCPeerConnection({ iceServers: servidores });
    E.pc = pc;
    pc.addEventListener('track', ev => {
      if (E.pc !== pc) return;
      E.fluxo = ev.streams[0] || new MediaStream([ev.track]);
      const a = E.fluxo.getAudioTracks();
      tocador.srcObject = a.length ? new MediaStream(a) : null;
      tocador.volume = vol; tocador.muted = mudo;
      tocador.play().catch(() => {});
      const v = E.fluxo.getVideoTracks()[0];
      if (v) videoLocal(E.querVideo ? v : null, v);
    });
    let caiuEm = null;
    pc.addEventListener('connectionstatechange', () => {
      if (E.pc !== pc) return;
      const s = pc.connectionState;
      log('membro pc', s);
      if (s === 'connected') { E.tent = 0; clearTimeout(caiuEm); avisar('conectado'); }
      else if (s === 'failed') { avisar('caiu'); tentarDeNovo(); }
      else if (s === 'disconnected') { clearTimeout(caiuEm); caiuEm = setTimeout(() => { if (E.pc === pc && pc.connectionState !== 'connected') { avisar('caiu'); tentarDeNovo(); } }, 5000); }
    });
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const r = await pc.createAnswer();
      await pc.setLocalDescription({ type: 'answer', sdp: opus(r.sdp) });
      await esperarIce(pc, 2000);
      if (E.pc !== pc) return;
      enviarSinal(de, { tipo: 'resposta', id, sdp: pc.localDescription.sdp });
      E.timer = setTimeout(() => { E.timer = null; if (E.pc === pc && pc.connectionState !== 'connected') { avisar('caiu'); tentarDeNovo(); } }, 15000);
    } catch (e) { log('resposta falhou', e && e.message); tentarDeNovo(); }
  }

  function assistir(dono) {
    if (E.dono === dono) return;
    sairEsp();
    E.dono = dono; E.tent = 0;
    pedir();
  }
  function sairEsp() {
    if (E.dono && E.id) enviarSinal(E.dono, { tipo: 'fim', id: E.id });
    E.dono = null; E.id = null; E.tent = 0;
    fecharEsp();
  }

  // ---------- member: video to the video window (local link, no STUN) ----------
  const L = { pc: null, track: null };
  let videoAtual = null; // remote video track, kept even while the video window is closed
  function videoLocal(track, remoto) {
    if (remoto !== undefined) videoAtual = remoto;
    if (track === L.track && L.pc) return;
    if (L.pc) { try { L.pc.close(); } catch { /* closed */ } L.pc = null; }
    L.track = track;
    if (!track) { J.local({ tipo: 'fim' }); return; }
    ofertaLocal();
  }
  async function ofertaLocal() {
    const t = L.track;
    if (!t) return;
    if (L.pc) { try { L.pc.close(); } catch { /* closed */ } }
    const pc = new RTCPeerConnection({ iceServers: [] });
    L.pc = pc;
    pc.addTrack(t, new MediaStream([t]));
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await esperarIce(pc, 1000);
      if (L.pc === pc) J.local({ tipo: 'oferta', sdp: pc.localDescription.sdp });
    } catch (e) { log('local oferta', e && e.message); }
  }
  J.aoLocal(d => {
    if (!d) return;
    if (d.tipo === 'quero') { if (L.track) ofertaLocal(); }
    else if (d.tipo === 'resposta' && L.pc && typeof d.sdp === 'string') {
      const pc = L.pc;
      pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).then(() => ajustar(pc, 40000000)).catch(e => log('local resposta', e && e.message));
    }
  });
  function mostrarVideo(sim) {
    E.querVideo = !!sim;
    videoLocal(sim ? videoAtual : null);
  }

  // ---------- signals from the server ----------
  J.aoSinal(s => {
    if (!s || typeof s.de !== 'string' || !s.dados) return;
    const d = s.dados;
    if (d.tipo === 'quero') aoQuero(s.de, d.id);
    else if (d.tipo === 'resposta') aoResposta(s.de, d.id, d.sdp);
    else if (d.tipo === 'oferta') aoOferta(s.de, d.id, d.sdp);
    else if (d.tipo === 'fim') {
      if (D.pcs.has(s.de)) { const e = D.pcs.get(s.de); if (!d.id || e.id === d.id) fecharPc(s.de, false); }
      if (s.de === E.dono && (!d.id || d.id === E.id)) { fecharEsp(); tentarDeNovo(); } // dono restarted capture or lost me: ask again
    }
  });

  // Members that left the session: drop their links.
  function gente(ids) {
    const fica = new Set(ids || []);
    for (const de of [...D.pcs.keys()]) if (!fica.has(de)) fecharPc(de, false);
  }

  // Window title without the browser's name ("Song - YouTube - Brave" -> "Song - YouTube").
  function tituloLimpo(nome, navegador) {
    let t = String(nome || '').trim();
    if (navegador) t = t.replace(/\s+[-—–]\s+[^-—–]+$/, '').replace(/\s+e mais \d+ (página|guia|aba)s?$/i, '').replace(/\s+and \d+ more pages?$/i, '');
    return t.slice(0, 200);
  }

  window.AoVivo = {
    aoEstado: cb => { ouvinte = typeof cb === 'function' ? cb : () => {}; },
    fontes: () => J.fontes(),
    tituloLimpo,
    comecarDono, pararDono,
    donoAtivo: () => D.ativo,
    audioOk: () => D.audioOk,
    recorte: () => D.recorte,
    // r = {x,y,w,h} fractions, or null to go back to automatic
    definirRecorte: r => { if (r) { D.manual = true; D.recorte = r; } else { D.manual = false; D.recorte = null; if (D.detector) D.detector.zerar(); D.fimDeteccao = performance.now() + 4000; D.proxDeteccao = 0; } },
    gente,
    assistir, sairEsp,
    assistindo: () => E.dono,
    conectado: () => !!(E.pc && E.pc.connectionState === 'connected'),
    tocador, // the detached live <audio> (tests read it)
    mostrarVideo,
    volume,
    pararTudo: () => { pararDono(true); sairEsp(); },
  };
})();
