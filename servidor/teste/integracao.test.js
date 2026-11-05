// Integration test: fake Discord + real `wrangler dev --local` (workerd). Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_ID = "cid-teste-123";
const REDIRECT = "http://127.0.0.1:53682/callback";
const VERIFIER = "v".repeat(43);

let discord, discordPorta, wranglerPorta, wrangler, persist, base;
const discordLog = { tokenReqs: [], falhas: [] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLivre() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });
}

function matarArvore(proc) {
  if (!proc || !proc.pid) return;
  spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}

function iniciarDiscord() {
  return new Promise((res) => {
    discord = http.createServer((req, resp) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const corpo = Buffer.concat(chunks).toString();
        const out = (st, o) => {
          resp.writeHead(st, { "content-type": "application/json" });
          resp.end(JSON.stringify(o));
        };
        if (req.method === "POST" && req.url === "/oauth2/token") {
          const p = new URLSearchParams(corpo);
          discordLog.tokenReqs.push(Object.fromEntries(p));
          if (
            p.get("grant_type") !== "authorization_code" ||
            p.get("code_verifier") !== VERIFIER ||
            p.get("client_id") !== CLIENT_ID ||
            p.get("redirect_uri") !== REDIRECT ||
            p.has("client_secret")
          ) {
            discordLog.falhas.push(Object.fromEntries(p));
            return out(400, { error: "invalid_request" });
          }
          const code = p.get("code") || "";
          if (code === "negado") return out(400, { error: "invalid_grant" });
          if (code === "fora") return out(500, { error: "boom" });
          const m = /^ok:([^:]+):(.+)$/.exec(code);
          if (!m) return out(400, { error: "invalid_grant" });
          return out(200, { access_token: `tok:${m[1]}:${m[2]}`, token_type: "Bearer" });
        }
        if (req.method === "GET" && req.url === "/users/@me") {
          const m = /^Bearer tok:([^:]+):(.+)$/.exec(req.headers.authorization || "");
          if (!m) return out(401, { message: "401" });
          return out(200, { id: m[1], username: m[2], global_name: "Nome " + m[2], avatar: "av" + m[1] });
        }
        out(404, {});
      });
    });
    discord.listen(0, "127.0.0.1", () => {
      discordPorta = discord.address().port;
      res();
    });
  });
}

async function iniciarWrangler() {
  const args = [
    path.join(RAIZ, "node_modules", "wrangler", "bin", "wrangler.js"),
    "dev", "--local",
    "--ip", "127.0.0.1",
    "--port", String(wranglerPorta),
    "--inspector-port", String(await portaLivre()),
    "--persist-to", persist,
    "--var", `DISCORD_API:http://127.0.0.1:${discordPorta}`,
    "--var", `DISCORD_CLIENT_ID:${CLIENT_ID}`,
  ];
  wrangler = spawn(process.execPath, args, {
    cwd: RAIZ,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1" },
  });
  let saida = "";
  wrangler.stdout.on("data", (d) => (saida += d));
  wrangler.stderr.on("data", (d) => (saida += d));
  const limite = Date.now() + 90000;
  while (Date.now() < limite) {
    if (wrangler.exitCode !== null) throw new Error("wrangler saiu cedo:\n" + saida);
    try {
      const r = await fetch(base + "/saude");
      if (r.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error("wrangler nao subiu:\n" + saida);
}

before(async () => {
  persist = fs.mkdtempSync(path.join(os.tmpdir(), "junto-persist-"));
  await iniciarDiscord();
  wranglerPorta = await portaLivre();
  base = `http://127.0.0.1:${wranglerPorta}`;
  await iniciarWrangler();
});

after(async () => {
  matarArvore(wrangler);
  await new Promise((r) => discord.close(r));
  discord.closeAllConnections?.();
  await sleep(500);
  try { fs.rmSync(persist, { recursive: true, force: true }); } catch {}
});

// ---------- helpers ----------

let seq = 0;
const unico = () => `${Date.now().toString(36)}${(seq++).toString(36)}`.slice(-12);

async function post(p, corpo, headers = {}) {
  const r = await fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch {}
  return { status: r.status, json: j, txt };
}

const entrarCom = (code, extra = {}) => post("/entrar", { code, verifier: VERIFIER, redirectUri: REDIRECT, ...extra });

// new user: id and username unique per call
async function novo(prefixo = "u") {
  const u = `${prefixo}${unico()}`;
  const id = String(Math.floor(Math.random() * 1e15) + 1e17);
  const r = await entrarCom(`ok:${id}:${u}`);
  assert.equal(r.status, 200, r.txt);
  return { id, usuario: u, token: r.json.token, eu: r.json.eu };
}

class Cli {
  constructor(token) {
    this.msgs = [];
    this.estados = [];
    this.waiters = [];
    this.fechou = false;
    this.n = 0;
    this.ws = new WebSocket(`ws://127.0.0.1:${wranglerPorta}/ws`, { headers: { authorization: "Bearer " + token } });
    this.ws.on("message", (d) => {
      let m = null;
      try { m = JSON.parse(d.toString()); } catch {}
      if (m && typeof m === "object") {
        this.msgs.push(m);
        if (m.t === "estado") this.estados.push(m);
      }
      this.waiters.slice().forEach((w) => w());
    });
    this.ws.on("close", (c) => {
      this.fechou = true;
      this.codigo = c;
      this.waiters.slice().forEach((w) => w());
    });
    this.ws.on("error", () => {});
  }
  abrir() {
    return new Promise((res, rej) => {
      this.ws.once("open", () => res(this));
      this.ws.once("unexpected-response", (_q, r) => rej(new Error("http " + r.statusCode)));
      this.ws.once("error", rej);
    });
  }
  aguardar(pred, ms = 6000, desc = "") {
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        rej(new Error("timeout " + desc));
      }, ms);
      const w = () => {
        const v = pred();
        if (v) {
          clearTimeout(t);
          this.waiters = this.waiters.filter((x) => x !== w);
          res(v);
        }
      };
      this.waiters.push(w);
      w();
    });
  }
  // latest snapshot satisfying pred (snapshots are complete, so the latest one is what matters)
  estado(pred = () => true, ms) {
    return this.aguardar(() => {
      const e = this.estados[this.estados.length - 1];
      return e && pred(e) ? e : null;
    }, ms, "estado");
  }
  ultimo() { return this.estados[this.estados.length - 1]; }
  async enviar(obj) {
    const n = ++this.n;
    const desde = this.msgs.length;
    this.ws.send(typeof obj === "string" ? obj : JSON.stringify({ ...obj, n }));
    return this.aguardar(() => this.msgs.slice(desde).find((m) => m.t === "resposta"), 6000, "resposta");
  }
  fechar() {
    this.ws.close();
    return this.aguardar(() => this.fechou, 5000, "fechar");
  }
}

async function conectar(u) {
  const c = new Cli(u.token);
  await c.abrir();
  await c.estado();
  return c;
}

// WebSocket upgrade request done by hand, resolves [status, body] (a 101 would resolve [101, ""])
function upgradeRejeitado(headers) {
  return new Promise((res, rej) => {
    const req = http.request({
      host: "127.0.0.1", port: wranglerPorta, path: "/ws", method: "GET", agent: false,
      headers: {
        connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13",
        "sec-websocket-key": Buffer.from("0123456789abcdef").toString("base64"), ...headers,
      },
    }, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => res([r.statusCode, b]));
      r.on("error", rej);
    });
    req.on("upgrade", (_r, sock) => { sock.destroy(); res([101, ""]); });
    req.on("error", rej);
    req.end();
  });
}

const temAmigo =(id, on) => (e) => e.amigos.some((a) => a.id === id && (on === undefined || a.on === on));

async function fazerAmigos(a, ca, b, cb) {
  assert.deepEqual(await ca.enviar({ t: "pedir", usuario: b.usuario }), { t: "resposta", n: ca.n, ok: true });
  await cb.estado((e) => e.recebidos.some((r) => r.id === a.id));
  assert.equal((await cb.enviar({ t: "aceitar", id: a.id })).ok, true);
  await ca.estado(temAmigo(b.id));
  await cb.estado(temAmigo(a.id));
}

// ---------- HTTP ----------

test("/saude e 404", async () => {
  const r = await fetch(base + "/saude");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const n = await fetch(base + "/nada");
  assert.equal(n.status, 404);
  assert.deepEqual(await n.json(), { erro: "nao_encontrado" });
  const g = await fetch(base + "/entrar");
  assert.equal(g.status, 404);
});

test("/entrar ok: token, eu, sem token do Discord; Discord recebeu verifier/client_id/redirect e nenhum secret", async () => {
  const id = "9000000000000001";
  const antes = discordLog.tokenReqs.length;
  const r = await entrarCom(`ok:${id}:Maria_${unico()}`);
  assert.equal(r.status, 200);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.json.eu.id, id);
  assert.equal(r.json.eu.usuario, r.json.eu.usuario.toLowerCase());
  assert.ok(r.json.eu.nome.startsWith("Nome Maria_"));
  assert.equal(r.json.eu.avatar, "av" + id);
  assert.deepEqual(Object.keys(r.json).sort(), ["eu", "token"]);
  assert.ok(!r.txt.includes("tok:"), "token do Discord vazou");
  assert.ok(!r.txt.includes("access_token"));
  assert.equal(discordLog.tokenReqs.length, antes + 1);
  assert.equal(discordLog.falhas.length, 0);
  assert.equal(discordLog.tokenReqs.at(-1).client_id, CLIENT_ID);
});

test("/entrar: erros", async () => {
  let r = await entrarCom("ok:9000000000000002:x1", { redirectUri: "http://127.0.0.1:53682/outro" });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { erro: "pedido_invalido" });
  r = await post("/entrar", "isso nao e json");
  assert.deepEqual([r.status, r.json], [400, { erro: "pedido_invalido" }]);
  r = await post("/entrar", { code: "x", verifier: "curto", redirectUri: REDIRECT });
  assert.equal(r.status, 400);
  r = await post("/entrar", { code: "x".repeat(5000), verifier: VERIFIER, redirectUri: REDIRECT });
  assert.equal(r.status, 400);
  r = await entrarCom("negado");
  assert.deepEqual([r.status, r.json], [401, { erro: "discord_recusou" }]);
  const antes = discordLog.tokenReqs.length;
  r = await entrarCom("fora");
  assert.deepEqual([r.status, r.json], [502, { erro: "discord_fora" }]);
  assert.equal(discordLog.tokenReqs.length - antes, 2, "deveria tentar de novo uma vez");
});

test("/ws sem token ou com token ruim: 401 sessao_invalida", async () => {
  for (const h of [{}, { authorization: "Bearer " + "a".repeat(43) }, { authorization: "Bearer lixo" }]) {
    const st = await upgradeRejeitado(h);
    assert.equal(st[0], 401);
    assert.deepEqual(JSON.parse(st[1]), { erro: "sessao_invalida" });
  }
});

// ---------- amizades ----------

test("pedir -> estado nos dois lados; aceitar -> amigos nos dois", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  assert.equal(ca.ultimo().eu.id, a.id);
  const r = await ca.enviar({ t: "pedir", usuario: "@" + b.usuario.toUpperCase() + " " });
  assert.deepEqual(r, { t: "resposta", n: 1, ok: true });
  const ea = await ca.estado((e) => e.enviados.length === 1);
  assert.equal(ea.enviados[0].usuario, b.usuario);
  assert.equal(ea.enviados[0].nome, b.eu.nome);
  const eb = await cb.estado((e) => e.recebidos.length === 1);
  assert.equal(eb.recebidos[0].id, a.id);
  assert.equal((await cb.enviar({ t: "aceitar", id: a.id })).ok, true);
  const fa = await ca.estado(temAmigo(b.id, true));
  assert.equal(fa.enviados.length, 0);
  const fb = await cb.estado(temAmigo(a.id, true));
  assert.equal(fb.recebidos.length, 0);
  await ca.fechar(); await cb.fechar();
});

test("pedir para nome nunca visto: ok, e aparece para a pessoa no primeiro login", async () => {
  const a = await novo("a");
  const ca = await conectar(a);
  const fantasma = `fant${unico()}`;
  assert.equal((await ca.enviar({ t: "pedir", usuario: fantasma })).ok, true);
  const e = await ca.estado((x) => x.enviados.length === 1);
  assert.deepEqual(e.enviados[0], { usuario: fantasma, nome: null, avatar: null });
  const f = await entrarCom(`ok:9000000000000777${Date.now()}:${fantasma}`);
  assert.equal(f.status, 200);
  const cf = await conectar({ token: f.json.token });
  const ef = await cf.estado((x) => x.recebidos.length === 1);
  assert.equal(ef.recebidos[0].id, a.id);
  // the sender sees the name filled in
  const ea = await ca.estado((x) => x.enviados.length === 1 && x.enviados[0].nome !== null);
  assert.equal(ea.enviados[0].usuario, fantasma);
  await ca.fechar(); await cf.fechar();
});

test("recusar: some do destinatario, remetente nao e avisado", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  await ca.enviar({ t: "pedir", usuario: b.usuario });
  await cb.estado((e) => e.recebidos.length === 1);
  const antes = ca.estados.length;
  assert.equal((await cb.enviar({ t: "recusar", id: a.id })).ok, true);
  await cb.estado((e) => e.recebidos.length === 0 && e.amigos.length === 0);
  await sleep(300);
  assert.equal(ca.estados.length, antes, "remetente nao deveria receber estado novo");
  assert.equal((await cb.enviar({ t: "recusar", id: a.id })).erro, "nao_encontrado");
  await ca.fechar(); await cb.fechar();
});

test("cancelar", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  await ca.enviar({ t: "pedir", usuario: b.usuario });
  await cb.estado((e) => e.recebidos.length === 1);
  assert.equal((await ca.enviar({ t: "cancelar", usuario: b.usuario })).ok, true);
  await ca.estado((e) => e.enviados.length === 0);
  await cb.estado((e) => e.recebidos.length === 0);
  assert.equal((await ca.enviar({ t: "cancelar", usuario: b.usuario })).erro, "nao_encontrado");
  assert.equal((await ca.enviar({ t: "cancelar", usuario: "!" })).erro, "nome_invalido");
  await ca.fechar(); await cb.fechar();
});

test("remover: amizade some nos dois", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  await fazerAmigos(a, ca, b, cb);
  assert.equal((await ca.enviar({ t: "remover", id: b.id })).ok, true);
  await ca.estado((e) => e.amigos.length === 0);
  await cb.estado((e) => e.amigos.length === 0);
  assert.equal((await ca.enviar({ t: "remover", id: b.id })).erro, "nao_encontrado");
  await ca.fechar(); await cb.fechar();
});

test("pedido mutuo aceita sozinho", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  await ca.enviar({ t: "pedir", usuario: b.usuario });
  await cb.estado((e) => e.recebidos.length === 1);
  assert.equal((await cb.enviar({ t: "pedir", usuario: a.usuario })).ok, true);
  const ea = await ca.estado(temAmigo(b.id));
  assert.equal(ea.enviados.length + ea.recebidos.length, 0);
  const eb = await cb.estado(temAmigo(a.id));
  assert.equal(eb.enviados.length + eb.recebidos.length, 0);
  await ca.fechar(); await cb.fechar();
});

test("codigos de erro do contrato", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  for (const nome of ["a", "x".repeat(33), "com espaco", "maiusc!", "", "@", 5, null]) {
    assert.equal((await ca.enviar({ t: "pedir", usuario: nome })).erro, "nome_invalido", String(nome));
  }
  assert.equal((await ca.enviar({ t: "pedir", usuario: a.usuario })).erro, "voce_mesmo");
  assert.equal((await ca.enviar({ t: "pedir", usuario: "@" + a.usuario })).erro, "voce_mesmo");
  await fazerAmigos(a, ca, b, cb);
  assert.equal((await ca.enviar({ t: "pedir", usuario: b.usuario })).erro, "ja_amigos");
  assert.equal((await ca.enviar({ t: "aceitar", id: "123" })).erro, "nao_encontrado");
  assert.equal((await ca.enviar({ t: "aceitar" })).erro, "nao_encontrado");
  assert.equal((await ca.enviar({ t: "recusar", id: "123" })).erro, "nao_encontrado");
  assert.equal((await ca.enviar({ t: "remover", id: "123" })).erro, "nao_encontrado");
  // aceitar a request that was not addressed to me
  const c = await novo("c");
  const cc = await conectar(c);
  await cc.enviar({ t: "pedir", usuario: b.usuario });
  await cb.estado((e) => e.recebidos.length === 1);
  assert.equal((await ca.enviar({ t: "aceitar", id: c.id })).erro, "nao_encontrado");
  await cc.fechar();
  // muitos_pedidos
  const d = await novo("d");
  const cd = await conectar(d);
  const pre = `mp${unico()}`;
  for (let i = 0; i < 50; i++) {
    if (i === 25) await sleep(1100); // stay under the 40 msg/s per-socket abuse cap
    const r = await cd.enviar({ t: "pedir", usuario: `${pre}_${i}` });
    assert.equal(r.ok, true, `pedido ${i}`);
  }
  assert.equal((await cd.enviar({ t: "pedir", usuario: `${pre}_x` })).erro, "muitos_pedidos");
  // repeating an existing pending request is still ok
  assert.equal((await cd.enviar({ t: "pedir", usuario: `${pre}_0` })).ok, true);
  await ca.fechar(); await cb.fechar(); await cd.fechar();
});

test("JSON ruim, t desconhecido e mensagem grande: erro pedido_invalido e socket continua", async () => {
  const a = await novo("a");
  const ca = await conectar(a);
  let r = await ca.enviar("{isso nao");
  assert.deepEqual([r.ok, r.erro], [false, "pedido_invalido"]);
  r = await ca.enviar(JSON.stringify({ t: "xyz", n: 77 }));
  assert.deepEqual([r.ok, r.erro, r.n], [false, "pedido_invalido", 77]);
  r = await ca.enviar("[1,2]");
  assert.equal(r.erro, "pedido_invalido");
  r = await ca.enviar(JSON.stringify({ t: "pedir", n: 78, usuario: "a".repeat(1100) }));
  assert.equal(r.erro, "pedido_invalido");
  assert.equal(ca.fechou, false);
  assert.equal((await ca.enviar({ t: "pedir", usuario: "ninguem_aqui" })).ok, true);
  await ca.fechar();
});

test("ping responde pong", async () => {
  const a = await novo("a");
  const ca = await conectar(a);
  const pong = new Promise((res) => ca.ws.on("message", (d) => d.toString() === "pong" && res(true)));
  // the "pong" is not JSON, so Cli's handler throws on it: guard by listening raw
  ca.ws.send("ping");
  assert.equal(await Promise.race([pong, sleep(5000).then(() => false)]), true);
  await ca.fechar();
});

test("presenca: on/off quando o unico socket fecha; segue on com 2 sockets", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a);
  const cb1 = await conectar(b);
  await fazerAmigos(a, ca, b, cb1);
  await ca.estado(temAmigo(b.id, true));
  await cb1.fechar();
  await ca.estado(temAmigo(b.id, false));
  const cb2 = await conectar(b);
  await ca.estado(temAmigo(b.id, true));
  const cb3 = await conectar(b);
  await cb2.fechar();
  await sleep(700);
  assert.equal(ca.ultimo().amigos.find((x) => x.id === b.id).on, true, "segue online com o 2o socket");
  await cb3.fechar();
  await ca.estado(temAmigo(b.id, false));
  await ca.fechar();
});

test("/sair invalida o token e fecha o socket", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  await fazerAmigos(a, ca, b, cb);
  await ca.estado(temAmigo(b.id, true));
  const r = await fetch(base + "/sair", { method: "POST", headers: { authorization: "Bearer " + b.token } });
  assert.equal(r.status, 204);
  await cb.aguardar(() => cb.fechou, 5000, "socket fechado");
  await ca.estado(temAmigo(b.id, false));
  const st = await upgradeRejeitado({ authorization: "Bearer " + b.token });
  assert.equal(st[0], 401);
  await ca.fechar();
});

test("reiniciar o wrangler mantem os dados (mesmo persist)", async () => {
  const a = await novo("a"), b = await novo("b");
  const ca = await conectar(a), cb = await conectar(b);
  await fazerAmigos(a, ca, b, cb);
  await ca.enviar({ t: "pedir", usuario: "pendente_restart" });
  matarArvore(wrangler);
  await sleep(1500);
  await iniciarWrangler();
  const ca2 = await conectar(a); // same token still valid
  const e = await ca2.estado();
  assert.equal(e.amigos.length, 1);
  assert.equal(e.amigos[0].id, b.id);
  assert.equal(e.amigos[0].on, false);
  assert.equal(e.enviados.length, 1);
  assert.equal(e.enviados[0].usuario, "pendente_restart");
  await ca2.fechar();
});

// ---------- stage 2: offers, sessions, synced playback ----------

const sessaoMsg = (c, pred = () => true, ms) =>
  c.aguardar(() => {
    const l = c.msgs.filter((m) => m.t === "sessao" && !m.fim);
    const m = l[l.length - 1];
    return m && pred(m) ? m : null;
  }, ms, "sessao");
const fimMsg = (c, fim, ms = 6000) => c.aguardar(() => c.msgs.find((m) => m.t === "sessao" && m.fim === fim), ms, "fim " + fim);
const addCru = (c, n, extra = {}) =>
  c.enviar({ t: "adicionar", url: "https://exemplo.com/v/" + n, titulo: "Faixa " + n, sub: "Artista", dur: 200, ...extra });
// same as addCru, but waits out the per-person 2 s limit ("devagar") so tests keep their intent
async function add(c, n, extra = {}) {
  for (;;) {
    const r = await addCru(c, n, extra);
    if (r.erro !== "devagar") return r;
    await sleep(r.espera + 30);
  }
}
const erroDe = (r) => (r.ok ? "ok" : r.erro);

// dono a + member b (friends), b already in a's session
async function cenario(modo = "todos", tipo = "ouvir") {
  const a = await novo("d"), b = await novo("m");
  const ca = await conectar(a), cb = await conectar(b);
  await fazerAmigos(a, ca, b, cb);
  assert.equal((await ca.enviar({ t: "oferecer", tipo, modo })).ok, true);
  await cb.estado((e) => e.amigos.some((x) => x.id === a.id && x.oferta));
  assert.equal((await cb.enviar({ t: "entrar_sessao", dono: a.id })).ok, true);
  await sessaoMsg(ca, (s) => s.gente.includes(b.id));
  await sessaoMsg(cb, (s) => s.gente.includes(b.id));
  return { a, b, ca, cb };
}

test("etapa2: oferecer aparece so para amigos, valida tipo/modo, trocar modo mantem a fila", async () => {
  const a = await novo("d"), b = await novo("m"), x = await novo("x");
  const ca = await conectar(a), cb = await conectar(b), cx = await conectar(x);
  await fazerAmigos(a, ca, b, cb);
  assert.equal(erroDe(await ca.enviar({ t: "oferecer", tipo: "xx", modo: "todos" })), "pedido_invalido");
  assert.equal(erroDe(await ca.enviar({ t: "oferecer", tipo: "ouvir", modo: "xx" })), "pedido_invalido");
  assert.equal((await ca.enviar({ t: "oferecer", tipo: "ver", modo: "fila" })).ok, true);
  const e = await cb.estado((s) => s.amigos.some((m) => m.id === a.id && m.oferta));
  const of = e.amigos.find((m) => m.id === a.id).oferta;
  assert.deepEqual({ ...of, arte: undefined }, { tipo: "ver", modo: "fila", titulo: null, arte: undefined, gente: 0 });
  assert.ok(of.arte >= 0 && of.arte <= 7);
  assert.equal((await ca.estado((s) => s.sessao)).sessao.dono, a.id);
  assert.equal(cb.ultimo().sessao, null);
  const s0 = await sessaoMsg(ca);
  assert.equal(s0.dono, a.id);
  assert.deepEqual(s0.fila, []);
  assert.equal(s0.P.item, null);
  // stranger cannot enter, friend can; stranger sees no offer
  assert.equal(erroDe(await cx.enviar({ t: "entrar_sessao", dono: a.id })), "nao_encontrado");
  assert.equal(erroDe(await ca.enviar({ t: "entrar_sessao", dono: a.id })), "pedido_invalido");
  assert.equal(erroDe(await cb.enviar({ t: "entrar_sessao", dono: "999" })), "nao_encontrado");
  assert.equal((await add(ca, 1)).ok, true);
  assert.equal((await ca.enviar({ t: "oferecer", tipo: "ouvir", modo: "todos" })).ok, true);
  const s1 = await sessaoMsg(ca, (s) => s.modo === "todos");
  assert.equal(s1.tipo, "ouvir");
  assert.equal(s1.fila.length, 1);
  await cb.estado((s) => s.amigos.find((m) => m.id === a.id).oferta.modo === "todos");
  for (const c of [ca, cb, cx]) await c.fechar();
});

test("etapa2: entrar e sair da sessao, gente e estado.sessao", async () => {
  const { a, b, ca, cb } = await cenario();
  const c = await novo("c");
  const cc = await conectar(c);
  assert.equal((await cb.estado((s) => s.sessao)).sessao.dono, a.id);
  const e = await cb.estado((s) => s.amigos.length === 1 && s.amigos[0].oferta && s.amigos[0].oferta.gente === 1);
  assert.equal(e.amigos[0].oferta.gente, 1);
  assert.equal(erroDe(await cb.enviar({ t: "sair_sessao" })), "ok");
  await cb.estado((s) => s.sessao === null);
  const s = await sessaoMsg(ca, (m) => m.gente.length === 0);
  assert.deepEqual(s.gente, []);
  assert.equal(erroDe(await cb.enviar({ t: "sair_sessao" })), "nao_encontrado");
  assert.equal(erroDe(await ca.enviar({ t: "sair_sessao" })), "nao_encontrado"); // dono uses parar
  // member of one session joining another leaves the first
  assert.equal((await cb.enviar({ t: "entrar_sessao", dono: a.id })).ok, true);
  await sessaoMsg(ca, (m) => m.gente.includes(b.id));
  await fazerAmigos(c, cc, b, cb);
  assert.equal((await cc.enviar({ t: "oferecer", tipo: "ouvir", modo: "todos" })).ok, true);
  await cb.estado((e2) => e2.amigos.some((m) => m.id === c.id && m.oferta));
  assert.equal((await cb.enviar({ t: "entrar_sessao", dono: c.id })).ok, true);
  await sessaoMsg(ca, (m) => m.gente.length === 0);
  await sessaoMsg(cc, (m) => m.gente.includes(b.id));
  assert.equal((await cb.estado((s2) => s2.sessao && s2.sessao.dono === c.id)).sessao.dono, c.id);
  for (const x of [ca, cb, cc]) await x.fechar();
});

test("etapa2: adicionar com fila vazia comeca em 2500 ms; segundo vai pra fila; formato do item", async () => {
  const { a, b, ca, cb } = await cenario();
  assert.equal((await add(ca, 1)).ok, true);
  const s = await sessaoMsg(cb, (m) => m.fila.length === 1);
  const it = s.fila[0];
  assert.equal(it.url, "https://exemplo.com/v/1");
  assert.equal(it.titulo, "Faixa 1");
  assert.equal(it.sub, "Artista");
  assert.equal(it.dur, 200);
  assert.equal(it.por, a.id);
  assert.equal(it.tipo, "link");
  assert.match(it.id, /^[A-Za-z0-9_-]{8}$/);
  assert.ok(Number.isInteger(it.arte) && it.arte >= 0 && it.arte <= 7);
  assert.equal(s.P.item, it.id);
  assert.equal(s.P.tocando, true);
  assert.equal(s.P.pos, 0);
  const atraso = s.P.base - s.agora;
  assert.ok(atraso > 1800 && atraso <= 2500, "atraso " + atraso);
  assert.equal(s.gente.length, 1);
  // estado shows current titulo to friends
  const e = await cb.estado((x) => x.amigos.some((m) => m.oferta && m.oferta.titulo === "Faixa 1"));
  assert.equal(e.amigos[0].oferta.arte, it.arte);
  // second goes to the queue, P untouched
  assert.equal((await add(cb, 2, { dur: null, sub: undefined })).ok, true);
  const s2 = await sessaoMsg(ca, (m) => m.fila.length === 2);
  assert.equal(s2.fila[1].por, b.id);
  assert.equal(s2.fila[1].dur, null);
  assert.equal(s2.P.item, it.id);
  assert.deepEqual(s2.P, s.P);
  // validation
  assert.equal(erroDe(await add(ca, 3, { url: "nada" })), "pedido_invalido");
  assert.equal(erroDe(await add(ca, 3, { url: "https://x.com/" + "a".repeat(2050) })), "pedido_invalido");
  assert.equal(erroDe(await add(ca, 3, { titulo: 5 })), "pedido_invalido");
  assert.equal(erroDe(await add(ca, 3, { dur: "x" })), "pedido_invalido");
  const longo = await add(ca, 4, { titulo: "t".repeat(500), sub: "s".repeat(500) });
  assert.equal(longo.ok, true);
  const s3 = await sessaoMsg(ca, (m) => m.fila.length === 3);
  assert.equal(s3.fila[2].titulo.length, 200);
  assert.equal(s3.fila[2].sub.length, 120);
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: permissoes por modo", async () => {
  // modo dono: member can do nothing
  let { ca, cb } = await cenario("dono");
  assert.equal((await add(ca, 1)).ok, true);
  const s = await sessaoMsg(cb, (m) => m.fila.length === 1);
  const id = s.fila[0].id;
  assert.equal(erroDe(await add(cb, 2)), "sem_permissao");
  for (const t of ["tocar", "pausar", "pular", "voltar"]) assert.equal(erroDe(await cb.enviar({ t })), "sem_permissao", t);
  assert.equal(erroDe(await cb.enviar({ t: "buscar", pos: 5 })), "sem_permissao");
  assert.equal(erroDe(await cb.enviar({ t: "tirar", id })), "sem_permissao");
  assert.equal((await ca.enviar({ t: "pausar" })).ok, true);
  for (const c of [ca, cb]) await c.fechar();

  // modo fila: member adds, but cannot control
  ({ ca, cb } = await cenario("fila"));
  assert.equal((await add(cb, 1)).ok, true);
  await sessaoMsg(ca, (m) => m.fila.length === 1);
  assert.equal((await add(cb, 2)).ok, true);
  const s2 = await sessaoMsg(ca, (m) => m.fila.length === 2);
  for (const t of ["tocar", "pausar", "pular", "voltar"]) assert.equal(erroDe(await cb.enviar({ t })), "sem_permissao", t);
  assert.equal(erroDe(await cb.enviar({ t: "buscar", pos: 5 })), "sem_permissao");
  assert.equal(erroDe(await cb.enviar({ t: "tirar", id: s2.fila[1].id })), "sem_permissao");
  assert.equal(erroDe(await ca.enviar({ t: "tirar", id: s2.fila[1].id })), "ok");
  for (const c of [ca, cb]) await c.fechar();

  // modo todos: member does everything
  ({ ca, cb } = await cenario("todos"));
  assert.equal((await add(cb, 1)).ok, true);
  assert.equal((await add(cb, 2)).ok, true);
  const s3 = await sessaoMsg(cb, (m) => m.fila.length === 2);
  for (const m of [{ t: "pausar" }, { t: "tocar" }, { t: "buscar", pos: 5 }, { t: "voltar" }, { t: "tirar", id: s3.fila[1].id }, { t: "pular" }]) {
    assert.equal(erroDe(await cb.enviar(m)), "ok", m.t);
  }
  // not in a session: nothing works
  const x = await novo("x");
  const cx = await conectar(x);
  assert.equal(erroDe(await add(cx, 1)), "nao_encontrado");
  assert.equal(erroDe(await cx.enviar({ t: "pular" })), "nao_encontrado");
  assert.equal(erroDe(await cx.enviar({ t: "parar" })), "nao_encontrado");
  for (const c of [ca, cb, cx]) await c.fechar();
});

test("etapa2: tocar, pausar, buscar, voltar, pular, tirar", async () => {
  const { ca, cb } = await cenario();
  await add(ca, 1); await add(ca, 2); await add(ca, 3);
  let s = await sessaoMsg(cb, (m) => m.fila.length === 3);
  const [i1, i2, i3] = s.fila.map((i) => i.id);
  assert.equal(erroDe(await ca.enviar({ t: "tirar", id: i1 })), "item_atual");
  assert.equal(erroDe(await ca.enviar({ t: "tirar", id: "nope" })), "nao_encontrado");
  // pausar with explicit pos
  assert.equal((await ca.enviar({ t: "pausar", pos: 42 })).ok, true);
  s = await sessaoMsg(cb, (m) => !m.P.tocando);
  assert.equal(s.P.pos, 42);
  assert.equal(s.P.item, i1);
  // buscar keeps tocando=false
  assert.equal((await ca.enviar({ t: "buscar", pos: 50 })).ok, true);
  s = await sessaoMsg(cb, (m) => m.P.pos === 50);
  assert.equal(s.P.tocando, false);
  assert.equal(erroDe(await ca.enviar({ t: "buscar" })), "pedido_invalido");
  assert.equal(erroDe(await ca.enviar({ t: "buscar", pos: -1 })), "pedido_invalido");
  // tocar: base = now + 300, pos given
  assert.equal((await ca.enviar({ t: "tocar", pos: 60 })).ok, true);
  s = await sessaoMsg(cb, (m) => m.P.tocando);
  assert.equal(s.P.pos, 60);
  const d = s.P.base - s.agora;
  assert.ok(d > 100 && d <= 300, "atraso tocar " + d);
  // buscar keeps tocando
  assert.equal((await ca.enviar({ t: "buscar", pos: 10 })).ok, true);
  s = await sessaoMsg(cb, (m) => m.P.pos === 10);
  assert.equal(s.P.tocando, true);
  // pausar without pos freezes near current position
  await sleep(1200);
  assert.equal((await ca.enviar({ t: "pausar" })).ok, true);
  s = await sessaoMsg(cb, (m) => !m.P.tocando);
  assert.ok(s.P.pos >= 11 && s.P.pos < 13.5, "pos " + s.P.pos);
  // voltar -> 0
  assert.equal((await ca.enviar({ t: "voltar" })).ok, true);
  s = await sessaoMsg(cb, (m) => m.P.pos === 0);
  assert.equal(s.P.item, i1);
  // tirar queued item
  assert.equal((await ca.enviar({ t: "tirar", id: i2 })).ok, true);
  s = await sessaoMsg(cb, (m) => m.fila.length === 2);
  assert.deepEqual(s.fila.map((i) => i.id), [i1, i3]);
  // pular: next becomes current, tocando, base now+2500
  assert.equal((await ca.enviar({ t: "pular" })).ok, true);
  s = await sessaoMsg(cb, (m) => m.fila.length === 1);
  assert.equal(s.P.item, i3);
  assert.equal(s.P.tocando, true);
  assert.equal(s.P.pos, 0);
  assert.ok(s.P.base - s.agora > 1800 && s.P.base - s.agora <= 2500);
  // pular with nothing after: item null
  assert.equal((await ca.enviar({ t: "pular" })).ok, true);
  s = await sessaoMsg(cb, (m) => m.fila.length === 0);
  assert.equal(s.P.item, null);
  assert.equal(s.P.tocando, false);
  assert.equal(erroDe(await ca.enviar({ t: "pular" })), "pedido_invalido");
  await cb.estado((x) => x.amigos[0].oferta && x.amigos[0].oferta.titulo === null);
  // new item after empty starts again with the delay
  await add(cb, 9);
  s = await sessaoMsg(ca, (m) => m.fila.length === 1);
  assert.equal(s.P.item, s.fila[0].id);
  assert.ok(s.P.tocando && s.P.base - s.agora > 1800);
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: fim so avanca se bate com o atual e a posicao; duplicado ignorado", async () => {
  const { ca, cb } = await cenario();
  await add(ca, 1, { dur: 200 }); await add(ca, 2, { dur: null }); await add(ca, 3, { dur: 1 });
  let s = await sessaoMsg(cb, (m) => m.fila.length === 3);
  const [i1, i2, i3] = s.fila.map((i) => i.id);
  // too early (pos ~0 of 200 s): ignored but answered ok
  assert.equal(erroDe(await cb.enviar({ t: "fim", item: i1 })), "ok");
  // not the current item: ignored
  assert.equal(erroDe(await cb.enviar({ t: "fim", item: i2 })), "ok");
  assert.equal(erroDe(await cb.enviar({ t: "fim", item: "zzz" })), "ok");
  assert.equal(erroDe(await cb.enviar({ t: "fim" })), "pedido_invalido");
  await sleep(300);
  s = await sessaoMsg(ca);
  assert.equal(s.fila.length, 3);
  assert.equal(s.P.item, i1);
  // near the end it advances
  assert.equal((await ca.enviar({ t: "buscar", pos: 199 })).ok, true);
  assert.equal((await cb.enviar({ t: "fim", item: i1 })).ok, true);
  s = await sessaoMsg(ca, (m) => m.P.item === i2);
  assert.equal(s.fila.length, 2);
  // duplicate report from the other client for the same item: ignored
  assert.equal((await ca.enviar({ t: "fim", item: i1 })).ok, true);
  // dur null advances right away; the duplicate afterwards does not skip i3
  assert.equal((await cb.enviar({ t: "fim", item: i2 })).ok, true);
  assert.equal((await ca.enviar({ t: "fim", item: i2 })).ok, true);
  await sessaoMsg(ca, (m) => m.P.item === i3);
  await sleep(300);
  s = await sessaoMsg(ca);
  assert.equal(s.P.item, i3);
  assert.equal(s.fila.length, 1);
  // last one (dur 1) ends -> empty
  assert.equal((await cb.enviar({ t: "fim", item: i3 })).ok, true);
  s = await sessaoMsg(ca, (m) => m.P.item === null);
  assert.equal(s.fila.length, 0);
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: fim de nao-dono em modo dono com dur null e ignorado", async () => {
  const { ca, cb } = await cenario("dono");
  await add(ca, 1, { dur: null }); await add(ca, 2, { dur: null });
  let s = await sessaoMsg(cb, (m) => m.fila.length === 2);
  const [i1] = s.fila.map((i) => i.id);
  assert.equal(erroDe(await cb.enviar({ t: "fim", item: i1 })), "ok");
  await sleep(300);
  s = await sessaoMsg(ca);
  assert.equal(s.fila.length, 2);
  assert.equal(s.P.item, i1);
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: entrada tardia recebe a fila e P atuais", async () => {
  const { a, ca, cb } = await cenario();
  await add(ca, 1); await add(ca, 2);
  await sessaoMsg(ca, (m) => m.fila.length === 2);
  assert.equal((await ca.enviar({ t: "pausar", pos: 30 })).ok, true);
  const c = await novo("late");
  const cc = await conectar(c);
  await fazerAmigos(a, ca, c, cc);
  await cc.estado((e) => e.amigos.some((m) => m.id === a.id && m.oferta && m.oferta.gente === 1));
  assert.equal((await cc.enviar({ t: "entrar_sessao", dono: a.id })).ok, true);
  const s = await sessaoMsg(cc, (m) => m.gente.includes(c.id));
  assert.equal(s.fila.length, 2);
  assert.equal(s.P.tocando, false);
  assert.equal(s.P.pos, 30);
  assert.equal(s.P.item, s.fila[0].id);
  assert.equal(s.dono, a.id);
  assert.ok(Math.abs(s.agora - Date.now()) < 5000);
  assert.equal(s.gente.length, 2);
  // reconnecting member gets the snapshot again
  await cc.fechar();
  const cc2 = await conectar(c);
  const s2 = await sessaoMsg(cc2, (m) => m.fila.length === 2);
  assert.equal(s2.P.pos, 30);
  assert.equal((await cc2.estado((e) => e.sessao)).sessao.dono, a.id);
  for (const x of [ca, cb, cc2]) await x.fechar();
});

test("etapa2: fila cheia em 100 itens", async () => {
  const { ca, cb } = await cenario();
  // each person: 1 add / 2 s, so two people fill the session at the 1 / s release rate
  await Promise.all([ca, cb].map(async (c, k) => {
    for (let i = k; i < 100; i += 2) assert.equal((await add(c, i)).ok, true, "item " + i);
  }));
  assert.equal(erroDe(await add(ca, 100)), "fila_cheia");
  const s = await sessaoMsg(cb, (m) => m.fila.length === 100, 8000);
  assert.equal(s.fila.length, 100);
  assert.equal((await ca.enviar({ t: "pular" })).ok, true);
  assert.equal(erroDe(await add(cb, 101)), "ok");
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: limite de 4 KB so para adicionar; hora responde sem resposta", async () => {
  const { ca, cb } = await cenario();
  const grande = await add(ca, 1, { url: "https://exemplo.com/" + "a".repeat(2000), sub: "s".repeat(100) });
  assert.equal(grande.ok, true);
  const url = "https://exemplo.com/" + "b".repeat(2020);
  await sleep(2100); // per-person add limit
  assert.equal((await ca.enviar({ t: "adicionar", url, titulo: "t".repeat(1500), sub: "x", dur: 3 })).ok, true);
  // over 4 KB: rejected, socket stays
  const r = await ca.enviar({ t: "adicionar", url: "https://x.com/", titulo: "t".repeat(4200), sub: "", dur: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "pedido_invalido");
  // between 1 KB and 4 KB is only for adicionar
  const r2 = await ca.enviar({ t: "pedir", usuario: "abc", lixo: "x".repeat(1500) });
  assert.equal(r2.ok, false);
  assert.equal(r2.erro, "pedido_invalido");
  // hora
  const antes = Date.now();
  ca.ws.send(JSON.stringify({ t: "hora", n: 77, c: 123456 }));
  const h = await ca.aguardar(() => ca.msgs.find((m) => m.t === "hora"), 3000, "hora");
  assert.deepEqual(Object.keys(h).sort(), ["c", "n", "s", "t"]);
  assert.equal(h.n, 77);
  assert.equal(h.c, 123456);
  assert.ok(h.s >= antes - 50 && h.s <= Date.now() + 50);
  assert.equal(ca.msgs.filter((m) => m.t === "resposta" && m.n === 77).length, 0);
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: parar encerra para todos com dono_parou e some do estado", async () => {
  const { a, ca, cb } = await cenario();
  await add(ca, 1);
  assert.equal((await ca.enviar({ t: "parar" })).ok, true);
  await fimMsg(cb, "dono_parou");
  await fimMsg(ca, "dono_parou");
  await cb.estado((e) => e.sessao === null && e.amigos[0].oferta === null);
  await ca.estado((e) => e.sessao === null);
  assert.equal(erroDe(await ca.enviar({ t: "parar" })), "nao_encontrado");
  assert.equal(erroDe(await cb.enviar({ t: "entrar_sessao", dono: a.id })), "nao_encontrado");
  assert.equal(erroDe(await add(cb, 2)), "nao_encontrado");
  // a new offer starts clean
  assert.equal((await ca.enviar({ t: "oferecer", tipo: "ouvir", modo: "todos" })).ok, true);
  const s = await sessaoMsg(ca, (m) => m.gente.length === 0 && m.fila.length === 0);
  assert.equal(s.P.item, null);
  // dono joining another session ends their own offer
  const o = await novo("o");
  const co = await conectar(o);
  await fazerAmigos(a, ca, o, co);
  assert.equal((await co.enviar({ t: "oferecer", tipo: "ver", modo: "dono" })).ok, true);
  await ca.estado((e) => e.amigos.some((m) => m.id === o.id && m.oferta));
  assert.equal((await cb.enviar({ t: "entrar_sessao", dono: a.id })).ok, true);
  await sessaoMsg(ca, (m) => m.gente.length === 1);
  const antes = cb.msgs.length;
  assert.equal((await ca.enviar({ t: "entrar_sessao", dono: o.id })).ok, true);
  await cb.aguardar(() => cb.msgs.slice(antes).find((m) => m.t === "sessao" && m.fim === "dono_parou"), 6000, "fim dono_parou");
  assert.equal((await ca.estado((e) => e.sessao && e.sessao.dono === o.id)).sessao.dono, o.id);
  for (const c of [ca, cb, co]) await c.fechar();
});

test("etapa2: remover amizade tira o membro da sessao (removido)", async () => {
  const { a, b, ca, cb } = await cenario();
  assert.equal((await ca.enviar({ t: "remover", id: b.id })).ok, true);
  await fimMsg(cb, "removido");
  await cb.estado((e) => e.sessao === null);
  const s = await sessaoMsg(ca, (m) => m.gente.length === 0);
  assert.deepEqual(s.gente, []);
  assert.equal(erroDe(await cb.enviar({ t: "entrar_sessao", dono: a.id })), "nao_encontrado");
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: dono sai (logout) encerra com dono_saiu", async () => {
  const { a, ca, cb } = await cenario();
  await add(ca, 1);
  const r = await post("/sair", {}, { authorization: "Bearer " + a.token });
  assert.equal(r.status, 204);
  await fimMsg(cb, "dono_saiu");
  await cb.estado((e) => e.sessao === null && e.amigos[0].oferta === null);
  await cb.fechar();
});

test("etapa2: dono volta dentro de 60 s mantem a sessao; sem socket por 60 s encerra com dono_saiu", async () => {
  const { a, b, ca, cb } = await cenario();
  await add(ca, 1);
  await sessaoMsg(cb, (m) => m.fila.length === 1);
  await ca.fechar();
  await cb.estado((e) => e.amigos[0].on === false);
  await sleep(1500);
  assert.equal(cb.msgs.some((m) => m.t === "sessao" && m.fim), false);
  const ca2 = await conectar(a); // back within grace: session intact
  const s = await sessaoMsg(ca2, (m) => m.fila.length === 1);
  assert.deepEqual(s.gente, [b.id]);
  // now leave for good
  await ca2.fechar();
  const t0 = Date.now();
  await sleep(5000);
  assert.equal(cb.msgs.some((m) => m.t === "sessao" && m.fim), false, "ended too early");
  await fimMsg(cb, "dono_saiu", 80000);
  const dt = Date.now() - t0;
  assert.ok(dt >= 54000, "ended after " + dt + " ms");
  await cb.estado((e) => e.sessao === null && e.amigos[0].oferta === null);
  await cb.fechar();
});

test("etapa2: ofertas sobrevivem a reinicio do servidor (tabela ofertas)", async () => {
  const { a, b, ca, cb } = await cenario("fila", "ver");
  await add(ca, 1); await add(cb, 2);
  await sessaoMsg(ca, (m) => m.fila.length === 2);
  await ca.enviar({ t: "pausar", pos: 12 });
  matarArvore(wrangler);
  await sleep(1500);
  await iniciarWrangler();
  const ca2 = await conectar(a);
  const s = await sessaoMsg(ca2, (m) => m.fila.length === 2);
  assert.equal(s.tipo, "ver");
  assert.equal(s.modo, "fila");
  assert.deepEqual(s.gente, []); // b is not connected yet
  assert.equal(s.P.pos, 12);
  assert.equal(s.P.tocando, false);
  const cb2 = await conectar(b);
  const s2 = await sessaoMsg(cb2, (m) => m.fila.length === 2);
  assert.equal(s2.dono, a.id);
  assert.deepEqual(s2.gente, [b.id]);
  assert.equal((await cb2.estado((e) => e.sessao)).sessao.dono, a.id);
  for (const c of [ca2, cb2]) await c.fechar();
});

test("etapa2: adicionar rapido da mesma pessoa -> devagar com espera; so conta o que entrou", async () => {
  const { a, ca, cb } = await cenario();
  const r1 = await addCru(ca, 1);
  assert.deepEqual(r1, { t: "resposta", n: r1.n, ok: true });
  const r2 = await addCru(ca, 2);
  assert.equal(r2.ok, false);
  assert.equal(r2.erro, "devagar");
  assert.ok(Number.isInteger(r2.espera) && r2.espera > 1000 && r2.espera <= 2000, "espera " + r2.espera);
  assert.deepEqual(Object.keys(r2).sort(), ["erro", "espera", "n", "ok", "t"]);
  // invalid add does not use up the slot
  await sleep(r2.espera + 50);
  assert.equal(erroDe(await addCru(ca, 3, { url: "nada" })), "pedido_invalido");
  assert.equal(erroDe(await addCru(ca, 3)), "ok");
  const s = await sessaoMsg(cb, (m) => m.fila.length === 2, 4000);
  assert.deepEqual(s.fila.map((i) => i.url), ["https://exemplo.com/v/1", "https://exemplo.com/v/3"]);
  assert.ok(s.fila.every((i) => i.por === a.id));
  for (const c of [ca, cb]) await c.fechar();
});

test("etapa2: sem_permissao vence devagar", async () => {
  const { ca, cb } = await cenario("dono");
  assert.equal(erroDe(await addCru(ca, 1)), "ok");
  assert.equal(erroDe(await addCru(cb, 1)), "sem_permissao");
  assert.equal(erroDe(await addCru(cb, 2)), "sem_permissao"); // never reaches the rate limit
  assert.equal(erroDe(await addCru(ca, 2)), "devagar");
  const x = await novo("x");
  const cx = await conectar(x);
  assert.equal(erroDe(await addCru(cx, 1)), "nao_encontrado");
  assert.equal(erroDe(await addCru(cx, 2)), "nao_encontrado");
  for (const c of [ca, cb, cx]) await c.fechar();
});

test("etapa2: duas pessoas ao mesmo tempo entram na ordem de envio, 1 por segundo", async () => {
  const a = await novo("d"), b = await novo("m"), c = await novo("c");
  const [ca, cb, cc] = [await conectar(a), await conectar(b), await conectar(c)];
  await fazerAmigos(a, ca, b, cb);
  await fazerAmigos(a, ca, c, cc);
  assert.equal((await ca.enviar({ t: "oferecer", tipo: "ouvir", modo: "todos" })).ok, true);
  for (const [x, cx] of [[b, cb], [c, cc]]) {
    await cx.estado((e) => e.amigos.some((m) => m.id === a.id && m.oferta));
    assert.equal((await cx.enviar({ t: "entrar_sessao", dono: a.id })).ok, true);
  }
  await sessaoMsg(ca, (m) => m.gente.length === 2);
  // dono, b and c send within ~100 ms (40 ms apart so arrival order across sockets is deterministic)
  const t0 = Date.now();
  const envios = [addCru(ca, 1)];
  await sleep(40); envios.push(addCru(cb, 2));
  await sleep(40); envios.push(addCru(cc, 3));
  const rs = await Promise.all(envios);
  assert.deepEqual(rs.map(erroDe), ["ok", "ok", "ok"]);
  assert.ok(Date.now() - t0 < 900, "replies are immediate");
  const vistos = new Map(); // item count -> time the snapshot with that many arrived
  const fim = Date.now() + 6000;
  while (vistos.size < 3 && Date.now() < fim) {
    for (const m of ca.msgs) if (m.t === "sessao" && !m.fim && m.fila.length && !vistos.has(m.fila.length)) vistos.set(m.fila.length, m.agora);
    await sleep(20);
  }
  assert.equal(vistos.size, 3, "3 releases");
  const s = ca.msgs.filter((m) => m.t === "sessao" && !m.fim).pop();
  assert.deepEqual(s.fila.map((i) => i.url.slice(-1)), ["1", "2", "3"], "send order");
  assert.ok(vistos.get(2) - vistos.get(1) >= 900, "gap 1->2 " + (vistos.get(2) - vistos.get(1)));
  assert.ok(vistos.get(3) - vistos.get(2) >= 900, "gap 2->3 " + (vistos.get(3) - vistos.get(2)));
  for (const x of [ca, cb, cc]) await x.fechar();
});

test("etapa2: sessao encerrada descarta o que esperava na fila de adds", async () => {
  const { a, ca, cb } = await cenario();
  const c = await novo("c");
  const cc = await conectar(c);
  await fazerAmigos(a, ca, c, cc);
  await cc.estado((e) => e.amigos.some((m) => m.id === a.id && m.oferta));
  assert.equal((await cc.enviar({ t: "entrar_sessao", dono: a.id })).ok, true);
  await sessaoMsg(ca, (m) => m.gente.length === 2);
  const rs = await Promise.all([addCru(ca, 1), addCru(cb, 2), addCru(cc, 3)]);
  assert.deepEqual(rs.map(erroDe), ["ok", "ok", "ok"]);
  assert.equal((await ca.enviar({ t: "parar" })).ok, true);
  await fimMsg(cb, "dono_parou");
  assert.equal((await ca.enviar({ t: "oferecer", tipo: "ouvir", modo: "todos" })).ok, true);
  await sleep(2500);
  const s = await sessaoMsg(ca);
  assert.equal(s.fila.length, 0, "pending adds of the old session were dropped");
  for (const x of [ca, cb, cc]) await x.fechar();
});

test("etapa2: mais de 40 mensagens em 1 s no mesmo socket: extras ignoradas, sem desconectar; hora conta", async () => {
  const { ca } = await cenario();
  await sleep(1100); // fresh 1 s window
  const antes = ca.msgs.length;
  for (let i = 0; i < 60; i++) ca.ws.send(JSON.stringify({ t: "hora", n: 1000 + i, c: i }));
  await sleep(700);
  const horas = ca.msgs.slice(antes).filter((m) => m.t === "hora");
  assert.ok(horas.length >= 35 && horas.length <= 41, "horas " + horas.length);
  assert.equal(ca.fechou, false);
  await sleep(1100);
  assert.equal(erroDe(await ca.enviar({ t: "pular" })), "pedido_invalido"); // still connected and answered
});
