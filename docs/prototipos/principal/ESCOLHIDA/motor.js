/* Junto: motor compartilhado dos protótipos (dados de exemplo, estado, telas comuns, teclado, dicas).
   Cada proposta define M.P = {principal(S), sessao(S), rodape?} e chama M.iniciar().
   Cena pelo endereço: proposta-B.html#sessao ou #sessao|Space,ArrowRight */
window.M = (function(){
const IC = {
  fones:'<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  tela:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  play:'<path class="c" d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/>',
  pausa:'<rect class="c" x="6" y="4" width="4.5" height="16" rx="1.2"/><rect class="c" x="13.5" y="4" width="4.5" height="16" rx="1.2"/>',
  prox:'<path class="c" d="M5 5v14a1 1 0 0 0 1.5.8L16 13v6h3V5h-3v6L6.5 4.2A1 1 0 0 0 5 5z"/>',
  ant:'<path class="c" d="M19 5v14a1 1 0 0 1-1.5.8L8 13v6H5V5h3v6l9.5-6.800A1 1 0 0 1 19 5z"/>',
  mais:'<path d="M12 5v14M5 12h14"/>', x:'<path d="M6 6l12 12M18 6L6 18"/>', min:'<path d="M6 12h12"/>',
  voltar:'<path d="M15 5l-7 7 7 7"/>', baixo:'<path d="M5 9l7 7 7-7"/>', cima:'<path d="M5 15l7-7 7 7"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  arquivo:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  ajustes:'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  pessoas:'<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.700-6 6-6s6 2.700 6 6"/><path d="M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.400c1.800.8 3 2.600 3 5.600"/>',
  add:'<circle cx="10" cy="8" r="3.500"/><path d="M4 20c0-3.300 2.700-6 6-6 1.300 0 2.500.4 3.500 1.100M18 14v6M15 17h6"/>',
  coroa:'<path d="M4 18h16l1-11-5 4-4-6-4 6-5-4z"/>', cad:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  fila:'<path d="M4 6h16M4 12h10M4 18h10"/><path class="c" d="M17 13v6l4-3z"/>',
  som:'<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.500 6.500a8 8 0 0 1 0 11"/>',
  cheia:'<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  aviso:'<path d="M12 4L2.500 20h19z"/><path d="M12 10v4M12 17v.5"/>', sair:'<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
  gira:'<path d="M12 3a9 9 0 1 0 9 9"/>', sino:'<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  discord:'<path class="c" d="M19.300 5.300A16 16 0 0 0 15.200 4l-.5 1.100a15 15 0 0 0-5.400 0L8.800 4a16 16 0 0 0-4.100 1.300C2.100 9.200 1.400 13 1.800 16.700a16 16 0 0 0 5 2.500l1-1.700c-.6-.2-1.100-.5-1.700-.8l.4-.3a11.500 11.500 0 0 0 11 0l.4.300c-.5.300-1.100.6-1.700.8l1 1.700a16 16 0 0 0 5-2.500c.5-4.300-.8-8-2.900-11.400zM8.500 14.500c-1 0-1.800-.9-1.800-2s.8-2 1.800-2 1.800.9 1.800 2-.8 2-1.800 2zm7 0c-1 0-1.800-.9-1.800-2s.8-2 1.800-2 1.800.9 1.800 2-.8 2-1.800 2z"/>'
};
const ic=(n,s=20)=>{const d=IC[n]||'';const so=/class="c"/.test(d)&&!/<(rect|circle)(?![^>]*class="c")/.test(d)&&!/<path(?![^>]*class="c")/.test(d);
  return `<svg class="ic${so?' cheio':''}" width="${s}" height="${s}" viewBox="0 0 24 24">${d.replace(/class="c"/g,'style="fill:currentColor;stroke:none"')}</svg>`};

const AMIGOS=[
 {id:'marina',nome:'Marina',cor:'#FF9E80',est:'on',tipo:'ver',modo:'todos',titulo:'Cosmos: a última fronteira',sub:'Episódio 3',arte:2,dur:2880,pos:1068,gente:['caio','bia'],fila:[['Cosmos: a última fronteira','Episódio 3','48:00',2,'link'],['Cosmos: a última fronteira','Episódio 4','51:12',2,'link'],['Making of da série','arquivo de Marina','22:40',6,'arq']]},
 {id:'caio',nome:'Caio',cor:'#8FD3FF',est:'on',tipo:'ouvir',modo:'dono',titulo:'Noites de verão',sub:'Banda Aurora',arte:1,dur:214,pos:92,gente:['rafa'],fila:[['Noites de verão','Banda Aurora','3:34',1,'link'],['Maré alta','Banda Aurora','4:02',1,'link'],['Estrada velha','Trio Sal','3:18',4,'link'],['Show ao vivo em casa','arquivo de Caio','1:12:05',5,'arq']]},
 {id:'bia',nome:'Bia',cor:'#B8F5A8',est:'on',tipo:'ouvir',modo:'fila',titulo:'Lo-fi para a madrugada',sub:'Mix de 2 horas',arte:5,dur:7200,pos:2410,gente:[],fila:[['Lo-fi para a madrugada','Mix de 2 horas','2:00:00',5,'link']]},
 {id:'rafa',nome:'Rafa',cor:'#FFD580',est:'on'},
 {id:'teo',nome:'Téo',cor:'#E5B8FF',est:'on'},
 {id:'luna',nome:'Luna',cor:'#FFB3C7',est:'off'},
 {id:'nico',nome:'Nico',cor:'#A8E6DD',est:'off'}
];
const EU={id:'eu',nome:'Você',conta:'finjackin',cor:'#FFFFFF',letra:'V'};
/* Pedidos e estágio do programa: dados de exemplo; no programa a ponte (app/tela/ponte.js) troca pelos reais. */
const D={recebidos:[{id:'duda',nome:'Duda',usuario:'duda.silva',cor:'#FFC4A3'}],enviados:[{usuario:'gui',nome:'Gui',cor:'#C8D1FF'}],F:{oferta:true,avisoAmigo:true}};
const achar=id=>id==='eu'?EU:AMIGOS.find(a=>a.id===id);
const MODOS={todos:['Todos controlam','Qualquer pessoa pausa, pula e adiciona'],dono:['Só o dono','Os outros só acompanham'],fila:['Todos adicionam','O dono pausa e pula']};
const hms=s=>{s=Math.floor(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),c=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${c}`:`${m}:${c}`};
const av=(p,t=40,st=true)=>{p=typeof p==='string'?achar(p):p;return `<span class="av${p.est==='off'?' off':''}" style="width:${t}px;height:${t}px;font-size:${Math.round(t*.4)}px;background:${p.foto?`${p.cor} url('${p.foto}') center/cover`:p.cor}">${p.foto?'':(p.letra||p.nome[0])}${st&&p.est?'<span class="st"></span>':''}</span>`};
const eq=(parado)=>`<span class="eq${parado?' parado':''}"><i></i><i></i><i></i></span>`;
const tipoNome=t=>t==='ver'?'Ouvir e ver':'Ouvir';
const dica=(a,b)=>`data-dica="${a}${b?'|'+b:''}"`;

const S={tela:'principal',conn:null,tocando:true,pos:0,camada:null,menu:null,aviso:null,faixa:null,ofTipo:'ver',ofModo:'todos',oferecendo:false,meuFila:[],videoAberto:false,sel:0,tentando:false,sessaoAberta:true,opc:{win:true,min:false,rap:true,av:true}};
let ultimaTela=null,ultimaCam=null,P=null,ponteF=null;

/* ---------- telas comuns ---------- */
function barra(){const ttl=S.tela==='video'?'':'';return `<div class="barra"><span class="marca"></span><span class="nome">Junto</span><span class="folga"></span>
 <button class="bb" data-act="min" ${dica('Minimizar')}>${ic('min',16)}</button>
 <button class="bb fecha" data-act="fechar" ${dica('Fechar','Clique: vai para a bandeja · Segure 1 s: sai do Junto')}>${ic('x',16)}</button></div>`}
function login(){const e=S.tela;return `<div class="centro entra">
 <div class="login-arte"><i></i><i></i></div>
 <div class="tit" style="font-size:24px;line-height:32px">Junto</div>
 <div class="sub" style="margin-bottom:16px">Ouça e assista com seus amigos, no mesmo segundo.</div>
 ${e==='erro-login'?`<div class="faixa erro" style="text-align:left">${ic('aviso',18)}<span>${S.erroLogin||'O Discord não respondeu. Confira sua internet e tente de novo.'}</span></div>`:''}
 ${e==='entrando'
  ?`<button class="btn larga" data-act="cancelar-login" ${dica('Cancelar','Volta para a tela de entrada')}><span class="gira">${ic('gira',18)}</span>Esperando o Discord… cancelar</button><div class="fra">Confirme no navegador que abriu.</div>`
  :`<button class="btn discord larga" data-act="entrar" ${dica('Entrar com o Discord','Abre o navegador para você confirmar')}>${ic('discord',20)}${e==='erro-login'?'Tentar de novo':'Entrar com o Discord'}</button><div class="fra">O Junto só lê seu nome e sua foto.</div>`}
 </div>`}
function folhaOferecer(){const a=S.ofTipo,m=S.ofModo;return `<div class="vela" data-act="fecha-camada"></div><div class="folha"><div class="cab"><div class="tit">Disponibilizar</div><button class="ibtn" data-act="fecha-camada" ${dica('Fechar','Esc')}>${ic('x')}</button></div>
 <div class="mio">
 <div class="fra" style="margin-bottom:8px">O que seus amigos podem fazer</div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
  ${[['ouvir','fones','Ouvir','Só o som'],['ver','tela','Ouvir e ver','Som e vídeo']].map(o=>`<button class="opcao${a===o[0]?' sel':''}" data-act="oftipo:${o[0]}" ${dica(o[2],o[3])} style="flex-direction:column;align-items:flex-start;gap:4px">${ic(o[1],24)}<b style="font-weight:600">${o[2]}</b><span class="fra" style="font-size:12px;line-height:16px">${o[3]}</span></button>`).join('')}
 </div>
 <div class="fra" style="margin-bottom:8px">Quem controla</div>
 <div style="display:grid;gap:8px;margin-bottom:16px">
  ${Object.keys(MODOS).map(k=>`<button class="opcao${m===k?' sel':''}" data-act="ofmodo:${k}" ${dica(MODOS[k][0],MODOS[k][1])}><span class="ca"></span><span><b style="font-weight:600;display:block">${MODOS[k][0]}</b><span class="fra" style="font-size:12px;line-height:16px">${MODOS[k][1]}</span></span></button>`).join('')}
 </div>
 <div class="fra" style="margin-bottom:8px">O que vai tocar</div>
 <div style="display:flex;gap:8px;margin-bottom:16px"><input class="campo" placeholder="Cole um link ou escolha um arquivo" aria-label="Link ou arquivo"><button class="btn" style="width:40px;padding:0;flex:none" data-act="noop" ${dica('Escolher arquivo','Vídeo ou música do seu PC')}>${ic('arquivo',20)}</button></div>
 <button class="btn pri larga" data-act="comecar-oferta" ${dica('Disponibilizar','Seus amigos passam a ver na lista')}>Disponibilizar</button>
 </div></div>`}
function folhaAmigos(){return `<div class="vela" data-act="fecha-camada"></div><div class="folha"><div class="cab"><div class="tit">Adicionar amigos</div><button class="ibtn" data-act="fecha-camada" ${dica('Fechar','Esc')}>${ic('x')}</button></div>
 <div class="mio"><div class="fra" style="margin-bottom:8px">Nome de usuário do Discord</div>
 <div style="display:flex;gap:8px;margin-bottom:16px"><input class="campo" placeholder="usuario" aria-label="Nome de usuário" data-enter="pedir"><button class="btn pri" data-act="pedir" ${dica('Enviar pedido','A pessoa precisa aceitar')}>Enviar</button></div>
 ${S.faixa==='pedido'?`<div class="faixa" style="margin-bottom:16px">${ic('sino',18)}Pedido enviado. A pessoa aparece aqui quando aceitar.</div>`:''}
 ${S.faixa==='pedido-erro'?`<div class="faixa erro" style="margin-bottom:16px">${ic('aviso',18)}<span>${S.faixaTxt}</span></div>`:''}
 ${D.recebidos.length?`<div class="fra" style="margin-bottom:4px">Pedidos recebidos</div>${D.recebidos.map(p=>`<div class="pedido">${av(p,40,false)}<div class="corta" style="flex:1"><b style="font-weight:600">${p.nome}</b><div class="fra corta">${p.usuario}</div></div><button class="btn pri" style="height:32px" data-act="aceitar:${p.id}" ${dica('Aceitar',p.nome+' entra na sua lista')}>Aceitar</button><button class="ibtn" style="width:32px;height:32px" data-act="recusar:${p.id}" ${dica('Recusar')}>${ic('x',16)}</button></div>`).join('')}`:''}
 ${D.enviados.length?`<div class="fra" style="margin:12px 0 4px">Enviados</div>${D.enviados.map(p=>`<div class="pedido">${av(p,40,false)}<div class="corta" style="flex:1"><b style="font-weight:600">${p.nome}</b><div class="fra corta">Esperando resposta</div></div><button class="ibtn" style="width:32px;height:32px" data-act="cancelar:${p.usuario}" ${dica('Cancelar pedido')}>${ic('x',16)}</button></div>`).join('')}`:''}
 </div></div>`}
function folhaOpcoes(){const o=S.opc,l=(k,t,s)=>`<div class="linha-op"><div><div>${t}</div><div class="fra" style="font-size:12px;line-height:16px">${s}</div></div><button class="chave${o[k]?' lig':''}" role="switch" aria-checked="${!!o[k]}" data-act="opc:${k}" ${dica(t,s)}></button></div>`;
 return `<div class="vela" data-act="fecha-camada"></div><div class="folha"><div class="cab"><div class="tit">Opções</div><button class="ibtn" data-act="fecha-camada" ${dica('Fechar','Esc')}>${ic('x')}</button></div>
 <div class="mio"><div class="pedido" style="margin-bottom:8px">${av(EU,40,false)}<div style="flex:1"><b style="font-weight:600">${EU.conta}</b><div class="fra">Conta do Discord</div></div><button class="btn" style="height:32px" data-act="sair-conta" ${dica('Sair da conta','Volta para a tela de entrada')}>Sair</button></div>
 ${l('win','Iniciar com o Windows','Fica na bandeja, pronto para avisar')}${o.win?l('rap','Iniciar mais rápido','Abre já no logon, sem esperar a área de trabalho').replace('class="linha-op"','class="linha-op" style="padding-left:16px"'):''}${l('min','Iniciar minimizado','Abre direto na bandeja')}${l('av','Avisar quando um amigo disponibilizar','Aparece um aviso no canto da tela')}
 <div class="linha-op"><div><div>Versão 0.1.0</div><div class="fra" style="font-size:12px;line-height:16px">Atualiza sozinho</div></div><span class="selo">${ic('fones',14)}Em dia</span></div>
 </div></div>`}
function camada(){return S.camada==='oferecer'?folhaOferecer():S.camada==='amigos'?folhaAmigos():S.camada==='opcoes'?folhaOpcoes():S.camada==='p:fila'&&P.folhaFila?P.folhaFila(S):''}
function menuAmigo(){if(!S.menu)return '';const a=achar(S.menu);return `<div class="menu" style="right:12px;top:${S.menuY||160}px">
 ${a.tipo?`<button data-act="conectar:${a.id}">${ic('fones',18)}Conectar</button>`:''}
 ${D.F.avisoAmigo?`<button data-act="noop">${ic('sino',18)}Avisar quando ${a.nome} disponibilizar</button>`:''}
 <button class="perigo" data-act="remover:${a.id}">${ic('x',18)}Remover amigo</button></div>`}
function avisoTopo(){if(S.aviso!=='amigo')return '';const a=achar('marina');return `<div class="aviso-topo" role="status">${av(a,40,false)}<div class="corta" style="flex:1"><b style="font-weight:600">Marina disponibilizou</b><div class="sub corta">${a.titulo}</div></div><button class="btn pri" style="height:32px" data-act="conectar:marina" ${dica('Conectar')}>Conectar</button></div>`}
function janelaVideo(){const a=achar(S.conn||'marina');const p=(S.pos/a.dur)*100;return `<div id="videojan"><div class="video-tela"><div class="sol"></div><div class="marca-v">${av(a,24,false)}<span>${a.titulo} · ${a.sub}</span></div>
 ${S.tela==='esperando-v'?'':''}
 <div class="video-ctl"><div class="barra-p" data-act="noop"><i data-pos style="width:${p}%"></i></div><div class="fila">
 <button class="ibtn" data-act="tocar" ${dica(S.tocando?'Pausar':'Tocar','Espaço')}>${ic(S.tocando?'pausa':'play')}</button>
 <button class="ibtn" data-act="noop" ${dica('Próxima')}>${ic('prox')}</button>
 <span style="font:400 12px/16px Consolas,monospace;margin-left:8px;white-space:nowrap" data-t>${hms(S.pos)} / ${hms(a.dur)}</span><span style="flex:1"></span>
 <span class="selo fg">${ic('pessoas',14)}${(a.gente.length+2)} juntos</span>
 <button class="ibtn" data-act="noop" ${dica('Volume')}>${ic('som')}</button>
 <button class="ibtn" data-act="noop" ${dica('Tela cheia','F')}>${ic('cheia')}</button>
 <button class="ibtn" data-act="fechar-video" ${dica('Fechar vídeo','O som continua. Esc')}>${ic('x')}</button>
 </div></div></div></div>`}

/* ---------- desenho ---------- */
function desenhar(){
  const raiz=document.getElementById('raiz');
  if(S.tela==='video'){raiz.innerHTML=janelaVideo();ligarVal();return}
  let miolo;
  if(['login','entrando','erro-login'].includes(S.tela)) miolo=login();
  else if(S.tela==='sessao') miolo=P.sessao(S);
  else miolo=P.principal(S);
  const chave=S.tela+'|'+(S.conn||'');
  const novoSub=chave!==ultimaTela; ultimaTela=chave;
  const camNova=S.camada!==ultimaCam; ultimaCam=S.camada;
  const sc=[...raiz.querySelectorAll('.rola,.mio')].map(e=>e.scrollTop);
  const foco=document.activeElement&&document.activeElement.tagName==='INPUT'?document.activeElement:null;
  const fc=foco&&{l:foco.getAttribute('aria-label'),i:foco.selectionStart,f:foco.selectionEnd};
  const campos={};raiz.querySelectorAll('input.campo').forEach(e=>{campos[e.getAttribute('aria-label')]=e.value});
  raiz.innerHTML=`<div id="janela">${barra()}<div class="corpo${novoSub?' subst':''}">${miolo}${camada()}${menuAmigo()}</div>${avisoTopo()}</div>`;
  [...raiz.querySelectorAll('.rola,.mio')].forEach((e,i)=>{if(sc[i]!=null)e.scrollTop=sc[i]});
  raiz.querySelectorAll('input.campo').forEach(e=>{const v=campos[e.getAttribute('aria-label')];if(v)e.value=v;if(fc&&e.getAttribute('aria-label')===fc.l){e.focus();e.setSelectionRange(fc.i,fc.f)}});
  if(!novoSub) raiz.querySelectorAll('.entra').forEach(e=>e.classList.remove('entra'));
  if(!camNova) raiz.querySelectorAll('.vela,.folha').forEach(e=>e.style.animation='none');
  ligarVal();
}
function ligarVal(){}
function pulso(){if(!S.conn||!S.tocando)return;const a=achar(S.conn);if(!a||!a.dur)return;S.pos=Math.min(a.dur,S.pos+1);
  document.querySelectorAll('[data-pos]').forEach(e=>e.style.width=(S.pos/a.dur*100)+'%');
  document.querySelectorAll('[data-t]').forEach(e=>e.textContent=hms(S.pos)+' / '+hms(a.dur));
  document.querySelectorAll('[data-t1]').forEach(e=>e.textContent=hms(S.pos));}

/* ---------- ações ---------- */
function agir(a,el){const [c,v]=a.split(':');
  if(ponteF&&ponteF(c,v,el)===true){desenhar();return}
  switch(c){
   case 'entrar':S.tela='entrando';break;
   case 'cancelar-login':case 'sair-conta':S.tela='login';S.camada=null;S.conn=null;break;
   case 'camada':S.camada=v;S.faixa=null;S.menu=null;break;
   case 'fecha-camada':S.camada=null;S.menu=null;break;
   case 'pedir':{const c=document.querySelector('input[data-enter="pedir"]');if(c&&c.value.trim()){c.value='';S.faixa='pedido'}break}
   case 'aceitar':case 'recusar':{const i=D.recebidos.findIndex(p=>p.id===v);if(i>=0)D.recebidos.splice(i,1);break}
   case 'cancelar':{const i=D.enviados.findIndex(p=>p.usuario===v);if(i>=0)D.enviados.splice(i,1);break}
   case 'remover':{const i=AMIGOS.findIndex(p=>p.id===v);if(i>=0)AMIGOS.splice(i,1);S.menu=null;break}
   case 'oftipo':S.ofTipo=v;break;case 'ofmodo':S.ofModo=v;break;
   case 'opc':S.opc[v]=!S.opc[v];break;
   case 'comecar-oferta':S.oferecendo=true;S.camada=null;S.tela='principal';break;
   case 'parar-oferta':S.oferecendo=false;break;
   case 'conectar':{const f=achar(v);if(!f.tipo)break;S.conn=v;S.pos=f.pos;S.tocando=true;S.menu=null;S.aviso=null;S.camada=null;S.faixa=null;S.tela='sessao';S.sessaoAberta=true;break}
   case 'desconectar':S.conn=null;S.tela='principal';S.faixa=null;break;
   case 'inicio':S.tela='principal';S.camada=null;break;
   case 'sessao':S.tela='sessao';S.sessaoAberta=true;break;
   case 'tocar':if(!podeControlar())break;S.tocando=!S.tocando;break;
   case 'abrir-video':S.videoAberto=!S.videoAberto;break;
   case 'fechar-video':S.tela=S.conn?'sessao':'principal';break;
   case 'menu':{S.menu=v;const r=el.getBoundingClientRect();S.menuY=Math.min(r.bottom-32,560);break}
   case 'sel':S.sel=+v;break;
   case 'fechar':case 'min':break;
   case 'noop':break;
   default:if(P.agir)P.agir(c,v,el);
  }
  desenhar();
}
const podeControlar=()=>{const a=S.conn&&achar(S.conn);return !a||a===EU||a.modo==='todos'};
const podeAdicionar=()=>{const a=S.conn&&achar(S.conn);return !a||a===EU||a.modo!=='dono'};

/* ---------- cenas ---------- */
const CENAS={
 login:{tela:'login'},entrando:{tela:'entrando'},'erro-login':{tela:'erro-login'},
 vazio:{tela:'principal',vazio:true},
 principal:{tela:'principal'},
 carregando:{tela:'principal',carregando:true},
 'sem-ofertas':{tela:'principal',semOf:true},
 'sem-internet':{tela:'principal',offline:true,semOf:true},
 etapa1:{tela:'principal',semOf:true,etapa1:true},
 menu:{tela:'principal',menu:'caio',menuY:200},
 aviso:{tela:'principal',aviso:'amigo'},
 oferecer:{tela:'principal',camada:'oferecer'},
 oferecendo:{tela:'principal',oferecendo:true},
 amigos:{tela:'principal',camada:'amigos'},
 pedido:{tela:'principal',camada:'amigos',faixa:'pedido'},
 'pedido-erro':{tela:'principal',camada:'amigos',faixa:'pedido-erro',faixaTxt:'Esse nome não parece um usuário do Discord. Confira e tente de novo.'},
 opcoes:{tela:'principal',camada:'opcoes'},
 sessao:{tela:'sessao',conn:'marina',pos:1068},
 'sem-controle':{tela:'sessao',conn:'caio',pos:92},
 'so-fila':{tela:'sessao',conn:'bia',pos:2410},
 esperando:{tela:'sessao',conn:'marina',pos:1068,faixa:'esperando',tocando:false},
 'erro-link':{tela:'sessao',conn:'caio',pos:92,faixa:'erro-link'},
 'sem-conexao':{tela:'sessao',conn:'marina',pos:1068,faixa:'perdeu',tocando:false},
 'enviando':{tela:'sessao',conn:'marina',pos:1068,faixa:'enviando'},
 video:{tela:'video',conn:'marina',pos:1068}
};
function aplicarCena(){
  const h=decodeURIComponent(location.hash.slice(1)).split('|');const c=CENAS[h[0]];
  if(c){Object.assign(S,{tela:'principal',conn:null,camada:null,menu:null,aviso:null,faixa:null,oferecendo:false,vazio:false,tocando:true,carregando:false,semOf:false,offline:false,etapa1:false,erroLogin:null},c);ultimaTela=null;ultimaCam=null;}
  desenhar();
  if(h[1])h[1].split(',').forEach(k=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k==='Space'?' ':k,bubbles:true})));
}

/* ---------- teclado e clique ---------- */
function iniciar(prop){P=prop;
  document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(el){agir(el.dataset.act,el);return}if(S.menu){S.menu=null;desenhar()}});
  document.addEventListener('contextmenu',e=>{const el=e.target.closest('[data-menu]');e.preventDefault();if(el){S.menu=el.dataset.menu;const r=el.getBoundingClientRect();S.menuY=Math.min(r.top+32,540);desenhar()}});
  document.addEventListener('keydown',e=>{
    const noCampo=e.target.tagName==='INPUT';
    if(e.key==='Escape'){if(S.menu)S.menu=null;else if(S.camada)S.camada=null;else if(S.tela==='video')S.tela='sessao';else if(S.tela==='sessao'&&P.esc)P.esc(S);else return;desenhar();return}
    if(noCampo){if(e.key==='Enter'&&e.target.dataset.enter){e.preventDefault();agir(e.target.dataset.enter,e.target)}return}
    if(e.key===' '&&(S.conn)){e.preventDefault();agir('tocar');return}
    if(e.key==='Enter'&&e.target.matches('[data-act]')){return}
    if(P.tecla&&P.tecla(e,S)){e.preventDefault();desenhar();return}
    if(['ArrowDown','ArrowUp'].includes(e.key)){const f=[...document.querySelectorAll('[data-lista]')];if(!f.length)return;const i=f.indexOf(document.activeElement);const n=e.key==='ArrowDown'?Math.min(f.length-1,i+1):Math.max(0,i-1);f[n].focus();f[n].scrollIntoView({block:'nearest'});e.preventDefault()}
  });
  /* balões de dica: 600 ms parado */
  const d=document.createElement('div');d.id='dica';document.body.appendChild(d);let t;
  document.addEventListener('mouseover',e=>{const el=e.target.closest('[data-dica]');clearTimeout(t);d.classList.remove('vis');if(!el)return;
    t=setTimeout(()=>{const [a,...r]=el.dataset.dica.split('|');d.textContent='';if(r.length){const q=document.createElement('b');q.textContent=a;d.appendChild(q)}else d.textContent=a;r.forEach(x=>{const q=document.createElement('span');q.textContent=x;d.appendChild(q)});
      const b=el.getBoundingClientRect();d.classList.add('vis');const w=d.offsetWidth,h=d.offsetHeight;
      let x=Math.min(innerWidth-w-4,Math.max(4,b.left+b.width/2-w/2)),y=b.bottom+6;if(y+h>innerHeight-4)y=b.top-h-6;d.style.left=x+'px';d.style.top=y+'px'},600)});
  addEventListener('hashchange',aplicarCena);
  if(/[?&]foto/.test(location.search))document.documentElement.classList.add('cena');
  setInterval(pulso,1000);
  if(!location.hash)location.hash='#login';aplicarCena();
}
return {ic,av,eq,achar,AMIGOS,EU,D,MODOS,S,hms,dica,tipoNome,iniciar,desenhar,agir,podeControlar,podeAdicionar,CENAS,ponte:f=>{ponteF=f}};
})();
