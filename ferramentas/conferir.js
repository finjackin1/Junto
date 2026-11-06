// Pixel check: every scene of the program screen vs the chosen prototype, both shot in the SAME Electron, off screen.
// Fails under 99.50%. Run with app's Electron: app\node_modules\electron\dist\electron.exe ferramentas\conferir.js
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('mute-audio'); // never make sound
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const LIM = 99.5, TOL = 24;
const cenas = ['login', 'entrando', 'erro-login', 'vazio', 'principal', 'carregando', 'sem-ofertas', 'sem-internet', 'etapa1', 'pedido-erro', 'menu', 'aviso', 'oferecer', 'oferecendo', 'amigos', 'pedido', 'opcoes', 'sessao', 'sem-controle', 'so-fila', 'esperando', 'erro-link', 'sem-conexao', 'enviando', 'video'];
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { }); // windows are shot one at a time; the default would quit the app after the first
app.setPath('userData', path.join(app.getPath('temp'), 'junto-conferir'));
const foto = async (arq, cena) => {
  const w = new BrowserWindow({ width: 400, height: 712, x: -3000, y: -3000, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadFile(arq, { search: 'foto', hash: cena });
  await new Promise(r => setTimeout(r, 300));
  await w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const img = await w.webContents.capturePage();
  w.destroy();
  return img.toBitmap();
};
app.whenReady().then(async () => {
  let ruins = 0;
  for (const c of cenas) {
    const a = await foto(path.join(raiz, 'docs/prototipos/principal/ESCOLHIDA/proposta-B.html'), c);
    const b = await foto(path.join(raiz, 'app/tela/index.html'), c);
    let dif = 0; const n = Math.min(a.length, b.length) / 4;
    for (let i = 0; i < n * 4; i += 4) if (Math.abs(a[i] - b[i]) > TOL || Math.abs(a[i + 1] - b[i + 1]) > TOL || Math.abs(a[i + 2] - b[i + 2]) > TOL) dif++;
    const pct = n ? 100 - dif / n * 100 : 0, vazio = a.every(v => v === a[0]);
    if (pct < LIM || a.length !== b.length || vazio) { ruins++; console.log('FALHA', c, pct.toFixed(2), a.length, b.length, vazio ? 'foto vazia' : ''); }
    else console.log('ok', c, pct.toFixed(2));
  }
  console.log('RESULTADO cenas=' + cenas.length + ' abaixo=' + ruins);
  app.exit(ruins ? 1 : 0);
});
