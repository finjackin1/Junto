// Stand-in for junto-audio.exe in tests (JUNTO_AUDIO=<this file>): silent on the speakers, it just generates PCM.
//   info <hwnd>...  -> "<hwnd> 1 chrome.exe" for hwnds in JUNTO_FAKE_NAVEGADOR (comma list), "<hwnd> 2 outro.exe" otherwise
//   captar <hwnd>   -> stderr "ok 1 chrome.exe"; stdout 440 Hz sine, s16le 48 kHz stereo, paced to the wall clock
const [acao, ...resto] = process.argv.slice(2);
if (acao === 'info') {
  const nav = new Set(String(process.env.JUNTO_FAKE_NAVEGADOR || '').split(',').filter(Boolean));
  process.stdout.write(resto.map(h => h + (nav.has(h) ? ' 1 chrome.exe' : ' 2 outro.exe')).join('\n') + '\n');
} else if (acao === 'captar') {
  const TAXA = 48000, HZ = 440, AMP = 0.3 * 32767;
  process.stderr.write('ok 1 chrome.exe\n');
  const t0 = Date.now(); let feitos = 0;
  const passo = () => {
    const alvo = Math.floor((Date.now() - t0 + 100) * TAXA / 1000); // 100 ms ahead
    const n = alvo - feitos;
    if (n > 0) {
      const b = Buffer.alloc(n * 4);
      for (let i = 0; i < n; i++) { const v = Math.round(AMP * Math.sin(2 * Math.PI * HZ * (feitos + i) / TAXA)); b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); }
      feitos = alvo;
      process.stdout.write(b);
    }
  };
  const t = setInterval(passo, 20); passo();
  process.stdin.on('end', () => { clearInterval(t); process.exit(0); });
  process.stdin.resume();
} else { process.stderr.write('erro uso\n'); process.exit(2); }
