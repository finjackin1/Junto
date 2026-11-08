// Fake "browser window" for the live e2e: frameless 800x600 off screen (x=-3000), static page with a moving
// 480x270 "player" at (160,120) => expected crop {x:.2, y:.2, w:.6, h:.45}. Prints "hwnd <n>" on stdout. No sound.
// Run: electron.exe testes\fonte-aovivo.js
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('mute-audio');
const PAGINA = `<!doctype html><html><head><title>Filme teste - YouTube - Google Chrome</title><style>
body{margin:0;width:800px;height:600px;background:#e8e8e8;font:16px sans-serif;overflow:hidden}
h1{position:absolute;left:160px;top:40px;margin:0;font-size:24px;color:#333}
p{position:absolute;left:160px;top:420px;margin:0;color:#555}
canvas{position:absolute;left:160px;top:120px;width:480px;height:270px;display:block}
</style></head><body><h1>Filme teste</h1><canvas width="480" height="270"></canvas><p>Texto parado da pagina, nao deve entrar no recorte.</p>
<script>
const c = document.querySelector('canvas'), g = c.getContext('2d'); let t = 0;
function quadro() {
  t++;
  g.fillStyle = 'hsl(' + (t * 7 % 360) + ',70%,40%)'; g.fillRect(0, 0, 480, 270);
  for (let i = 0; i < 12; i++) { g.fillStyle = 'hsl(' + ((t * 13 + i * 30) % 360) + ',90%,60%)'; g.fillRect((t * (3 + i) + i * 40) % 480, (i * 23 + t * 2) % 270, 60, 40); }
  requestAnimationFrame(quadro);
}
quadro();
</script></body></html>`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ x: -3000, y: -3000, width: 800, height: 600, frame: false, resizable: false, skipTaskbar: true, show: false, useContentSize: true, title: 'Filme teste - YouTube - Google Chrome', webPreferences: { backgroundThrottling: false } });
  w.on('page-title-updated', e => e.preventDefault());
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGINA));
  w.showInactive();
  process.stdout.write('hwnd ' + w.getNativeWindowHandle().readUInt32LE(0) + '\n');
});
app.on('window-all-closed', () => app.exit(0));
