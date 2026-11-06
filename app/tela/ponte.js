// Bridge between the screen copied from the prototype and the program (docs/contexto/protocolo.md, App bridge).
// Without window.junto (photo comparison against the prototype) it does nothing and the sample data stays.
(function () {
  const J = window.junto;
  if (!J) return;
  const { S, AMIGOS, EU, D, CENAS } = M;

  // Stage 2: offers on. Friend notice arrives at stage 4.
  D.F.oferta = true; D.F.avisoAmigo = false; S.etapa1 = false;
  D.recebidos.length = 0; D.enviados.length = 0; AMIGOS.length = 0;
  EU.conta = ''; EU.letra = '';
  CENAS.principal = { tela: 'principal', carregando: true };

  const CORES = ['#FF9E80', '#8FD3FF', '#B8F5A8', '#FFD580', '#E5B8FF', '#FFB3C7', '#A8E6DD', '#C8D1FF', '#FFC4A3'];
  const cor = t => { let h = 0; for (const c of String(t)) h = (h * 31 + c.codePointAt(0)) >>> 0; return CORES[h % CORES.length]; };
  // Everything from the server is text: names can hold any character, including HTML and the tooltip separator.
  const esc = t => String(t == null ? '' : t).replace(/\|/g, '¦').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const letra = t => esc(([...String(t || '?')][0] || '?').toUpperCase());
  const foto = (id, av) => (/^\d+$/.test(id || '') && /^(a_)?[0-9a-f]{32}$/.test(av || '')) ? `https://cdn.discordapp.com/avatars/${id}/${av}.png?size=96` : null;
  const pessoa = u => ({ nome: esc(u.nome || u.usuario), usuario: esc(u.usuario), letra: letra(u.nome || u.usuario), cor: cor(u.id || u.usuario), foto: foto(u.id, u.avatar) });

  const ERROS_LOGIN = {
    discord_fora: 'O Discord não respondeu. Confira sua internet e tente de novo.',
    discord_recusou: 'O Discord recusou a entrada. Tente de novo.',
    porta_ocupada: 'Outro programa está usando a porta do login. Feche-o e tente de novo.',
    tempo_esgotado: 'O tempo para confirmar acabou. Tente de novo.',
    sem_config: 'Este Junto ainda não tem servidor configurado.',
  };
  const ERROS_PEDIDO = {
    nome_invalido: 'Esse nome não parece um usuário do Discord. Confira e tente de novo.',
    voce_mesmo: 'Esse é o seu próprio usuário.',
    ja_amigos: 'Vocês já são amigos.',
    muitos_pedidos: 'Muitos pedidos sem resposta. Cancele algum para enviar outro.',
    sem_conexao: 'Sem conexão agora. Tente de novo em instantes.',
  };
  const erroPedido = e => { S.faixa = 'pedido-erro'; S.faixaTxt = ERROS_PEDIDO[e] || ERROS_PEDIDO.sem_conexao; };

  // ---------- stage 2: session, local playback ----------
  const Sin = window.Sincronia;
  const CAMPOS_EU = ['tipo', 'modo', 'titulo', 'sub', 'arte', 'dur', 'pos', 'gente', 'fila'];
  let ultEstado = null, ultSessao = null, meuId = null;
  let item = null, itemTipo = null, carregado = false, midiaAtual = null, seq = 0, fimEm = 0, timerFaixa = null, timerTenta = null, adicionando = false;
  const ESPERAS = [2000, 5000, 10000]; // silent retries when resolving the current item fails transiently

  // The prototype's 1 s tick (pulso) also writes S.pos; here the position comes from the server clock, so only we may write it.
  let posVal = 0, escrevendo = false;
  Object.defineProperty(S, 'pos', { get: () => posVal, set: v => { if (escrevendo) posVal = v; }, configurable: true, enumerable: true });
  const setPos = v => { escrevendo = true; S.pos = v; escrevendo = false; };

  const audio = document.createElement('audio');
  audio.preload = 'auto';
  document.body.appendChild(audio); // no controls: never drawn, and outside #raiz so redraws keep it
  // Volume: local to this PC, remembered between runs. Button = mute, mouse wheel on it = 5% steps.
  const volSalvo = Number(localStorage.getItem('junto.vol'));
  S.vol = Number.isFinite(volSalvo) && localStorage.getItem('junto.vol') !== null ? Math.min(1, Math.max(0, volSalvo)) : 1;
  S.mudo = localStorage.getItem('junto.mudo') === '1';
  const aplicarVol = () => {
    audio.volume = S.vol; audio.muted = S.mudo;
    localStorage.setItem('junto.vol', String(S.vol)); localStorage.setItem('junto.mudo', S.mudo ? '1' : '0');
  };
  aplicarVol();
  document.addEventListener('wheel', e => {
    if (!(e.target.closest && e.target.closest('[data-vol]'))) return;
    e.preventDefault();
    S.vol = Math.round(Math.min(1, Math.max(0, S.vol + (e.deltaY < 0 ? 0.05 : -0.05))) * 100) / 100;
    S.mudo = S.vol === 0; aplicarVol(); M.desenhar();
  }, { passive: false });
  const sincA = Sin.criarSincronizador(audio, { agora: () => J.agoraServidor() });
  audio.addEventListener('loadedmetadata', () => { carregado = true; });
  audio.addEventListener('ended', () => enviarFim());

  const arteDe = n => Math.min(7, Math.max(0, Number(n) | 0));
  const durDe = it => (it && typeof it.dur === 'number' && it.dur > 0 ? it.dur : 0);

  function faixaErroLink() {
    S.faixa = 'erro-link';
    clearTimeout(timerFaixa);
    timerFaixa = setTimeout(() => { if (S.faixa === 'erro-link') { S.faixa = null; M.desenhar(); } }, 6000);
    M.desenhar();
  }

  function enviarFim() {
    if (!item || !ultSessao || Date.now() - fimEm < 5000) return;
    fimEm = Date.now();
    J.enviar({ t: 'fim', item }).catch(() => {});
  }

  function dadosVideo() {
    if (!ultSessao || ultSessao.tipo !== 'ver') return;
    const it = (ultSessao.fila || []).find(x => x.id === item);
    J.videoDados({ video: (midiaAtual && midiaAtual.video) || null, item, titulo: it ? it.titulo : '', sub: it ? it.sub : '', dur: durDe(it) || null, P: ultSessao.P });
  }

  // Draws the session data (queue, current item) onto the friend's entry, or onto EU when I am the dono.
  function montar() {
    for (const k of CAMPOS_EU) delete EU[k];
    if (!ultSessao) return;
    const m = ultSessao, dono = m.dono === meuId;
    const alvo = dono ? EU : AMIGOS.find(a => a.id === m.dono);
    if (!alvo) return;
    const fila = Array.isArray(m.fila) ? m.fila : [], cur = fila[0];
    const modo = ['todos', 'dono', 'fila'].includes(m.modo) ? m.modo : 'dono';
    const conhecidos = Array.isArray(m.gente) ? m.gente.filter(id => id !== meuId && id !== m.dono && AMIGOS.some(a => a.id === id)) : [];
    Object.assign(alvo, {
      tipo: m.tipo === 'ver' ? 'ver' : 'ouvir',
      modo, // real mode label; the dono always controls and adds (motor.js podeControlar/podeAdicionar)
      titulo: cur ? esc(cur.titulo) : '', sub: cur ? esc(cur.sub) : '',
      arte: arteDe(cur ? cur.arte : alvo.arte), dur: durDe(cur), pos: 0,
      gente: conhecidos,
      fila: fila.map(it => [esc(it.titulo), esc(it.sub), durDe(it) ? M.hms(durDe(it)) : '', arteDe(it.arte), 'link', esc(it.id)]),
    });
  }

  function atualizarPos() {
    const P = ultSessao && ultSessao.P;
    const a = S.conn && M.achar(S.conn);
    const d = (a && a.dur) || 0;
    if (!P || P.item == null) { setPos(0); S.tocando = false; } else {
      let p = Sin.posicaoAgora(P, J.agoraServidor());
      p = Math.max(0, d ? Math.min(d, p) : p);
      setPos(p); S.tocando = P.tocando === true;
      if (P.tocando && d && p >= d) enviarFim();
    }
    const larg = d ? (S.pos / d * 100) + '%' : '0%';
    document.querySelectorAll('[data-pos]').forEach(e => { e.style.width = larg; });
    document.querySelectorAll('[data-t1]').forEach(e => { e.textContent = M.hms(S.pos); });
    document.querySelectorAll('[data-t]').forEach(e => { e.textContent = M.hms(S.pos) + ' / ' + M.hms(d); });
  }

  function trocarItem() {
    const m = ultSessao;
    const id = m && m.P && m.P.item != null ? m.P.item : null;
    const tp = m && m.tipo === 'ver' ? 'ver' : 'ouvir';
    if (id === item && tp === itemTipo) return;
    J.cancelarResolver(); clearTimeout(timerTenta); timerTenta = null;
    item = id; itemTipo = tp; carregado = false; midiaAtual = null; fimEm = 0;
    const meu = ++seq;
    audio.removeAttribute('src'); audio.load();
    dadosVideo();
    if (id == null) return;
    const it = (m.fila || []).find(x => x.id === id);
    if (!it) return;
    const tipo = m.tipo === 'ver' ? 'ver' : 'ouvir';
    const tentar = (n) => J.resolver(it.url, tipo).then(r => {
      if (meu !== seq) return;
      if (!r || !r.ok) {
        if (r && r.erro === 'sem_permissao') { faixaErroLink(); return; } // silent on this PC for this item
        if (n < ESPERAS.length) timerTenta = setTimeout(() => { timerTenta = null; if (meu === seq) tentar(n + 1); }, ESPERAS[n]); // transient: retry silently
        return;
      }
      midiaAtual = r;
      audio.src = r.audio; // the synchronizer seeks to the synced position once loaded
      dadosVideo();
    });
    tentar(0);
  }

  function sincronizar() {
    const m = ultSessao;
    if (!m) { sincA.definir(null); return; }
    const it = (m.fila || []).find(x => x.id === item);
    sincA.definir(m.P, durDe(it) || null);
  }

  // Teardown without redrawing: session left, ended, or account closed.
  function parar() {
    ultSessao = null; item = null; itemTipo = null; J.cancelarResolver(); clearTimeout(timerTenta); timerTenta = null; carregado = false; midiaAtual = null; ++seq; fimEm = 0;
    audio.removeAttribute('src'); audio.load();
    sincA.definir(null);
    J.fecharVideo();
    for (const k of CAMPOS_EU) delete EU[k];
    S.conn = null; S.oferecendo = false; S.tocando = false; setPos(0);
  }

  function encerrar() {
    parar();
    if (S.tela === 'sessao') S.tela = 'principal';
    S.faixa = null;
    M.desenhar();
  }

  function aoSnapshot(m) {
    if (!m || typeof m !== 'object') return;
    if (m.fim) { encerrar(); return; }
    const novo = !ultSessao || ultSessao.dono !== m.dono;
    ultSessao = m;
    S.conn = m.dono === meuId ? 'eu' : m.dono;
    S.oferecendo = m.dono === meuId;
    if (novo) { S.tela = 'sessao'; S.camada = null; S.menu = null; S.faixa = null; S.sessaoAberta = true; }
    montar();
    if (!M.achar(S.conn)) { S.conn = null; }
    trocarItem();
    sincronizar();
    dadosVideo();
    atualizarPos();
    M.desenhar();
  }

  async function adicionarLink(url, tipo) {
    if (!/^https?:\/\/\S+$/i.test(url)) return false;
    const r = await J.resolver(url, tipo, 'add');
    if (!r || !r.ok) { if (r && r.erro === 'sem_permissao') faixaErroLink(); return false; }
    try {
      const msg = { t: 'adicionar', url, titulo: String(r.titulo || url).slice(0, 200), sub: String(r.sub || '').slice(0, 120), dur: r.dur };
      let resp = await J.enviar(msg);
      for (let i = 0; i < 3 && resp && !resp.ok && resp.erro === 'devagar'; i++) { // server rate limit: wait and resend, silently
        await new Promise(f => setTimeout(f, Math.min(3000, Math.max(0, Number(resp.espera) || 0))));
        resp = await J.enviar(msg);
      }
      if (!resp.ok && resp.erro === 'sem_permissao') faixaErroLink();
      return !!resp.ok;
    } catch (e) { return false; }
  }

  setInterval(() => {
    if (carregado) sincA.passo();
    if (ultSessao) atualizarPos();
  }, 250);

  function limpar() {
    parar();
    AMIGOS.length = 0; D.recebidos.length = 0; D.enviados.length = 0;
    S.conn = null; S.camada = null; S.menu = null; S.faixa = null; S.carregando = false; S.offline = false; S.vazio = false;
  }

  // Own session: the dono's avatar appears once (the prototype lists the owner and then "eu"), and the title says "Sua sessão".
  M.gente = function (a) {
    const g = a.id === 'eu' ? ['eu', ...a.gente] : [a.id, ...a.gente, 'eu'];
    return '<span style="display:inline-flex;align-items:center">' + g.map((id, i) => `<span style="margin-left:${i ? -8 : 0}px;border-radius:50%;box-shadow:0 0 0 2px var(--gente-b,var(--fundo));display:inline-flex" ${M.dica(M.achar(id).nome + (id === a.id ? ' (dono)' : ''))}>${M.av(id, 28, false)}</span>`).join('') + '</span>';
  };
  const raizTela = document.getElementById('raiz');
  const textoProprio = new MutationObserver(() => {
    if (S.conn !== 'eu') return;
    const t = raizTela.querySelector('.topo2 .corta');
    if (t && t.textContent !== 'Sua sessão') t.textContent = 'Sua sessão';
    const b = raizTela.querySelector('.flut-bar .corta .corta:last-child');
    if (b && /^com /.test(b.textContent)) b.textContent = 'Sua sessão';
  });
  textoProprio.observe(raizTela, { childList: true, subtree: true });

  // "Avisar quando um amigo disponibilizar": Windows notification when a friend's offer appears (not on the first list).
  let ofertasAntes = null;
  function avisarOfertas(amigos) {
    const agora = new Map(amigos.filter(a => a.oferta && typeof a.oferta === 'object').map(a => [a.id, a]));
    if (ofertasAntes && S.opc.av && J.avisar) {
      for (const [id, a] of agora) {
        if (!ofertasAntes.has(id)) J.avisar(`${a.nome || a.usuario || 'Um amigo'} disponibilizou`, String(a.oferta.titulo || ''));
      }
    }
    ofertasAntes = new Set(agora.keys());
  }

  function aplicar(e) {
    avisarOfertas(e.amigos);
    AMIGOS.length = 0;
    meuId = e.eu.id;
    if (ultSessao && !e.sessao) { parar(); if (S.tela === 'sessao') S.tela = 'principal'; S.faixa = null; } // the server says I am in no session any more
    for (const a of e.amigos) {
      const o = a.oferta;
      const dados = { id: a.id, est: a.on ? 'on' : 'off' };
      if (o && typeof o === 'object') {
        // card data only; queue and people come with the session snapshot once connected
        Object.assign(dados, {
          tipo: o.tipo === 'ver' ? 'ver' : 'ouvir', modo: ['todos', 'dono', 'fila'].includes(o.modo) ? o.modo : 'dono',
          titulo: esc(o.titulo || ''), sub: '', arte: arteDe(o.arte), dur: 0, pos: 0,
          gente: new Array(Math.min(99, Math.max(0, Number(o.gente) | 0))).fill('?'), fila: [],
        });
      }
      AMIGOS.push(Object.assign(pessoa(a), dados));
    }
    if (ultSessao) { // a state push rebuilt the friends: lay the session over them again
      S.conn = ultSessao.dono === meuId ? 'eu' : ultSessao.dono;
      S.oferecendo = ultSessao.dono === meuId;
      montar();
      if (!M.achar(S.conn)) S.conn = null;
    }
    D.recebidos.length = 0;
    for (const r of e.recebidos) D.recebidos.push(Object.assign(pessoa(r), { id: r.id }));
    D.enviados.length = 0;
    for (const r of e.enviados) D.enviados.push(pessoa(r));
    EU.conta = esc(e.eu.nome || e.eu.usuario); EU.letra = letra(e.eu.nome || e.eu.usuario); EU.foto = foto(e.eu.id, e.eu.avatar);
    S.carregando = false; S.vazio = AMIGOS.length === 0;
    if (S.menu && !AMIGOS.some(a => a.id === S.menu)) S.menu = null;
  }

  async function enviar(msg, depois) {
    try {
      const r = await J.enviar(msg);
      if (r && r.ok) { if (depois) depois(); } else erroPedido(r && r.erro);
    } catch (e) { erroPedido('sem_conexao'); }
    M.desenhar();
  }

  M.ponte((c, v, el) => {
    switch (c) {
      case 'entrar':
        S.tela = 'entrando'; S.erroLogin = null;
        J.entrar().then(r => {
          if (r.ok) { S.tela = 'principal'; S.carregando = true; }
          else if (r.erro === 'cancelado') S.tela = 'login';
          else { S.tela = 'erro-login'; S.erroLogin = ERROS_LOGIN[r.erro] || ERROS_LOGIN.discord_fora; }
          M.desenhar();
        });
        return true;
      case 'cancelar-login': J.cancelarEntrada(); return true;
      case 'sair-conta':
        limpar(); S.tela = 'login';
        J.sair();
        return true;
      case 'pedir': {
        const campo = document.querySelector('input[data-enter="pedir"]');
        const nome = campo ? campo.value.trim() : '';
        if (!nome) { if (campo) campo.focus(); return true; }
        S.faixa = null;
        enviar({ t: 'pedir', usuario: nome }, () => { const k = document.querySelector('input[data-enter="pedir"]'); if (k) k.value = ''; S.faixa = 'pedido'; });
        return true;
      }
      case 'aceitar': case 'recusar': enviar({ t: c, id: v }); return true;
      case 'cancelar': enviar({ t: 'cancelar', usuario: v }); return true;
      case 'remover': S.menu = null; enviar({ t: 'remover', id: v }); return true;
      case 'opc': S.opc[v] = !S.opc[v]; J.salvarOpcoes(S.opc); return true;
      case 'volume': S.mudo = !S.mudo; if (!S.mudo && S.vol === 0) S.vol = 0.5; aplicarVol(); return true;
      case 'comecar-oferta': {
        const tipo = S.ofTipo === 'ouvir' ? 'ouvir' : 'ver';
        const modo = ['todos', 'dono', 'fila'].includes(S.ofModo) ? S.ofModo : 'todos';
        const campo = document.querySelector('.folha input.campo');
        const link = campo ? campo.value.trim() : '';
        enviar({ t: 'oferecer', tipo, modo }, () => {
          S.oferecendo = true; S.camada = null;
          if (link) adicionarLink(link, tipo);
        });
        return true;
      }
      case 'parar-oferta':
        J.enviar({ t: 'parar' }).catch(() => {}).then(() => { if (S.conn === 'eu') encerrar(); else { S.oferecendo = false; M.desenhar(); } });
        return true;
      case 'conectar': {
        const f = M.achar(v);
        S.menu = null; S.aviso = null;
        if (!f || !f.tipo) return true;
        if (S.conn === v) { S.tela = 'sessao'; S.camada = null; return true; }
        enviar({ t: 'entrar_sessao', dono: v });
        return true;
      }
      case 'desconectar':
        J.enviar({ t: S.conn === 'eu' ? 'parar' : 'sair_sessao' }).catch(() => {}).then(encerrar);
        return true;
      case 'tocar': case 'pular': case 'voltar': {
        const P = ultSessao && ultSessao.P;
        if (!P || !M.podeControlar()) return true;
        if (c === 'tocar') { if (P.item != null) J.enviar({ t: P.tocando ? 'pausar' : 'tocar' }).catch(() => {}); } else J.enviar({ t: c }).catch(() => {});
        return true;
      }
      case 'tirar':
        if (v && ultSessao && M.podeControlar()) J.enviar({ t: 'tirar', id: v }).catch(() => {});
        return true;
      case 'ver-video': J.abrirVideo(); dadosVideo(); return true;
      case 'min': J.janela('min'); return true;
      case 'fechar': return true; // handled by press and hold below
      default: return false;
    }
  });

  J.aoEstado(e => { aplicar(e); M.desenhar(); });
  J.aoSessao(aoSnapshot);
  J.aoVideoAcao(a => { if (a === 'tocar') M.agir('tocar'); });

  // Enter in the queue's add field: resolve locally, then add. Redraws keep what is typed; the field is emptied on success.
  const CAMPO_FILA = 'input.campo[aria-label="Link para a fila"]';
  document.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches(CAMPO_FILA) || adicionando || !ultSessao) return;
    e.preventDefault();
    const url = e.target.value.trim();
    if (!url) return;
    adicionando = true;
    try {
      if (await adicionarLink(url, ultSessao ? ultSessao.tipo : 'ouvir')) { const k = document.querySelector(CAMPO_FILA); if (k) k.value = ''; }
    } finally { adicionando = false; }
  });

  // Click on the progress bar seeks (only where the mode lets me control).
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.barra-p');
    if (!b || S.tela !== 'sessao' || !ultSessao || !M.podeControlar()) return;
    const a = M.achar(S.conn);
    if (!a || !a.dur) return;
    const r = b.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
    J.enviar({ t: 'buscar', pos: f * a.dur }).catch(() => {});
  });
  J.aoConexao(s => { S.offline = s !== 'on'; if (S.offline) S.carregando = false; M.desenhar(); });
  J.aoSessaoFim(() => { limpar(); S.tela = 'login'; M.desenhar(); });
  J.opcoes().then(o => { Object.assign(S.opc, o); M.desenhar(); });
  if (J.versao) J.versao().then(v => { if (v) { S.versao = v; M.desenhar(); } });

  // Close button: click = tray, hold 1 s = quit. Listens on document because every redraw replaces the button.
  let tempo = null, saiu = false;
  const botao = e => e.target.closest && e.target.closest('[data-act="fechar"]');
  const soltar = () => { clearTimeout(tempo); tempo = null; document.querySelectorAll('.bb.fecha.segura').forEach(b => b.classList.remove('segura')); };
  document.addEventListener('pointerdown', e => {
    const b = botao(e); if (!b || e.button !== 0) return;
    saiu = false; b.classList.add('segura');
    tempo = setTimeout(() => { saiu = true; J.janela('sair'); }, 1000);
  });
  document.addEventListener('pointerup', e => {
    const segurava = tempo !== null; soltar();
    if (segurava && !saiu && botao(e)) J.janela('fechar');
  });
  document.addEventListener('pointercancel', soltar);
})();
