// Builds app\nativo\junto-audio.exe from junto-audio.cs with the C# compiler that ships with Windows (.NET Framework 4).
// Run before packaging: node ferramentas\compilar-audio.js
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const pasta = path.resolve(__dirname, '..', 'app', 'nativo');
if (!fs.existsSync(csc)) { console.error('csc.exe não encontrado: ' + csc); process.exit(1); }
execFileSync(csc, ['/nologo', '/optimize+', '/platform:x64', '/target:exe', '/out:' + path.join(pasta, 'junto-audio.exe'), path.join(pasta, 'junto-audio.cs')], { stdio: 'inherit' });
console.log('ok: app\\nativo\\junto-audio.exe');
