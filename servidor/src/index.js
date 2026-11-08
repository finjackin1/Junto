// Junto server: stateless Worker (login, routing) + one SQLite Durable Object (friends, presence).
// Contract: docs/contexto/protocolo.md
import { DurableObject } from "cloudflare:workers";

const DIA = 86400000;
const SESSAO_DURA = 90 * DIA;
const SESSAO_RENOVA = 30 * DIA;
const ALARME_MS = 5 * 60 * 1000;
const INATIVO_MS = 150 * 1000;
const MAX_PEDIDOS = 50;
const MAX_MSG = 1024;
const MAX_MSG_ADD = 4096; // only "adicionar" and "sinal" may exceed MAX_MSG
const MAX_MSG_SINAL = 16384; // "sinal" carries a full WebRTC SDP (candidates included, no trickle)
const MAX_FILA = 100;
const INTERVALO_ADD = 2000; // per person: at most 1 add every 2 s
const INTERVALO_LIB = 1000; // per session: at most 1 queued add released into the playlist per second
const MAX_MSG_SEG = 40; // abuse cap per socket: more than 40 messages in 1 s are ignored
const ATRASO_NOVO = 2500; // start delay for a new current item (everyone loads)
const ATRASO_TOCAR = 300;
const GRACA_DONO_MS = 60 * 1000;
const MAX_CORPO = 4096;
const RE_NOME = /^[a-z0-9_.]{2,32}$/;
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RE_VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;
const OPEN = 1;
const AGENTE = "Junto/0.1"; // calls without a User-Agent can be refused by Discord

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function hashDe(token) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return b64url(new Uint8Array(d));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function tokenDe(request) {
  const h = request.headers.get("authorization") || "";
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(h.trim());
  return m && RE_TOKEN.test(m[1]) ? m[1] : null;
}

function central(env) {
  return env.CENTRAL.get(env.CENTRAL.idFromName("central"));
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch with one retry on network error / 429 / 5xx, honoring retry-after up to 3 s
async function comRetry(url, init) {
  let ultima = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(url, init);
      if (r.status !== 429 && r.status < 500) return r;
      ultima = r;
      if (tentativa === 0) {
        const ra = Number(r.headers.get("retry-after"));
        const ms = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 3000) : 300;
        await dormir(ms);
      }
    } catch {
      ultima = null;
      if (tentativa === 0) await dormir(300);
    }
  }
  return ultima; // null = network failure
}

async function entrar(request, env) {
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_CORPO) return json({ erro: "pedido_invalido" }, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_CORPO) return json({ erro: "pedido_invalido" }, 400);
  let corpo;
  try {
    corpo = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return json({ erro: "pedido_invalido" }, 400);
  }
  if (!corpo || typeof corpo !== "object") return json({ erro: "pedido_invalido" }, 400);
  const { code, verifier, redirectUri } = corpo;
  if (typeof code !== "string" || code.length < 1 || code.length > 512) return json({ erro: "pedido_invalido" }, 400);
  if (typeof verifier !== "string" || !RE_VERIFIER.test(verifier)) return json({ erro: "pedido_invalido" }, 400);
  if (typeof redirectUri !== "string" || redirectUri !== env.REDIRECT_URI) return json({ erro: "pedido_invalido" }, 400);
  if (!env.DISCORD_CLIENT_ID) return json({ erro: "discord_fora" }, 502);

  const api = env.DISCORD_API.replace(/\/+$/, "");
  const rt = await comRetry(api + "/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": AGENTE },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.DISCORD_CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  if (!rt || rt.status === 429 || rt.status >= 500) return json({ erro: "discord_fora" }, 502);
  if (!rt.ok) return json({ erro: "discord_recusou" }, 401);
  let tk;
  try {
    tk = await rt.json();
  } catch {
    return json({ erro: "discord_fora" }, 502);
  }
  if (!tk || typeof tk.access_token !== "string") return json({ erro: "discord_fora" }, 502);

  const ru = await comRetry(api + "/users/@me", {
    headers: { authorization: "Bearer " + tk.access_token, accept: "application/json", "user-agent": AGENTE },
  });
  if (!ru || ru.status === 429 || ru.status >= 500) return json({ erro: "discord_fora" }, 502);
  if (!ru.ok) return json({ erro: "discord_recusou" }, 401);
  let u;
  try {
    u = await ru.json();
  } catch {
    return json({ erro: "discord_fora" }, 502);
  }
  // Discord token is dropped here: never stored, never returned.
  if (!u || typeof u.id !== "string" || !/^\d{1,32}$/.test(u.id) || typeof u.username !== "string") return json({ erro: "discord_fora" }, 502);

  const perfil = {
    id: u.id,
    usuario: u.username.toLowerCase(),
    nome: (typeof u.global_name === "string" && u.global_name) || u.username,
    avatar: typeof u.avatar === "string" && u.avatar ? u.avatar : null,
  };
  const r = await central(env).entrar(perfil);
  return json(r);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const m = request.method;
    try {
      if (pathname === "/saude" && m === "GET") return json({ ok: true });
      if (pathname === "/entrar" && m === "POST") return await entrar(request, env);
      if (pathname === "/sair" && m === "POST") {
        const t = tokenDe(request);
        if (t) await central(env).sair(await hashDe(t));
        return new Response(null, { status: 204 });
      }
      // TURN relay for live share (Cloudflare Realtime TURN, short-lived credentials). No key configured = no relay.
      if (pathname === "/turn" && m === "GET") {
        const t = tokenDe(request);
        if (!t || !(await central(env).sessaoValida(await hashDe(t)))) return json({ erro: "sessao_invalida" }, 401);
        if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return json({ iceServers: [] });
        const r = await comRetry("https://rtc.live.cloudflare.com/v1/turn/keys/" + env.TURN_KEY_ID + "/credentials/generate-ice-servers", {
          method: "POST",
          headers: { authorization: "Bearer " + env.TURN_KEY_TOKEN, "content-type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
        });
        if (!r || !r.ok) return json({ iceServers: [] });
        const d = await r.json().catch(() => null);
        const lista = d && Array.isArray(d.iceServers) ? d.iceServers : d && d.iceServers ? [d.iceServers] : [];
        // turn/turns only (the app already has STUN); port 53 is blocked by browsers
        const ice = lista.map((s) => ({ ...s, urls: [].concat(s.urls || []).filter((u) => /^turns?:/.test(u) && !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length && s.username && s.credential);
        return json({ iceServers: ice });
      }
      if (pathname === "/ws" && m === "GET") {
        if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
          return json({ erro: "pedido_invalido" }, 426);
        }
        const t = tokenDe(request);
        if (!t) return json({ erro: "sessao_invalida" }, 401);
        const h = new Headers(request.headers);
        h.set("x-junto-hash", await hashDe(t));
        return await central(env).fetch(new Request(request, { headers: h }));
      }
    } catch (e) {
      return json({ erro: "discord_fora" }, 502);
    }
    return json({ erro: "nao_encontrado" }, 404);
  },
};

export class Central extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      const s = this.sql;
      s.exec("CREATE TABLE IF NOT EXISTS usuarios(id TEXT PRIMARY KEY, usuario TEXT, nome TEXT, avatar TEXT, criado INTEGER, visto INTEGER)");
      s.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_usuario ON usuarios(usuario)");
      s.exec("CREATE TABLE IF NOT EXISTS sessoes(hash TEXT PRIMARY KEY, usuario_id TEXT NOT NULL, expira INTEGER NOT NULL)");
      s.exec("CREATE INDEX IF NOT EXISTS ix_sessoes_expira ON sessoes(expira)");
      s.exec("CREATE TABLE IF NOT EXISTS amizades(a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY(a, b))");
      s.exec("CREATE INDEX IF NOT EXISTS ix_amizades_b ON amizades(b)");
      s.exec("CREATE TABLE IF NOT EXISTS pedidos(de_id TEXT NOT NULL, para_usuario TEXT NOT NULL, criado INTEGER, PRIMARY KEY(de_id, para_usuario))");
      s.exec("CREATE INDEX IF NOT EXISTS ix_pedidos_para ON pedidos(para_usuario)");
      s.exec("CREATE TABLE IF NOT EXISTS ofertas(dono TEXT PRIMARY KEY, tipo TEXT NOT NULL, modo TEXT NOT NULL, fila TEXT NOT NULL, p TEXT NOT NULL, membros TEXT NOT NULL, sem_dono INTEGER)");
      if (!s.exec("PRAGMA table_info(ofertas)").toArray().some((c) => c.name === "aba")) s.exec("ALTER TABLE ofertas ADD COLUMN aba TEXT");
      this.carregarOfertas();
      await this.agendar();
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------- RPC from the Worker ----------

  async entrar(perfil) {
    const agora = Date.now();
    const s = this.sql;
    const afetados = new Set([perfil.id]);
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await hashDe(token);
    this.ctx.storage.transactionSync(() => {
      for (const r of s.exec("SELECT id FROM usuarios WHERE usuario = ? AND id <> ?", perfil.usuario, perfil.id)) {
        afetados.add(r.id);
      }
      s.exec("UPDATE usuarios SET usuario = NULL WHERE usuario = ? AND id <> ?", perfil.usuario, perfil.id);
      s.exec(
        "INSERT INTO usuarios(id, usuario, nome, avatar, criado, visto) VALUES(?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET usuario = excluded.usuario, nome = excluded.nome, avatar = excluded.avatar, visto = excluded.visto",
        perfil.id, perfil.usuario, perfil.nome, perfil.avatar, agora, agora,
      );
      s.exec("INSERT INTO sessoes(hash, usuario_id, expira) VALUES(?, ?, ?)", hash, perfil.id, agora + SESSAO_DURA);
      for (const r of s.exec("SELECT de_id FROM pedidos WHERE para_usuario = ?", perfil.usuario)) afetados.add(r.de_id);
      for (const r of s.exec("SELECT CASE WHEN a = ? THEN b ELSE a END AS o FROM amizades WHERE a = ? OR b = ?", perfil.id, perfil.id, perfil.id)) afetados.add(r.o);
    });
    afetados.delete(perfil.id);
    this.notificar(afetados);
    return { token, eu: { id: perfil.id, usuario: perfil.usuario, nome: perfil.nome, avatar: perfil.avatar } };
  }

  async sair(hash) {
    const s = this.sql;
    const sock = this.ctx.getWebSockets("s:" + hash);
    const linha = s.exec("SELECT usuario_id FROM sessoes WHERE hash = ?", hash).toArray()[0];
    s.exec("DELETE FROM sessoes WHERE hash = ?", hash);
    const fechando = new Set(sock);
    for (const ws of sock) {
      try { ws.close(1000, "sair"); } catch {}
    }
    if (linha) {
      const o = this.of.get(linha.usuario_id);
      if (o) this.encerrar(o, "dono_saiu");
      await this.presencaMudou(linha.usuario_id, fechando);
    }
  }

  sessaoValida(hash) {
    const linha = this.sql.exec("SELECT expira FROM sessoes WHERE hash = ?", hash).toArray()[0];
    return !!linha && linha.expira > Date.now();
  }

  // ---------- WebSocket upgrade ----------

  async fetch(request) {
    const hash = request.headers.get("x-junto-hash");
    if (!hash || (request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return json({ erro: "sessao_invalida" }, 401);
    }
    const agora = Date.now();
    const s = this.sql;
    const linha = s.exec("SELECT usuario_id, expira FROM sessoes WHERE hash = ?", hash).toArray()[0];
    if (!linha || linha.expira <= agora) return json({ erro: "sessao_invalida" }, 401);
    const id = linha.usuario_id;
    if (!s.exec("SELECT 1 AS x FROM usuarios WHERE id = ?", id).toArray()[0]) return json({ erro: "sessao_invalida" }, 401);
    if (linha.expira - agora < SESSAO_RENOVA) {
      s.exec("UPDATE sessoes SET expira = ? WHERE hash = ?", agora + SESSAO_DURA, hash);
    }

    const primeiro = this.abertos(id).length === 0;
    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);
    this.ctx.acceptWebSocket(servidor, ["u:" + id, "s:" + hash]);
    servidor.serializeAttachment({ id, hash, t: agora });
    s.exec("UPDATE usuarios SET visto = ? WHERE id = ? AND visto < ?", agora, id, agora - 3600000); // at most 1 write per hour

    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(agora + ALARME_MS);

    this.enviarEstado(servidor, id);
    const os = this.of.get(this.em.get(id));
    if (os) {
      if (os.dono === id && os.semDono !== null) {
        os.semDono = null;
        this.gravar(os);
      }
      this.atualizarSessao(os, []); // snapshot on join/reconnect
    }
    if (primeiro) this.notificar(this.amigosDe(id));
    return new Response(null, { status: 101, webSocket: cliente });
  }

  // ---------- Hibernation handlers ----------

  async webSocketMessage(ws, msg) {
    const att = ws.deserializeAttachment();
    if (!att) return;
    const agora = Date.now();
    if (agora - att.t > 30000) {
      att.t = agora;
      ws.serializeAttachment(att);
    }
    let n = null;
    const responder = (extra) => {
      try { ws.send(JSON.stringify({ t: "resposta", n, ...extra })); } catch {}
    };
    const tx = this.taxa.get(ws);
    if (!tx || agora - tx.t >= 1000) this.taxa.set(ws, { t: agora, n: 1 });
    else if (++tx.n > MAX_MSG_SEG) return; // ignored, no reply, no disconnect
    const bytes = typeof msg === "string" ? enc.encode(msg).length : Infinity;
    if (bytes > MAX_MSG_SINAL) return responder({ ok: false, erro: "pedido_invalido" });
    let d;
    try { d = JSON.parse(msg); } catch { return responder({ ok: false, erro: "pedido_invalido" }); }
    if (!d || typeof d !== "object" || Array.isArray(d)) return responder({ ok: false, erro: "pedido_invalido" });
    if (bytes > MAX_MSG_ADD && d.t !== "sinal") return responder({ ok: false, erro: "pedido_invalido" });
    if (bytes > MAX_MSG && d.t !== "adicionar" && d.t !== "sinal") return responder({ ok: false, erro: "pedido_invalido" });
    if (typeof d.n === "number") n = d.n;
    if (d.t === "hora") {
      try { ws.send(JSON.stringify({ t: "hora", n, c: d.c, s: Date.now() })); } catch {}
      return;
    }
    const acao = {
      pedir: this.pedir, aceitar: this.aceitar, recusar: this.recusar, cancelar: this.cancelar, remover: this.remover,
      oferecer: this.oferecer, parar: this.parar, entrar_sessao: this.entrarSessao, sair_sessao: this.sairSessao,
      adicionar: this.adicionar, tirar: this.tirar, tocar: this.tocar, pausar: this.pausar, buscar: this.buscar,
      pular: this.pular, voltar: this.voltar, fim: this.fim, sinal: this.sinal,
    }[d.t];
    if (!acao) return responder({ ok: false, erro: "pedido_invalido" });
    let erro;
    try {
      erro = acao.call(this, att.id, d);
    } catch {
      erro = "pedido_invalido";
    }
    if (erro && typeof erro === "object") responder({ ok: false, ...erro });
    else responder(erro ? { ok: false, erro } : { ok: true });
  }

  async webSocketClose(ws, code) {
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1000, "bye"); } catch {}
    await this.aoFechar(ws);
  }

  async webSocketError(ws) {
    try { ws.close(1011, "erro"); } catch {}
    await this.aoFechar(ws);
  }

  async alarm() {
    const agora = Date.now();
    const vencidas = [...this.sql.exec("SELECT hash FROM sessoes WHERE expira <= ?", agora)];
    this.sql.exec("DELETE FROM sessoes WHERE expira <= ?", agora);
    // Pings would keep these sockets alive past expiry; closed, the app reconnects and gets the 401.
    for (const { hash } of vencidas) {
      for (const ws of this.ctx.getWebSockets("s:" + hash)) {
        try { ws.close(1008, "sessao_invalida"); } catch {}
        await this.aoFechar(ws);
      }
    }
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== OPEN) continue;
      const att = ws.deserializeAttachment();
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      const ref = Math.max(auto ? auto.getTime() : 0, att ? att.t : 0);
      if (agora - ref > INATIVO_MS) {
        try { ws.close(1001, "inativo"); } catch {}
        await this.aoFechar(ws);
      }
    }
    for (const o of [...this.of.values()]) {
      if (o.semDono !== null && Date.now() >= o.semDono + GRACA_DONO_MS && this.abertos(o.dono).length === 0) {
        this.encerrar(o, "dono_saiu");
      }
    }
    const prox = this.proximoAlarme();
    if (prox !== null) await this.ctx.storage.setAlarm(prox);
  }

  // ---------- presence ----------

  abertos(id, excluir) {
    return this.ctx.getWebSockets("u:" + id).filter((w) => w.readyState === OPEN && !(excluir && excluir.has(w)));
  }

  async aoFechar(ws) {
    const att = ws.deserializeAttachment();
    if (att) await this.presencaMudou(att.id, new Set([ws]));
  }

  async presencaMudou(id, excluir) {
    if (this.abertos(id, excluir).length > 0) return;
    this.excluir = excluir;
    try {
      const o = this.of.get(id);
      if (o && o.semDono === null) {
        o.semDono = Date.now();
        this.gravar(o);
      }
      const dono = this.em.get(id);
      const os = dono && dono !== id ? this.of.get(dono) : null;
      if (os) this.atualizarSessao(os, []); // "gente" changed
      this.notificar(this.amigosDe(id));
    } finally {
      this.excluir = null;
    }
    await this.agendar();
  }

  // next alarm: 5 min while sockets exist, and the end of any dono grace period
  proximoAlarme() {
    let t = this.ctx.getWebSockets().some((w) => w.readyState === OPEN) ? Date.now() + ALARME_MS : null;
    for (const o of this.of.values()) {
      if (o.semDono === null) continue;
      const d = o.semDono + GRACA_DONO_MS;
      if (t === null || d < t) t = d;
    }
    return t;
  }

  async agendar() {
    const t = this.proximoAlarme();
    if (t === null) return;
    const atual = await this.ctx.storage.getAlarm();
    if (atual === null || atual > t) await this.ctx.storage.setAlarm(t);
  }

  amigosDe(id) {
    return new Set(
      this.sql.exec("SELECT CASE WHEN a = ? THEN b ELSE a END AS o FROM amizades WHERE a = ? OR b = ?", id, id, id)
        .toArray().map((r) => r.o),
    );
  }

  // ---------- snapshots ----------

  estado(id) {
    const s = this.sql;
    const eu = s.exec("SELECT id, usuario, nome, avatar FROM usuarios WHERE id = ?", id).toArray()[0];
    if (!eu) return null;
    const amigos = s.exec(
      "SELECT u.id, u.usuario, u.nome, u.avatar FROM amizades m JOIN usuarios u ON u.id = CASE WHEN m.a = ? THEN m.b ELSE m.a END WHERE m.a = ? OR m.b = ?",
      id, id, id,
    ).toArray().map((r) => ({ ...r, on: this.abertos(r.id, this.excluir).length > 0, oferta: this.ofertaDe(r.id) }));
    amigos.sort((x, y) => (x.on === y.on ? String(x.nome).localeCompare(String(y.nome), "pt", { sensitivity: "base" }) : x.on ? -1 : 1));
    const recebidos = eu.usuario
      ? s.exec(
          "SELECT u.id, u.usuario, u.nome, u.avatar FROM pedidos p JOIN usuarios u ON u.id = p.de_id WHERE p.para_usuario = ? ORDER BY p.criado, u.id",
          eu.usuario,
        ).toArray()
      : [];
    const enviados = s.exec(
      "SELECT p.para_usuario AS usuario, u.nome AS nome, u.avatar AS avatar FROM pedidos p LEFT JOIN usuarios u ON u.usuario = p.para_usuario WHERE p.de_id = ? ORDER BY p.criado, p.para_usuario",
      id,
    ).toArray();
    const dono = this.em.get(id);
    return { t: "estado", eu, amigos, recebidos, enviados, sessao: dono ? { dono } : null };
  }

  enviarEstado(ws, id) {
    const e = this.estado(id);
    if (!e) return;
    try { ws.send(JSON.stringify(e)); } catch {}
  }

  notificar(ids) {
    for (const id of ids) {
      const socks = this.abertos(id);
      if (socks.length === 0) continue;
      const txt = JSON.stringify(this.estado(id));
      for (const w of socks) {
        try { w.send(txt); } catch {}
      }
    }
  }

  // ---------- actions (return an erro code, or undefined when ok) ----------

  eu(id) {
    return this.sql.exec("SELECT id, usuario FROM usuarios WHERE id = ?", id).toArray()[0];
  }

  nomeDe(v) {
    if (typeof v !== "string") return null;
    const n = v.trim().replace(/^@/, "").toLowerCase();
    return RE_NOME.test(n) ? n : null;
  }

  saoAmigos(x, y) {
    const [a, b] = x < y ? [x, y] : [y, x];
    return this.sql.exec("SELECT 1 AS x FROM amizades WHERE a = ? AND b = ?", a, b).toArray().length > 0;
  }

  tornarAmigos(x, y) {
    const [a, b] = x < y ? [x, y] : [y, x];
    this.sql.exec("INSERT OR IGNORE INTO amizades(a, b) VALUES(?, ?)", a, b);
  }

  pedir(id, d) {
    const nome = this.nomeDe(d.usuario);
    if (!nome) return "nome_invalido";
    const eu = this.eu(id);
    if (!eu || !eu.usuario) return "pedido_invalido";
    if (eu.usuario === nome) return "voce_mesmo";
    const s = this.sql;
    const alvo = s.exec("SELECT id FROM usuarios WHERE usuario = ?", nome).toArray()[0];
    if (alvo && this.saoAmigos(id, alvo.id)) return "ja_amigos";
    if (alvo && s.exec("SELECT 1 AS x FROM pedidos WHERE de_id = ? AND para_usuario = ?", alvo.id, eu.usuario).toArray().length > 0) {
      this.ctx.storage.transactionSync(() => {
        s.exec("DELETE FROM pedidos WHERE (de_id = ? AND para_usuario = ?) OR (de_id = ? AND para_usuario = ?)", alvo.id, eu.usuario, id, nome);
        this.tornarAmigos(id, alvo.id);
      });
      this.notificar([id, alvo.id]);
      return;
    }
    if (s.exec("SELECT 1 AS x FROM pedidos WHERE de_id = ? AND para_usuario = ?", id, nome).toArray().length > 0) return;
    const total = s.exec("SELECT COUNT(*) AS c FROM pedidos WHERE de_id = ?", id).one().c;
    if (total >= MAX_PEDIDOS) return "muitos_pedidos";
    s.exec("INSERT INTO pedidos(de_id, para_usuario, criado) VALUES(?, ?, ?)", id, nome, Date.now());
    this.notificar(alvo ? [id, alvo.id] : [id]);
  }

  pedidoPara(id, d) {
    if (typeof d.id !== "string" || !d.id) return null;
    const eu = this.eu(id);
    if (!eu || !eu.usuario) return null;
    const ok = this.sql.exec("SELECT 1 AS x FROM pedidos WHERE de_id = ? AND para_usuario = ?", d.id, eu.usuario).toArray().length > 0;
    return ok ? eu : null;
  }

  aceitar(id, d) {
    const eu = this.pedidoPara(id, d);
    if (!eu) return "nao_encontrado";
    const s = this.sql;
    this.ctx.storage.transactionSync(() => {
      s.exec("DELETE FROM pedidos WHERE de_id = ? AND para_usuario = ?", d.id, eu.usuario);
      const o = s.exec("SELECT usuario FROM usuarios WHERE id = ?", d.id).toArray()[0];
      if (o && o.usuario) s.exec("DELETE FROM pedidos WHERE de_id = ? AND para_usuario = ?", id, o.usuario);
      this.tornarAmigos(id, d.id);
    });
    this.notificar([id, d.id]);
  }

  recusar(id, d) {
    const eu = this.pedidoPara(id, d);
    if (!eu) return "nao_encontrado";
    this.sql.exec("DELETE FROM pedidos WHERE de_id = ? AND para_usuario = ?", d.id, eu.usuario);
    // the sender is not told: their snapshot only changes the next time it is sent
    this.notificar([id]);
  }

  cancelar(id, d) {
    const nome = this.nomeDe(d.usuario);
    if (!nome) return "nome_invalido";
    const s = this.sql;
    const antes = s.exec("SELECT 1 AS x FROM pedidos WHERE de_id = ? AND para_usuario = ?", id, nome).toArray().length;
    if (!antes) return "nao_encontrado";
    s.exec("DELETE FROM pedidos WHERE de_id = ? AND para_usuario = ?", id, nome);
    const alvo = s.exec("SELECT id FROM usuarios WHERE usuario = ?", nome).toArray()[0];
    this.notificar(alvo ? [id, alvo.id] : [id]);
  }

  remover(id, d) {
    if (typeof d.id !== "string" || !d.id) return "nao_encontrado";
    if (!this.saoAmigos(id, d.id)) return "nao_encontrado";
    const [a, b] = id < d.id ? [id, d.id] : [d.id, id];
    this.sql.exec("DELETE FROM amizades WHERE a = ? AND b = ?", a, b);
    this.expulsar(id, d.id);
    this.expulsar(d.id, id);
    this.notificar([id, d.id]);
  }

  // ---------- offers / sessions (stage 2) ----------

  carregarOfertas() {
    this.of = new Map(); // dono id -> offer
    this.pend = new Map(); // dono id -> {fifo, ult, timer}: adds accepted but not yet in the playlist (memory only)
    this.ultAdd = new Map(); // user id -> time of last accepted add
    this.taxa = new WeakMap(); // socket -> {t, n}: messages in the current 1 s window
    this.em = new Map(); // user id -> dono id of the session the user is in (dono maps to self)
    for (const r of this.sql.exec("SELECT dono, tipo, modo, fila, p, membros, sem_dono, aba FROM ofertas")) {
      const o = {
        dono: r.dono, tipo: r.tipo, modo: r.modo, fila: JSON.parse(r.fila), P: JSON.parse(r.p),
        membros: new Set(JSON.parse(r.membros)), semDono: r.sem_dono, sig: null, aba: r.aba ? JSON.parse(r.aba) : null,
      };
      o.sig = this.sigDe(o);
      this.of.set(o.dono, o);
      this.em.set(o.dono, o.dono);
      for (const m of o.membros) this.em.set(m, o.dono);
      if (o.semDono === null && this.abertos(o.dono).length === 0) {
        o.semDono = Date.now(); // e.g. server restarted: sockets are gone, start the grace period
        this.gravar(o);
      }
    }
  }

  gravar(o) {
    this.sql.exec(
      "INSERT OR REPLACE INTO ofertas(dono, tipo, modo, fila, p, membros, sem_dono, aba) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      o.dono, o.tipo, o.modo, JSON.stringify(o.fila), JSON.stringify(o.P), JSON.stringify([...o.membros]), o.semDono, o.aba ? JSON.stringify(o.aba) : null,
    );
  }

  gente(o) {
    return [...o.membros].filter((m) => this.abertos(m, this.excluir).length > 0);
  }

  resumo(o) {
    if (o.aba) return { tipo: o.tipo, modo: o.modo, fonte: "aba", titulo: o.aba.titulo || null, arte: o.aba.arte, gente: this.gente(o).length };
    const atual = o.fila[0];
    return { tipo: o.tipo, modo: o.modo, fonte: "fila", titulo: atual ? atual.titulo : null, arte: atual ? atual.arte : 0, gente: this.gente(o).length };
  }

  sigDe(o) {
    return JSON.stringify(this.resumo(o));
  }

  ofertaDe(id) {
    const o = this.of.get(id);
    return o ? this.resumo(o) : null;
  }

  snapshot(o) {
    return { t: "sessao", dono: o.dono, tipo: o.tipo, modo: o.modo, fonte: o.aba ? "aba" : "fila", aba: o.aba, gente: this.gente(o), fila: o.fila, P: o.P, agora: Date.now() };
  }

  enviarA(ids, obj) {
    const txt = JSON.stringify(obj);
    for (const id of ids) {
      for (const w of this.abertos(id, this.excluir)) {
        try { w.send(txt); } catch {}
      }
    }
  }

  // snapshot to every member; estado to friends only when what they see changed (plus `extras` always)
  atualizarSessao(o, extras) {
    this.enviarA([o.dono, ...o.membros], this.snapshot(o));
    const sig = this.sigDe(o);
    const alvo = new Set(extras);
    if (sig !== o.sig) {
      o.sig = sig;
      for (const x of this.amigosDe(o.dono)) alvo.add(x);
      alvo.add(o.dono);
      for (const m of o.membros) alvo.add(m);
    }
    if (alvo.size) this.notificar(alvo);
  }

  mudou(o) {
    this.gravar(o);
    this.atualizarSessao(o, []);
  }

  encerrar(o, fim) {
    const todos = [o.dono, ...o.membros];
    this.of.delete(o.dono);
    this.soltarPend(o.dono);
    for (const id of todos) this.em.delete(id);
    this.sql.exec("DELETE FROM ofertas WHERE dono = ?", o.dono);
    this.enviarA(todos, { t: "sessao", fim });
    const alvo = new Set(todos);
    for (const x of this.amigosDe(o.dono)) alvo.add(x);
    this.notificar(alvo);
  }

  // member leaves on their own, no message
  deixar(id) {
    const dono = this.em.get(id);
    if (!dono || dono === id) return;
    const o = this.of.get(dono);
    this.em.delete(id);
    if (!o) return;
    o.membros.delete(id);
    this.gravar(o);
    this.atualizarSessao(o, [id]);
  }

  expulsar(dono, usuario) {
    const o = this.of.get(dono);
    if (!o || !o.membros.has(usuario)) return;
    o.membros.delete(usuario);
    this.em.delete(usuario);
    this.gravar(o);
    this.enviarA([usuario], { t: "sessao", fim: "removido" });
    this.atualizarSessao(o, [usuario]);
  }

  sessaoDe(id) {
    return this.of.get(this.em.get(id));
  }

  oferecer(id, d) {
    if (d.tipo !== "ouvir" && d.tipo !== "ver") return "pedido_invalido";
    if (d.modo !== "todos" && d.modo !== "dono" && d.modo !== "fila") return "pedido_invalido";
    if (d.fonte !== undefined && d.fonte !== null && d.fonte !== "fila" && d.fonte !== "aba") return "pedido_invalido";
    if (d.titulo !== undefined && d.titulo !== null && typeof d.titulo !== "string") return "pedido_invalido";
    if (!this.eu(id)) return "pedido_invalido";
    let aba = null;
    if (d.fonte === "aba") {
      const titulo = (d.titulo || "").trim().slice(0, 200);
      let h = 0;
      for (let i = 0; i < titulo.length; i++) h = (Math.imul(h, 31) + titulo.charCodeAt(i)) >>> 0;
      aba = { titulo, arte: h % 8 };
    }
    let o = this.of.get(id);
    if (o) {
      o.tipo = d.tipo;
      o.modo = d.modo;
      o.aba = aba;
      o.semDono = null;
    } else {
      this.deixar(id);
      o = { dono: id, tipo: d.tipo, modo: d.modo, fila: [], P: { item: null, tocando: false, pos: 0, base: Date.now() }, membros: new Set(), semDono: null, sig: null, aba };
      this.of.set(id, o);
      this.em.set(id, id);
    }
    this.gravar(o);
    this.atualizarSessao(o, [id]);
  }

  parar(id) {
    const o = this.of.get(id);
    if (!o) return "nao_encontrado";
    this.encerrar(o, "dono_parou");
  }

  entrarSessao(id, d) {
    if (typeof d.dono !== "string" || !d.dono || d.dono === id) return "pedido_invalido";
    const o = this.of.get(d.dono);
    if (!o || !this.saoAmigos(id, d.dono)) return "nao_encontrado";
    if (this.em.get(id) !== d.dono) {
      const meu = this.of.get(id);
      if (meu) this.encerrar(meu, "dono_parou");
      else this.deixar(id);
      o.membros.add(id);
      this.em.set(id, d.dono);
      this.gravar(o);
    }
    this.atualizarSessao(o, [id]);
  }

  // live tab share: relays one WebRTC message between the dono and one member of the same session
  sinal(id, d) {
    if (typeof d.para !== "string" || !d.para || d.para === id) return "pedido_invalido";
    const s = d.dados;
    if (!s || typeof s !== "object" || Array.isArray(s) || !["quero", "oferta", "resposta", "fim"].includes(s.tipo)) return "pedido_invalido";
    if (s.id !== undefined && !(typeof s.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(s.id))) return "pedido_invalido";
    if (s.sdp !== undefined && !(typeof s.sdp === "string" && s.sdp.length <= 15000)) return "pedido_invalido";
    const o = this.sessaoDe(id);
    if (!o || !o.aba) return "nao_encontrado";
    const ok = (o.dono === id && o.membros.has(d.para)) || (d.para === o.dono && o.membros.has(id));
    if (!ok || this.abertos(d.para).length === 0) return "nao_encontrado";
    const dados = { tipo: s.tipo };
    if (s.id !== undefined) dados.id = s.id;
    if (s.sdp !== undefined) dados.sdp = s.sdp;
    this.enviarA([d.para], { t: "sinal", de: id, dados });
  }

  sairSessao(id) {
    const dono = this.em.get(id);
    if (!dono || dono === id) return "nao_encontrado";
    this.deixar(id);
  }

  // que: "ctl" (control playback) or "add"
  comPermissao(id, que) {
    const o = this.sessaoDe(id);
    if (!o) return { erro: "nao_encontrado" };
    const ok = o.dono === id || o.modo === "todos" || (que === "add" && o.modo === "fila");
    return ok ? { o } : { erro: "sem_permissao" };
  }

  posAgora(o, agora) {
    const P = o.P;
    return Math.max(0, P.pos + (P.tocando ? (agora - P.base) / 1000 : 0));
  }

  // optional position argument: missing -> padrao, invalid -> null
  posDe(v, padrao) {
    if (v === undefined || v === null) return padrao;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  }

  adicionar(id, d) {
    const r = this.comPermissao(id, "add");
    if (r.erro) return r.erro;
    const o = r.o;
    const agora = Date.now();
    const espera = (this.ultAdd.get(id) || 0) + INTERVALO_ADD - agora;
    if (espera > 0) return { erro: "devagar", espera };
    const url = d.url;
    if (typeof url !== "string" || url.length < 1 || url.length > 2048 || !/^https?:\/\//i.test(url)) return "pedido_invalido";
    if (typeof d.titulo !== "string") return "pedido_invalido";
    if (d.sub !== undefined && d.sub !== null && typeof d.sub !== "string") return "pedido_invalido";
    if (d.dur !== undefined && d.dur !== null && !(typeof d.dur === "number" && Number.isFinite(d.dur) && d.dur >= 0)) return "pedido_invalido";
    let e = this.pend.get(o.dono);
    if (o.fila.length + (e ? e.fifo.length : 0) >= MAX_FILA) return "fila_cheia";
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (Math.imul(h, 31) + url.charCodeAt(i)) >>> 0;
    const item = {
      id: b64url(crypto.getRandomValues(new Uint8Array(6))),
      url,
      titulo: d.titulo.trim().slice(0, 200) || url.slice(0, 200),
      sub: (d.sub || "").slice(0, 120),
      dur: typeof d.dur === "number" ? d.dur : null,
      arte: h % 8,
      por: id,
      tipo: "link",
    };
    if (this.ultAdd.size > 500) for (const [k, t] of this.ultAdd) if (agora - t >= INTERVALO_ADD) this.ultAdd.delete(k);
    this.ultAdd.set(id, agora);
    if (!e) this.pend.set(o.dono, (e = { fifo: [], ult: 0, timer: null }));
    e.fifo.push(item);
    this.liberar(o.dono, false);
  }

  // releases at most 1 pending add per INTERVALO_LIB into the playlist; the rest waits on a timer
  // (a pending timer keeps the DO awake, so the FIFO is not lost to hibernation)
  liberar(dono, vencido) {
    const e = this.pend.get(dono);
    if (!e) return;
    const o = this.of.get(dono);
    if (!o) return this.soltarPend(dono);
    if (e.fifo.length && (vencido || Date.now() - e.ult >= INTERVALO_LIB)) {
      const item = e.fifo.shift();
      e.ult = Date.now();
      if (o.fila.length < MAX_FILA) {
        o.fila.push(item);
        if (o.fila.length === 1) o.P = { item: item.id, tocando: true, pos: 0, base: e.ult + ATRASO_NOVO };
        this.mudou(o);
      }
    }
    if (e.fifo.length && e.timer === null) {
      e.timer = setTimeout(() => {
        e.timer = null;
        if (this.pend.get(dono) === e) this.liberar(dono, true);
      }, Math.max(0, e.ult + INTERVALO_LIB - Date.now()));
    }
  }

  soltarPend(dono) {
    const e = this.pend.get(dono);
    if (!e) return;
    if (e.timer !== null) clearTimeout(e.timer);
    this.pend.delete(dono);
  }

  tirar(id, d) {
    const r = this.comPermissao(id, "ctl");
    if (r.erro) return r.erro;
    const o = r.o;
    if (typeof d.id !== "string") return "pedido_invalido";
    const i = o.fila.findIndex((x) => x.id === d.id);
    if (i < 0) return "nao_encontrado";
    if (i === 0) return "item_atual";
    o.fila.splice(i, 1);
    this.mudou(o);
  }

  tocar(id, d) {
    const r = this.comPermissao(id, "ctl");
    if (r.erro) return r.erro;
    const o = r.o;
    const agora = Date.now();
    const pos = this.posDe(d.pos, this.posAgora(o, agora));
    if (pos === null || !o.P.item) return "pedido_invalido";
    o.P = { item: o.P.item, tocando: true, pos, base: agora + ATRASO_TOCAR };
    this.mudou(o);
  }

  pausar(id, d) {
    const r = this.comPermissao(id, "ctl");
    if (r.erro) return r.erro;
    const o = r.o;
    const agora = Date.now();
    const pos = this.posDe(d.pos, this.posAgora(o, agora));
    if (pos === null || !o.P.item) return "pedido_invalido";
    o.P = { item: o.P.item, tocando: false, pos, base: agora };
    this.mudou(o);
  }

  buscar(id, d) {
    const r = this.comPermissao(id, "ctl");
    if (r.erro) return r.erro;
    const o = r.o;
    const pos = this.posDe(d.pos, null);
    if (pos === null || !o.P.item) return "pedido_invalido";
    o.P = { item: o.P.item, tocando: o.P.tocando, pos, base: Date.now() };
    this.mudou(o);
  }

  avancar(o) {
    const agora = Date.now();
    o.fila.shift();
    o.P = o.fila.length
      ? { item: o.fila[0].id, tocando: true, pos: 0, base: agora + ATRASO_NOVO }
      : { item: null, tocando: false, pos: 0, base: agora };
    this.mudou(o);
  }

  pular(id) {
    const r = this.comPermissao(id, "ctl");
    if (r.erro) return r.erro;
    if (!r.o.P.item) return "pedido_invalido";
    this.avancar(r.o);
  }

  voltar(id) {
    const r = this.comPermissao(id, "ctl");
    if (r.erro) return r.erro;
    const o = r.o;
    if (!o.P.item) return "pedido_invalido";
    const agora = Date.now();
    o.P = { item: o.P.item, tocando: o.P.tocando, pos: 0, base: o.P.tocando ? agora + ATRASO_TOCAR : agora };
    this.mudou(o);
  }

  fim(id, d) {
    const o = this.sessaoDe(id);
    if (!o) return "nao_encontrado";
    if (typeof d.item !== "string") return "pedido_invalido";
    const atual = o.fila[0];
    if (!atual || atual.id !== d.item || o.P.item !== d.item) return; // duplicate or stale: ignored
    if (typeof atual.dur === "number" && atual.dur > 2) {
      if (this.posAgora(o, Date.now()) < atual.dur - 2) return;
    } else if (this.comPermissao(id, "ctl").erro) return; // no valid dur: only who controls can end it
    this.avancar(o);
  }
}
