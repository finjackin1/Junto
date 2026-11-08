# Junto main screen: contract (B Palco, chosen 2026-11-01)
Change prototype and this file first, then code. Electron: this folder becomes the code (CSS and drawing functions copied by script, bridge supplies data). Every screen >= 99.50% vs prototype.

## Tokens
Base (estilo.css): --t1 #F2F4FA, --t2 #AEB4C6, --t3 #737A90, --verde #4ADE9A, --vermelho #FF6B6B, --amarelo #FFC857, --borda rgba(255,255,255,.07), --borda2 rgba(255,255,255,.13), --r 12px.
B override (proposta-B.html): --acento #FF7A59, --acento-t #1E0F0A, --fundo #11131C, --camada1 #1A1D2B, --camada2 #232739, --camada3 #2E3349.

## Grid (window 400x712, fixed; x,y,w,h)
- janela 0,0,400,712; title bar 36 high; topo 0,36,400,48; card 16,84,368,144 (next +152).
- session: back 8,40,40,40; right button 352,40,40,40; add field 16,668,320,40; file button 344,668,40,40.
- options sheet: folha 0,267,400,445; cab h60; account 16,328,368,56; option rows x16 w368 h61; switch right edge 384, 40x24; sub-option indented 16 px.

## Adding media
Link field + file button together everywhere media is added (offer sheet and queue). Placeholder "Cole um link ou escolha um arquivo".

## Options
Iniciar com o Windows; Iniciar mais rápido (sub-option, only visible while the first is on; logon scheduled task, same recipe as interface-simples/inicio_windows.py); Iniciar minimizado; Avisar quando um amigo disponibilizar; Versão + "Em dia".

## Links: visible errors
Playing: site refused ("Esse site não deixou abrir o link. Ele não toca neste PC.") or resolve still failing after 3 silent retries ("Não deu pra abrir este item neste PC. Confira sua internet."); an expired stream is re-resolved once, silently. Adding: not a link / can't open / server refusal (only dono adds, queue full, too fast, session over) / no connection each show one plain line, 6 s.

## Live browser window (stage 3)
Offer sheet: top tabs "Link | Navegador ao vivo" (files come later, so no "arquivo" anywhere yet); footer button fixed at the bottom (.folha .pe). Live tab: Ouvir / Ouvir e ver, "Qual janela" list (thumbnail, title, "Navegador"/"Outro programa" · exe, refresh button), hint line, button "Compartilhar janela" (disabled until a window is picked). Empty list: janelas-vazio. Audio = only that program (process loopback), video = page area cropped automatically.
Live session: "Ao vivo" badge on card and session, sub "No navegador", no queue/progress/transport; Ver + volume stay. Dono: "Área do vídeo" segm Automática / Janela inteira + hint (window closed ends the session). Friend: hint "Quem pausa e troca é X". Window/source lost: caiu banner.

## Session
Own session: title "Sua sessão", right button "Encerrar sessão" (stops for everyone), top + hidden. Friend session: "Com X", "Sair da sessão". Empty queue: "Nada tocando", hint line, controls and Ver disabled, times --:--. Offline: lost-connection banner. Volume: mute button + slider (input.vol), wheel 5% steps, saved per PC. Offer sheet warns when it will leave a friend's session.
Video window: click play/pause, double click or F or button = fullscreen, Esc leaves fullscreen first, then closes.

## Friends
Remove friend: first click turns into "Clique de novo para remover", second removes. Section "Sem nada agora" hidden when empty.

## Data and safety
Friends, requests, account come from M.D / M.AMIGOS / M.EU; app bridge replaces samples and escapes every server string before it enters state. Avatar with photo: Discord image over its color, no letter. Tooltips are built as text, never HTML. Redraw keeps typed field text, caret and sheet scroll. Enter on a field with data-enter runs its action.
Close button: click = tray; hold 1 s = quit, button fills red while held.

## Keys
Esc closes menu > sheet > video > session. Space play/pause when connected. Up/Down move through list. Enter activates focused. Right click on card = menu. Tooltip after 600 ms.

## States (scene via #hash, ?foto ends animations)
login, entrando, erro-login, vazio, principal, carregando, sem-ofertas, sem-internet, etapa1 (Disponibilizar disabled until stage 2), pedido-erro, menu, aviso, oferecer, oferecendo, amigos, pedido, opcoes, sessao, sem-controle, so-fila, esperando, erro-link, sem-conexao, enviando, video, sessao-offline, remover, sua-sessao, fila-vazia, erro-aviso, oferecer-janela, janelas-vazio, aovivo, aovivo-caiu, aovivo-dono.

## Check per id
Not started (stage 1 onward).

## Errors outside the friends sheet
Offer, connect and remove failures: red top toast (aviso-topo erro), 6 s. Connecting elsewhere while my session has guests: first click shows a warning toast, second click within 6 s connects. Leaving a session offline: leaves here at once, server told on reconnect. Left time shows --:-- with empty queue. Controls disabled while offline. Update: installs when not in a session (restart comes back in the tray if the window was hidden); on quit it installs and stays closed.
