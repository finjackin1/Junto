# Junto stage 1 contract: server <-> app <-> screen. Change here first.

## Login (Discord OAuth2 code + PKCE S256, public client, scope identify)
1. App: verifier 32 random bytes base64url; challenge = base64url(sha256(verifier)); state 16 random bytes.
2. App listens on 127.0.0.1:53682 path /callback, opens system browser at https://discord.com/oauth2/authorize?response_type=code&client_id=..&scope=identify&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback&state=..&code_challenge=..&code_challenge_method=S256&prompt=none
3. Callback checks state. error=interaction_required/consent_required/login_required: redirect the browser once to the same authorize URL without prompt=none. Otherwise app POST {servidor}/entrar JSON {code, verifier, redirectUri}; the browser page answers after that result.
4. Worker: redirectUri must equal env REDIRECT_URI exactly, else 400. POST {DISCORD_API}/oauth2/token (urlencoded: grant_type=authorization_code, code, redirect_uri, client_id, code_verifier; no secret). GET {DISCORD_API}/users/@me with Bearer. Both calls send a User-Agent. Discard the Discord token (never stored, never returned). Retry once on 429/5xx honoring retry-after up to 3 s.
5. Worker asks DO to upsert user, creates session: 32 random bytes base64url returned once; only SHA-256 stored. Expires 90 days, renewed on connect when under 30 days left (avoid writes).
Responses: 200 {token, eu}; 400 {erro:"pedido_invalido"}; 401 {erro:"discord_recusou"}; 502 {erro:"discord_fora"}.

## HTTP
- GET /saude -> 200 {ok:true}
- POST /entrar (above). Handled in the stateless Worker until Discord has confirmed; only then touches the DO, so spam never wakes it. Body limit 4 KB.
- POST /sair, Authorization: Bearer token -> 204; deletes session, closes its sockets.
- GET /ws upgrade, Authorization: Bearer token -> 101, or 401 {erro:"sessao_invalida"} if invalid/expired.
- Anything else 404 {erro:"nao_encontrado"}.

## Server design
One global Durable Object class Central (idFromName("central")), SQLite-backed, WebSocket Hibernation API (ctx.acceptWebSocket, tags: user id and session hash). Text "ping" answered "pong" by setWebSocketAutoResponse (does not wake the DO).
Tables: usuarios(id PK discord id, usuario lowercase, nome, avatar, criado, visto); sessoes(hash PK, usuario_id, expira); amizades(a,b PK, a<b); pedidos(de_id, para_usuario lowercase, criado, PK(de_id,para_usuario)).
Requests go by username, so a person who has never opened Junto can receive one; on their login it appears. Username taken over by another Discord account: clear it from the old row.
Alarm every 5 min only while sockets exist: close sockets whose last auto-response (or connect time from attachment) is older than 150 s; delete expired sessions. No sockets = no alarm.
Online = user has at least one OPEN socket other than the one closing.

## WebSocket messages (JSON text, max 1 KB; bad JSON or unknown t answered with resposta erro:"pedido_invalido", socket stays)
Client -> server, each answered by {t:"resposta",n,ok:true} or {t:"resposta",n,ok:false,erro}; n = number echoed from client:
- {t:"pedir",n,usuario}: trim, strip leading @, lowercase, must match ^[a-z0-9_.]{2,32}$ else erro "nome_invalido". Own name: "voce_mesmo". Already friends: "ja_amigos". Over 50 pending from this sender: "muitos_pedidos". If the target already has a pending request to me: accept it (become friends). Never reveal whether the name exists: unknown name is ok:true.
- {t:"aceitar",n,id}: id = sender's user id; request must exist addressed to my username, else "nao_encontrado".
- {t:"recusar",n,id}: same check, deletes request. Sender is not told, request just leaves.
- {t:"cancelar",n,usuario}: deletes my pending request.
- {t:"remover",n,id}: deletes friendship both ways. Not friends: "nao_encontrado".
Server -> client:
- {t:"estado",eu:{id,usuario,nome,avatar},amigos:[{id,usuario,nome,avatar,on}],recebidos:[{id,usuario,nome,avatar}],enviados:[{usuario,nome,avatar}]}: full snapshot sent on connect and to every affected user's sockets after any change (friends on presence change). amigos sorted online first then nome. enviados: nome/avatar null when name is unknown, nome falls back to usuario on screen.
nome = Discord global_name or username. avatar = Discord avatar hash or null.

## App bridge (window.junto from preload, contextIsolation on)
junto.entrar() -> Promise<{ok:true}|{ok:false,erro:"cancelado"|"porta_ocupada"|"discord_fora"|"discord_recusou"|"tempo_esgotado"|"sem_config"}>
junto.cancelarEntrada(); junto.sair() -> Promise<void>; junto.enviar(msg) -> Promise<resposta> (allow-list pedir/aceitar/recusar/cancelar/remover; rejects after 10 s "sem_conexao")
junto.janela("min"|"fechar"|"sair"); junto.opcoes() -> Promise<{win,rap,min,av}>; junto.salvarOpcoes(obj) -> Promise<void>
junto.aoEstado(cb), junto.aoConexao(cb "on"|"reconectando"), junto.aoSessaoFim(cb)
Initial URL hash chosen by main: #principal with stored session, #login without.
Env overrides for tests: JUNTO_SERVIDOR, JUNTO_DISCORD_CLIENT_ID, JUNTO_DISCORD_AUTORIZAR (authorize URL base), JUNTO_DADOS (data folder), JUNTO_SEM_NAVEGADOR=1 (fetch the authorize URL following redirects instead of opening the browser), JUNTO_OCULTO=1 (window off screen, show without activating, skip tray balloons). Normal values: app/config.json {servidor, discordClientId}.

# Stage 2 contract: offers, sessions, synced playback (files = stage 3)

## Concepts
- Offer = a session owned by one user (dono). At most 1 offer per user. Visible to dono's friends only. Friends connect; a user is in at most 1 session (own offer counts). Session lives in DO memory + table ofertas (survives DO eviction); ends when dono stops, dono has no open socket for 60 s, or dono logs out.
- tipo: "ouvir" | "ver". modo: "todos" (all control+add) | "dono" (only dono controls and adds) | "fila" (all add, dono controls). Dono always may do everything.
- Item = {id (server, 8 random base64url), url, titulo, sub, dur (s, number|null), arte (0..7 from hash of url), por (user id), tipo:"link"}. Queue max 100 items. Title max 200 chars, sub 120, url 2048 (WS message limit raised to 4 KB for these messages).
- Clock: server is the reference. Playback state P = {item (id|null), tocando (bool), pos (s at base), base (server epoch ms)}. Position now = pos + (tocando ? (agoraServidor - base)/1000 : 0).

## Client -> server (answered by resposta like stage 1; errors listed)
- {t:"oferecer",n,tipo,modo}: start offer (or change tipo/modo of own). Errors "pedido_invalido". If in another session, leave it first.
- {t:"parar",n}: end own offer; everyone connected gets {t:"sessao",fim:"dono_parou"}.
- {t:"entrar_sessao",n,dono}: dono id; must be friend with active offer, else "nao_encontrado".
- {t:"sair_sessao",n}.
- {t:"adicionar",n,url,titulo,sub,dur}: needs add permission ("sem_permissao", checked first). Rate: per person (user id) at most 1 accepted add / 2 s, else {t:"resposta",n,ok:false,erro:"devagar",espera:<ms until allowed>} and nothing is added; invalid adds do not use the slot. Accepted adds ({ok:true}) go into a per-session FIFO (arrival order, memory only, dropped when the session ends); the session releases at most 1 per second into the playlist (first one immediately when idle), broadcasting sessao on release. Queue full ("fila_cheia") counts the FIFO too. Empty queue on release: item becomes current, P = {item, tocando:true, pos:0, base: now + 2500} (start delay so everyone loads).
- {t:"tirar",n,id}: control permission; cannot remove current (use pular).
- {t:"tocar",n,pos?} / {t:"pausar",n,pos?}: control permission. pausar freezes pos at now (or given pos). tocar sets base = now + 300, pos = current/given.
- {t:"buscar",n,pos}: control permission; seek, keeps tocando.
- {t:"pular",n} / {t:"voltar",n}: control permission. pular: current item leaves, next becomes current with base = now + 2500; queue empty -> P.item null. voltar: pos 0 (no history).
- {t:"fim",n,item}: client reports current item ended; server advances only if item matches current and position >= dur - 2 (or dur null); duplicates ignored.
- Abuse cap: more than 40 messages in 1 s from one socket (hora included) -> the extras are ignored (no reply, no disconnect). Only "adicionar" is rate limited/queued; everything else is immediate.
- {t:"hora",n,c}: answered {t:"hora",n,c,s} (s = server epoch ms) directly, no resposta. Used for clock offset.

## Server -> client
- estado (stage 1) gains per friend: oferta: null | {tipo, modo, titulo (current item titulo or null), arte, gente (count connected, dono excluded)}; and top-level sessao: null | {dono (id)}.
- {t:"sessao", dono, tipo, modo, gente:[ids connected, dono excluded], fila:[items, current first], P, agora (server ms)}: full snapshot to all session members after any change and on join/reconnect. {t:"sessao",fim:"dono_parou"|"dono_saiu"|"removido"} when it ends for this client.

## Clock sync (app)
Send hora 5 times on connect (200 ms apart) and every 30 s; keep sample with lowest RTT among last 8: offset = s - (c + rtt/2). agoraServidor = Date.now() + offset.

## Playback (app, each PC plays its own copy)
- On new current item each member resolves the url locally with yt-dlp (main process). ouvir: best audio. ver: video <=720p + best audio as two URLs played in 2 elements (video muted), each kept in sync independently; progressive single URL used when available.
- Sync loop every 250 ms per element: target = position now; drift = element.currentTime - target. |drift| > 0.5 s: seek (currentTime = target + 0.15 s lead for buffering of a seek). 0.04..0.5 s: playbackRate 1 -/+ min(0.1, |drift|) until under 0.04. tocando false: pause at target. Target < 0 (start delay): paused at 0, waiting.
- Measured delta reported nowhere; e2e test measures two clients via their currentTime and agoraServidor (goal < 0.5 s).
- Resolve failure: permission error (private, members only, age/region/login required) on the adder's PC -> not added, screen shows "Sem permissão para abrir esse link, então ele foi pulado." On another member's PC: same faixa there, that PC stays silent for this item, nothing sent. Other errors: silent; update yt-dlp (yt-dlp -U, at most 1x/day, never shown) and retry once.
- yt-dlp: shipped next to the app (resources\yt-dlp.exe via packager extraResource), copied on first run to <dados>\ferramentas\yt-dlp.exe (updatable there). Env JUNTO_YTDLP overrides path (tests use a fake).

## App bridge additions
junto.enviar allow-list += oferecer parar entrar_sessao sair_sessao adicionar tirar tocar pausar buscar pular voltar fim.
junto.resolver(url, tipo) -> Promise<{ok:true, titulo, sub, dur, audio, video?} | {ok:false, erro:"sem_permissao"|"falhou"}> (main process, yt-dlp -J --no-playlist, timeout 30 s).
junto.agoraServidor() -> number (sync, preload keeps offset pushed from main). junto.aoSessao(cb).
Video window: separate BrowserWindow (16:9, resizable), opened by "Ver"; plays the video element; main window keeps the audio element. Esc or close returns.
