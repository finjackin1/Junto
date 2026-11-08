// Finds Playwright (package only, no browsers): JUNTO_PLAYWRIGHT, then the FCC tools folder, then the old global path.
const fs = require('fs'), path = require('path');
const lugares = [process.env.JUNTO_PLAYWRIGHT, path.resolve(__dirname, '../../FCC/dist/FCC/ferramentas/playwright/node_modules/playwright'), 'A:/opt/node/node_modules/@playwright/cli/node_modules/playwright'].filter(Boolean);
const achado = lugares.find(p => fs.existsSync(p));
if (!achado) throw new Error('Playwright ausente. Procurei em: ' + lugares.join(' | '));
module.exports = require(achado);
// ffmpeg for test media: JUNTO_FFMPEG, then any build in the FCC tools folder, then the old FNarra copy.
module.exports.ffmpeg = () => {
  const base = path.resolve(__dirname, '../../FCC/dist/FCC/ferramentas/ffmpeg');
  const fcc = fs.existsSync(base) ? fs.readdirSync(base).map(d => path.join(base, d, 'bin/ffmpeg.exe')) : [];
  const l = [process.env.JUNTO_FFMPEG, ...fcc, 'A:/Documentos/Claude-Projects/FNarra/ferramentas/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe'].filter(Boolean);
  return l.find(p => fs.existsSync(p)) || l[l.length - 1];
};
// real yt-dlp: JUNTO_YTDLP_REAL, FCC tools folder, Claude-Projects\_ferramentas, old A:\opt copy.
module.exports.ytdlp = () => {
  const l = [process.env.JUNTO_YTDLP_REAL, path.resolve(__dirname, '../../FCC/dist/FCC/ferramentas/yt-dlp/yt-dlp.exe'), path.resolve(__dirname, '../../_ferramentas/yt-dlp/yt-dlp.exe'), 'A:/opt/yt-dlp/yt-dlp.exe'].filter(Boolean);
  return l.find(p => fs.existsSync(p)) || l[l.length - 1];
};
