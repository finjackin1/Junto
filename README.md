# Junto

Programa para Windows que deixa você ouvir música e assistir vídeo junto com seus amigos, cada um no próprio PC, tudo tocando no mesmo ponto.

Você entra com a sua conta do Discord, adiciona os amigos e oferece uma sessão. Quem estiver na sua lista vê o cartão e entra com um clique. Dá para entrar várias pessoas na mesma sessão. Cada PC toca a própria cópia do link, e o Junto mantém todo mundo sincronizado.

## O que ele faz

- Links do YouTube e de outros sites que o yt-dlp abre.
- Modo "Ouvir" (só o som) e modo "Ver" (abre uma janela separada com o vídeo).
- Três jeitos de controlar a sessão: todos controlam, todos adicionam na fila mas só o dono controla, ou só o dono mexe em tudo.
- Quem entra no meio cai no ponto certo da música.
- Se atualiza sozinho quando sai versão nova aqui no GitHub.

## Como usar

1. Baixe o `Junto-<versão>-windows.zip` em [Releases](https://github.com/finjackin1/Junto/releases/latest).
2. Extraia a pasta onde quiser e abra o `Junto.exe`. Não precisa instalar.
3. Clique em entrar e autorize com o Discord.
4. Adicione seus amigos pelo nome de usuário do Discord. Eles também precisam ter o Junto.

O Windows pode avisar que o programa não é conhecido, porque ele não tem assinatura digital. Clique em "Mais informações" e depois em "Executar assim mesmo".

## Requisitos

- Windows 10 ou 11, 64 bits.
- Conta no Discord.
- Internet.

## Compilando do código-fonte

Precisa do Node.js 20 ou mais novo.

- `app/`: o programa (Electron). `npm install`, depois `npm test` e `npm start`. Para gerar a pasta do programa: `npx electron-packager . Junto --platform=win32 --arch=x64 --icon=icone.ico --ignore="^/teste" --asar.unpack="**/nativo/*.exe" --extra-resource=<caminho do yt-dlp.exe> --out=../dist --overwrite`.
- `servidor/`: o servidor (Cloudflare Worker com Durable Object). `npm install`, `npm test`, e `npx wrangler deploy` para publicar na sua conta Cloudflare. Troque o endereço do servidor e o ID do app do Discord em `app/config.json`.

## Licença

GPLv3. Veja `LICENSE`. Componentes de terceiros estão em `THIRD-PARTY-NOTICES.txt`.

O Junto não tem ligação com o Discord, o YouTube ou o projeto yt-dlp.
