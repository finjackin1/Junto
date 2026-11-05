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
Only permission failure shows anything: "Sem permissão para abrir esse link, então ele foi pulado." Tool updates and retries are never shown.

## Data and safety
Friends, requests, account come from M.D / M.AMIGOS / M.EU; app bridge replaces samples and escapes every server string before it enters state. Avatar with photo: Discord image over its color, no letter. Tooltips are built as text, never HTML. Redraw keeps typed field text, caret and sheet scroll. Enter on a field with data-enter runs its action.
Close button: click = tray; hold 1 s = quit, button fills red while held.

## Keys
Esc closes menu > sheet > video > session. Space play/pause when connected. Up/Down move through list. Enter activates focused. Right click on card = menu. Tooltip after 600 ms.

## States (scene via #hash, ?foto ends animations)
login, entrando, erro-login, vazio, principal, carregando, sem-ofertas, sem-internet, etapa1 (Disponibilizar disabled until stage 2), pedido-erro, menu, aviso, oferecer, oferecendo, amigos, pedido, opcoes, sessao, sem-controle, so-fila, esperando, erro-link, sem-conexao, enviando, video.

## Check per id
Not started (stage 1 onward).
