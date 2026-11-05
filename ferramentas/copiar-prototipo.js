// Takes the chosen screen to the program WITHOUT converting it: same code, generated files. Change the prototype, run this.
// Usage: node ferramentas\copiar-prototipo.js
const fs = require('fs'), path = require('path');
const raiz = path.resolve(__dirname, '..');
const esc = path.join(raiz, 'docs/prototipos/principal/ESCOLHIDA');
const tela = path.join(raiz, 'app/tela');
fs.mkdirSync(tela, { recursive: true });
for (const a of ['estilo.css', 'motor.js', 'sessao-comum.js']) fs.copyFileSync(path.join(esc, a), path.join(tela, a));
const p = fs.readFileSync(path.join(esc, 'proposta-B.html'), 'utf8');
const css = /<style>([\s\S]*?)<\/style>/.exec(p)[1].trim();
const js = [...p.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1].trim();
fs.writeFileSync(path.join(tela, 'palco.css'), '/* GERADO de ESCOLHIDA/proposta-B.html; nao editar aqui */\n' + css + '\n');
fs.writeFileSync(path.join(tela, 'palco.js'), '// GERADO de ESCOLHIDA/proposta-B.html; nao editar aqui\n' + js + '\n');
fs.writeFileSync(path.join(tela, 'index.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Junto</title>
<link rel="stylesheet" href="estilo.css">
<link rel="stylesheet" href="palco.css">
</head><body><div id="raiz"></div>
<script src="motor.js"></script><script src="sessao-comum.js"></script><script src="sincronia.js"></script><script src="ponte.js"></script><script src="palco.js"></script></body></html>
`);
console.log('ok: app/tela atualizada a partir de ESCOLHIDA');
