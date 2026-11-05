# Junto: closed plan (phase 4, 2026-11-01). Awaiting explicit go-ahead.

## What it is
Windows program. Each PC plays its own copy of the media, synced. Sound does not pass through the Discord call. Friend list shows who offers what (listen / listen and watch); one click connects.

## Decisions
- Sources: one queue mixing links (first) and files sent between PCs (right after).
- Audio + video; each viewer chooses to open the picture.
- Login with Discord (OAuth PKCE, no secret in the app). Friends added by request inside the program; Discord friend list not imported.
- Sharer picks control mode: all control / owner only / all add + owner controls.
- Window: narrow portrait, fixed size (friends + queue). Video in separate window, can go fullscreen.
- Suggested stack (technical, may change on evidence): Electron (house standard, native WebRTC, playwright-cli sweep); yt-dlp for links; Cloudflare Workers + Durable Objects with hibernation for presence/signaling; WebRTC data channel for files and sync; direct first, free relay fallback (ExpressTURN, advertised 1 TB/month).
- Links (user, 2026-11-01): a link fails visibly ONLY on missing permission. Anything else is silent: update yt-dlp, retry, fall back to embedded browser. Update status never shown.
- Ads (user, 2026-11-01): use Brave's base. Order: yt-dlp takes the stream directly (no page); when a site needs the page, Electron session (hidden/embedded) with Brave's engine adblock-rs (npm adblock-rs, MPL-2.0) + filter lists. Electron is already Chromium; Brave's browser itself is not embedded.
- Options: "Iniciar mais rápido" = logon scheduled task, sub-option of start with Windows (recipe in interface-simples/inicio_windows.py).
- Accepted: auto-update; tray + notice when a friend starts offering; wait a few seconds for slow loaders, late joiner lands at the right point; automations (check after edit, playwright-cli sweep, permissions.deny for secrets).

## Out of v1
Chat; "Ouvindo X" on Discord profile; live screen/audio streaming (stage 2, leave room); Spotify/Netflix; Mac/Linux/mobile.

## Stages
0. Prototypes: 3 HTML, user picks (skill design-ux-ui).
1. Server, Discord login, friends, online list.
2. Link queue, synced audio/video, control modes, late join. FIRST TEST POINT (user + 1 friend).
3. File sending + relay fallback.
4. Tray notice, installer, auto-update.

## Blocks (only the user can do)
- Create free Cloudflare account and register app in Discord Developer Portal (guided, stage 1).
- Publish: auto-update needs a public place for releases (GitHub Releases); publishing asks approval at that moment.
- Real test needs a friend on another internet connection.

## Risks
- Free server limit: on exceeding, fails until reset, no charge. Duration allowance unclear in docs; measure at stage 1.
- Relay limit reached: file sending stops for users without direct connection until month turns; links unaffected. Only ExpressTURN's advertised value checked, not tested.
- Windows SmartScreen warning at install (no paid signature).
- Site change with no yt-dlp fix published yet: update cannot solve it. Embedded browser is the fallback; if that fails too, item is skipped silently and retried after next update (not a permission failure, so no message).
- adblock-rs inside Electron unconfirmed (native module, no Electron mention found). Check at stage 2 start; fallback @ghostery/adblocker-electron (open issue reports YouTube ads still appearing). Network blocking may not stop ads stitched into the stream.
- Link opens for one friend, not another (each PC plays its own copy): behavior to define at stage 2.
- Video formats the Electron player can't decode: check at stage 2, convert or warn.

## Definition of done
On 2 PCs on different internet connections: Discord login; friend request accepted; friend appears with what they offer; one click connects. Links play audio and video in sync (target: under 0.5 s difference, measured). Pause/skip/add reach everyone, respecting each of the 3 control modes. Late joiner lands at the right point. File reaches the friend and plays synced, including via relay. Notice appears with program in tray. New version installs by itself. Full UI sweep passed.
