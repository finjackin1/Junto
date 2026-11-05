'use strict';
// Discord OAuth2 code + PKCE S256 (public client), per docs/contexto/protocolo.md "Login".
// No Electron dependency: the browser opener and fetch are injected so tests run with plain node.
const http = require('node:http');
const crypto = require('node:crypto');

const PORTA = 53682;
const AUTORIZAR_PADRAO = 'https://discord.com/oauth2/authorize';

// Answers meaning "prompt=none can't skip the screen for this person": ask again, showing it.
const REFAZER_SEM_PROMPT = new Set(['interaction_required', 'consent_required', 'login_required']);
const ESPERA_FECHAR_MS = 300; // lets the browser receive the page before the local server closes

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function desafioDe(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function gerarPkce(rand = crypto.randomBytes) {
  const verifier = b64u(rand(32));
  return { verifier, challenge: desafioDe(verifier), state: b64u(rand(16)) };
}

function montarUrlAutorizar({ base, clientId, redirectUri, state, challenge, comPrompt = true }) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'identify',
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (comPrompt) q.set('prompt', 'none');
  return `${base || AUTORIZAR_PADRAO}?${q.toString()}`;
}

function pagina(ok) {
  const msg = ok ? 'Pronto, pode voltar para o Junto.' : 'Não deu certo. Pode fechar esta janela e tentar de novo no Junto.';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Junto</title>'
    + '<style>html,body{height:100%;margin:0}body{background:#11131C;color:#E8EAF2;font:18px system-ui,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}</style>'
    + `</head><body><p>${msg}</p></body></html>`;
}

function responder(res, status, corpo) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'close',
  });
  res.end(corpo);
}

// Maps the Worker's answer to /entrar to the bridge's error codes.
function erroDoServidor(status) {
  if (status === 401 || status === 400) return 'discord_recusou';
  return 'discord_fora';
}

function criarLogin({
  servidor,
  clientId,
  autorizar,
  abrir,
  fetchFn = globalThis.fetch,
  log = () => {},
  porta = PORTA,
  timeoutMs = 5 * 60 * 1000,
  trocaMs = 20000,
  rand = crypto.randomBytes,
} = {}) {
  const base = String(servidor || '').replace(/\/+$/, '');
  let ativa = null; // { promessa, cancelar }

  function entrar() {
    if (ativa) return ativa.promessa;
    if (!clientId || !base) return Promise.resolve({ ok: false, erro: 'sem_config' });

    const pkce = gerarPkce(rand);
    let srv = null;
    let timer = null;
    let terminou = false;
    let recebido = false;
    let refez = false;
    let resolver;

    const promessa = new Promise((r) => { resolver = r; });

    function fim(resultado) {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      ativa = null;
      if (srv) {
        try { srv.close(); } catch { /* not listening */ }
        try { srv.closeAllConnections(); } catch { /* old node */ }
      }
      log('login: fim', resultado.ok ? 'ok' : resultado.erro);
      resolver(resultado);
    }

    ativa = { promessa, cancelar: () => fim({ ok: false, erro: 'cancelado' }) };

    async function trocar(code, redirectUri) {
      try {
        const r = await fetchFn(`${base}/entrar`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, verifier: pkce.verifier, redirectUri }),
          signal: AbortSignal.timeout(trocaMs),
        });
        if (r.status !== 200) return { ok: false, erro: erroDoServidor(r.status) };
        const j = await r.json();
        if (!j || typeof j.token !== 'string' || !j.token) return { ok: false, erro: 'discord_fora' };
        return { ok: true, token: j.token, eu: j.eu || null };
      } catch (e) {
        return { ok: false, erro: 'discord_fora' };
      }
    }

    function responderEFechar(res, resultado) {
      responder(res, 200, pagina(resultado.ok));
      setTimeout(() => fim(resultado), ESPERA_FECHAR_MS);
    }

    function aoPedido(req, res) {
      let u;
      try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return responder(res, 400, pagina(false)); }
      const addr = srv.address();
      const hostOk = addr && (req.headers.host === `127.0.0.1:${addr.port}` || req.headers.host === `localhost:${addr.port}`);
      if (u.pathname !== '/callback' || req.method !== 'GET' || !hostOk) return responder(res, 404, pagina(false));
      if (u.searchParams.get('state') !== pkce.state) return responder(res, 400, pagina(false)); // ignored, keep waiting
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      if (recebido || (!err && !code)) return responder(res, 400, pagina(false));
      const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      if (err && REFAZER_SEM_PROMPT.has(err) && !refez) {
        refez = true;
        res.writeHead(302, {
          location: montarUrlAutorizar({ base: autorizar, clientId, redirectUri, state: pkce.state, challenge: pkce.challenge, comPrompt: false }),
          'cache-control': 'no-store',
          connection: 'close',
        });
        return res.end();
      }
      recebido = true;
      clearTimeout(timer);
      if (err) return responderEFechar(res, { ok: false, erro: err === 'access_denied' ? 'cancelado' : 'discord_recusou' });
      // The page only says "pronto" after the server has confirmed the login.
      return trocar(code, redirectUri).then((r) => responderEFechar(res, r));
    }

    srv = http.createServer(aoPedido);
    srv.on('error', (e) => {
      log('login: servidor local falhou', e && e.code);
      fim({ ok: false, erro: 'porta_ocupada' });
    });
    srv.listen(porta, '127.0.0.1', () => {
      if (terminou) return;
      timer = setTimeout(() => fim({ ok: false, erro: 'tempo_esgotado' }), timeoutMs);
      const redirectUri = `http://127.0.0.1:${srv.address().port}/callback`;
      const url = montarUrlAutorizar({ base: autorizar, clientId, redirectUri, state: pkce.state, challenge: pkce.challenge });
      Promise.resolve()
        .then(() => abrir(url))
        .catch((e) => {
          log('login: nao abriu o navegador', e && e.message);
          fim({ ok: false, erro: 'discord_fora' });
        });
    });

    return promessa;
  }

  function cancelar() {
    if (ativa) ativa.cancelar();
  }

  return { entrar, cancelar, ativo: () => !!ativa };
}

module.exports = { criarLogin, gerarPkce, desafioDe, montarUrlAutorizar, PORTA };
