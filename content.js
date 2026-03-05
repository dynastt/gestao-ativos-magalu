(function(){
'use strict';
if(document.getElementById('__aa__')) return;

// ═══ TOKEN — RENOVAÇÃO AUTOMÁTICA SILENCIOSA ══════════
let _tok=null,_tokTs=0;
let _tokenRenovando=false;
let _tokenSessaoExpirou=false; // true quando sessão morreu e precisa de ação manual
let _tokenUltimoErro=0;        // timestamp do último erro, pra não ficar em loop

function syncTok(){
  const t=window.__MGT__;
  if(t&&t!==_tok){
    _tok=t;_tokTs=window.__MGTS__||Date.now();
    // Se tinha sessão expirada, limpa o flag — usuário agiu no site
    if(_tokenSessaoExpirou){
      _tokenSessaoExpirou=false;
      _tokenUltimoErro=0;
      log('Sessão restaurada ✓','ok');
    }
    uiToken();
  }
}
window.addEventListener('__mgt__',e=>{
  _tok=e.detail;_tokTs=Date.now();
  _tokenSessaoExpirou=false;_tokenUltimoErro=0;
  uiToken();
});
setInterval(syncTok,800);
function getTok(){return _tok;}
function tokMins(){
  try{const p=(_tok||'').replace('Bearer ','').split('.');if(p.length!==3)return null;
  const pl=JSON.parse(atob(p[1]));return pl.exp?Math.round((pl.exp*1000-Date.now())/60000):null;}
  catch{return null;}
}

// Renovação silenciosa via iframe
async function _renovarTokenSilencioso(){
  if(_tokenRenovando) return false;
  // Se sessão está morta, não tenta de novo por 5 minutos
  if(_tokenSessaoExpirou && Date.now()-_tokenUltimoErro < 5*60*1000) return false;
  _tokenRenovando=true;
  try{
    const code=await new Promise((resolve,reject)=>{
      const state=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
      const iframe=document.createElement('iframe');
      iframe.style.cssText='display:none;position:fixed;top:-9999px;';
      document.body.appendChild(iframe);
      const timeout=setTimeout(()=>{
        try{document.body.removeChild(iframe);}catch(_){}
        reject(new Error('Timeout ao renovar token'));
      },20000);
      const monitor=setInterval(()=>{
        try{
          const url=iframe.contentWindow.location.href;
          // Detecta se foi redirecionado pro login — sessão expirou
          if(url.includes('baap-sso-login')||url.includes('/login')){
            clearInterval(monitor);clearTimeout(timeout);
            try{document.body.removeChild(iframe);}catch(_){}
            reject(new Error('SESSAO_EXPIROU'));
            return;
          }
          const c=url.match(/code=([a-f0-9-]+)/)?.[1];
          if(c){clearInterval(monitor);clearTimeout(timeout);try{document.body.removeChild(iframe);}catch(_){}resolve(c);}
        }catch(_){}
      },50);
      iframe.src=`https://baap-sso-api.magazineluiza.com.br/auth?application_id=61df0c4efa2156a81962dd3c&url_callback=https://gestaoativos.magazineluiza.com.br&state=${state}`;
    });
    const res=await fetch(`https://baap-sso-api.magazineluiza.com.br/token/${code}`,{credentials:'include',headers:{'accept':'application/json, text/plain, */*'}});
    const data=await res.json();
    if(data?.value?.access_token){
      _tok='Bearer '+data.value.access_token;
      _tokTs=Date.now();
      window.__MGT__=_tok;
      window.__MGTS__=_tokTs;
      _tokenSessaoExpirou=false;
      _tokenUltimoErro=0;
      uiToken();
      log('Token renovado automaticamente ✓','ok');
      return true;
    }
  }catch(e){
    if(e.message==='SESSAO_EXPIROU'){
      // Sessão morreu — avisa uma vez e para de tentar
      if(!_tokenSessaoExpirou){
        log('Sessão expirou — clique em qualquer menu do portal para restaurar','warn');
        uiToken();
      }
      _tokenSessaoExpirou=true;
      _tokenUltimoErro=Date.now();
    } else {
      // Timeout — tenta mais uma vez silenciosamente antes de desistir
      _tokenRenovando=false;
      const retry=await _renovarTokenSilencioso();
      if(!retry) _tokenUltimoErro=Date.now();
      return retry;
    }
  }finally{
    _tokenRenovando=false;
  }
  return false;
}

// Verifica e renova token se necessário — chamado antes de cada operação importante
async function ensureToken(){
  const m=tokMins();
  // Só renova se token existe, expiração é legível E está perto de acabar
  if(_tok && m!==null && m<2){
    await _renovarTokenSilencioso();
  }
}

// Auto-renovação — checa a cada 1 minuto
setInterval(async()=>{
  const m=tokMins();
  // Só renova se token existe, expiração é legível E está perto de acabar
  if(_tok && m!==null && m<=1){
    await _renovarTokenSilencioso();
  }
},60000);

// ═══ HELPERS ══════════════════════════════════════════
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=c=>(c||'').toString().replace(/\D/g,'').replace(/^0+/,'');
const pad=(c,n=4)=>String(c).padStart(n,'0');

function parseFiliais(text){
  return text.split('\n').map(l=>l.trim()).filter(Boolean).flatMap(line=>{
    let filial,prod,qtd=1;
    if(line.includes(',')){const[a,b,c]=line.split(',').map(s=>s.trim());filial=a;prod=b||'TC500';qtd=parseInt(c)||1;}
    else if(/\sx\s*\d+/i.test(line)){const m=line.match(/^(\d+)\s*-\s*(.+?)\s*x\s*(\d+)/i);if(m){filial=m[1];prod=m[2].trim();qtd=parseInt(m[3])||1;}}
    else if(line.split('-').length===3){const[a,b,c]=line.split('-').map(s=>s.trim());filial=a;prod=b;qtd=parseInt(c)||1;}
    else if(line.includes('-')){const[a,b]=line.split('-').map(s=>s.trim());filial=a;prod=b||'TC500';}
    else if(/^\d+$/.test(line)){filial=line;prod='TC500';}
    if(!filial)return[];
    return[{filial:norm(filial),filialPad:pad(filial),prod:(prod||'TC500').toUpperCase().trim(),qtd}];
  });
}

// ═══ CONFIG & STATE ════════════════════════════════════
const C={API:'https://gestao-ativos-api.magazineluiza.com.br',OC:'0038',OID:'0038',RET:3,RD:1200};
const S={running:false,stop:false,jobs:[],results:{},sentItems:[],sepFiliais:[],jobsOk:[],sepAssets:[],
  cargaId:null,cargaOk:false,freight:null,depDate:null,
  confOk:0,confErr:0,confFilOk:[],confFilErr:[],tracks:{},
  nfeOk:false,nfeSucess:[],nfeFail:[],startTime:null,modo:null};
function setRes(f,p,status,motivo='',qtd=0){S.results[norm(f)+'::'+p.toUpperCase().trim()]={f:norm(f),p:p.toUpperCase().trim(),status,motivo,qtd};}

// ═══ API ══════════════════════════════════════════════
async function _refreshOn401(){
  log('Token expirou (401) — renovando...','warn');
  // Tenta renovação silenciosa primeiro
  const ok=await _renovarTokenSilencioso();
  if(ok) return;
  // Se falhou, pede pro usuário agir
  if(!document.querySelector('.aa-ov')){
    const v=await modal({tipo:'warn',icone:'🔑',titulo:'Token expirado',mensagem:'Não foi possível renovar automaticamente.\nClique em qualquer menu do site e depois clique em Pronto.',btns:[{t:'Pronto',v:'ok',cls:'p'},{t:'Cancelar',v:'cancel',cls:'d'}]});
    if(v==='cancel')throw new Error('Processo cancelado: token expirado');
    syncTok();
  }
}

async function req(method,ep,body=null,retry=0){
  await ensureToken();
  const auth=getTok();
  if(!auth)throw new Error('Token não capturado — faça qualquer ação no site.');
  const res=await fetch(C.API+ep,{method,headers:{'Content-Type':'application/json','Authorization':auth},body:body?JSON.stringify(body):null});
  if(res.status>=200&&res.status<300){const t=await res.text();return t?JSON.parse(t):{};}
  if(res.status===404)return null;
  if(res.status===401&&retry<C.RET){await _refreshOn401();return req(method,ep,body,retry+1);}
  const e=await res.text().catch(()=>'');throw new Error(`HTTP ${res.status}: ${e.slice(0,120)}`);
}
const yr=()=>new Date().getFullYear();
const A={
  sols:bc=>req('GET',`/v1/expedition/solicitations?offset=1&limit=1000&branchCode=${bc}&status=CREATED,CREATING,IN_SEPARATION,PARTIAL_SHIPPING,PENDING&startDate=${yr()}-01-01&endDate=${yr()}-12-31&originCode=${C.OC}`),
  solDet:id=>req('GET',`/v1/solicitations/solicitation-detail/${id}`),
  envSep:(sid,ic,q)=>req('POST','/v1/separation',{solicitationBranchAssetId:sid,itemCode:ic,qntdSolicitation:q}),
  sepAsset:(aid,bd)=>req('POST','/v1/separation/asset',{assetId:String(aid),branchDestinyId:Number(bd),branchOriginId:String(C.OC),qtd:0}),
  listSep:()=>req('GET',`/v1/expedition/separateds/items?originId=${C.OID}`),
  detSep:(ids,ic)=>req('GET',`/v1/expedition/separateds/assets?solicitationsBranchAssetIds=${Array.isArray(ids)?ids.join(','):ids}&itemCode=${ic}`),
  criarCarga:(bid,assets)=>req('POST','/v1/expedition/load',{branchId:bid,loadAsset:assets}),
  addCarga:(lid,bid,assets)=>req('PUT',`/v1/expedition/load/${lid}`,{branchId:bid,loadAsset:assets}),
  listarCargas:()=>req('GET',`/v1/expedition/loads?offset=1&limit=20&status=PENDING,CREATED,HAS_NF,NF_ERROR&startDate=${yr()}-01-01&endDate=${yr()}-12-31&originCode=${C.OC}`),
  enviarCarga:(id,tp,dt)=>req('PUT',`/v1/expedition/load/address/${id}`,{departureDate:dt,freightType:tp}),
  filsCarga:id=>req('GET',`/v1/expedition/load/${id}/conference/branches`),
  itensBranch:(lid,bid)=>req('GET',`/v1/expedition/load/${lid}/conference/branch/${bid}/items?originId=${C.OID}`),
  conferir:(lid,aid,tr)=>req('PUT','/v1/expedition/load/conference',{loadId:lid,assetId:aid,trackingNumber:tr||''}),
  nfe:(lid,did)=>req('POST','/v1/expedition/load/invoice',{loadId:lid,destinyId:did,originId:C.OID}),
  detCarga:id=>req('GET',`/v1/expedition/load/${id}`),
};

// ═══ CSS ══════════════════════════════════════════════
function injectCSS(){
  if(document.getElementById('__aa_css__'))return;
  const s=document.createElement('style');
  s.id='__aa_css__';
  s.textContent=`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
:root{
  --bg:#0d0d0d;--s1:#161616;--s2:#1e1e1e;--s3:#282828;
  --b1:rgba(255,255,255,0.07);--b2:rgba(255,255,255,0.12);
  --t1:#f0f0f0;--t2:#a0a0a0;--t3:#606060;
  --blue:#3b82f6;--blue2:#1d4ed8;--bluelt:rgba(59,130,246,0.12);
  --green:#22c55e;--greenlt:rgba(34,197,94,0.12);
  --red:#ef4444;--redlt:rgba(239,68,68,0.12);
  --amber:#f59e0b;--amberlt:rgba(245,158,11,0.12);
  --W:340px;--R:10px;
}
#__aa__{position:fixed;top:0;right:0;width:var(--W);height:100vh;z-index:2147483647;
  display:flex;flex-direction:column;
  font-family:'Inter',system-ui,sans-serif;
  background:var(--bg);border-left:1px solid var(--b1);
  box-shadow:-12px 0 40px rgba(0,0,0,0.6);
  transition:transform .28s cubic-bezier(.4,0,.2,1);}
#__aa__.off{transform:translateX(100%);}
#__aa_tab__{position:fixed;top:50%;right:0;transform:translateY(-50%);
  z-index:2147483646;width:18px;height:72px;
  background:var(--blue);border:none;border-radius:6px 0 0 6px;
  cursor:pointer;display:none;align-items:center;justify-content:center;
  box-shadow:-3px 0 16px rgba(59,130,246,.4);transition:width .15s;}
#__aa_tab__:hover{width:24px;}
#__aa_tab__ i{color:#fff;font-size:9px;font-style:normal;font-family:'Inter',sans-serif;
  font-weight:700;writing-mode:vertical-rl;letter-spacing:1.5px;}

/* HEADER */
.aah{background:var(--s1);padding:0 14px;height:52px;display:flex;align-items:center;
  justify-content:space-between;border-bottom:1px solid var(--b1);flex-shrink:0;}
.aah-l{display:flex;align-items:center;gap:10px;}
.aah-ico{width:30px;height:30px;background:var(--blue);border-radius:8px;
  display:flex;align-items:center;justify-content:center;font-size:15px;
  box-shadow:0 2px 10px rgba(59,130,246,.35);}
.aah-title{font-size:13.5px;font-weight:700;color:var(--t1);letter-spacing:-.2px;}
.aah-sub{font-size:9.5px;color:var(--t3);font-family:'JetBrains Mono',monospace;margin-top:1px;}
.aah-btns{display:flex;gap:5px;}
.aah-btn{width:26px;height:26px;background:var(--s3);border:1px solid var(--b1);
  border-radius:7px;color:var(--t2);cursor:pointer;font-size:13px;
  display:flex;align-items:center;justify-content:center;transition:all .15s;
  font-family:'Inter',sans-serif;line-height:1;}
.aah-btn:hover{background:var(--b2);color:var(--t1);}
.aah-btn.close-btn:hover{background:var(--redlt);color:var(--red);border-color:rgba(239,68,68,.3);}

/* TOKEN */
.aat{margin:10px 12px;padding:8px 11px;border-radius:8px;
  display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:500;
  border:1px solid;flex-shrink:0;transition:all .3s;}
.aat.w{background:var(--redlt);border-color:rgba(239,68,68,.25);color:#fca5a5;}
.aat.ok{background:var(--greenlt);border-color:rgba(34,197,94,.25);color:#86efac;}
.aat.ex{background:var(--amberlt);border-color:rgba(245,158,11,.25);color:#fcd34d;}
.aat-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.aat.w .aat-dot{background:var(--red);}
.aat.ok .aat-dot{background:var(--green);animation:pulse 2s ease infinite;}
.aat.ex .aat-dot{background:var(--amber);animation:pulse .8s ease infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* SCROLL */
.aas{flex:1;overflow-y:auto;padding:10px 12px;
  scrollbar-width:thin;scrollbar-color:var(--b2) transparent;}
.aas::-webkit-scrollbar{width:3px;}
.aas::-webkit-scrollbar-thumb{background:var(--b2);border-radius:3px;}

/* CARD */
.aac{background:var(--s1);border:1px solid var(--b1);border-radius:var(--R);
  padding:12px;margin-bottom:8px;}
.aac-label{font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;
  letter-spacing:1.2px;margin-bottom:8px;}

/* TEXTAREA */
.aa-ta{width:100%;box-sizing:border-box;background:var(--s2);border:1px solid var(--b1);
  border-radius:8px;color:var(--t1);padding:9px 11px;font-size:12px;
  font-family:'JetBrains Mono',monospace;resize:vertical;outline:none;line-height:1.7;
  transition:border-color .2s,box-shadow .2s;}
.aa-ta:focus{border-color:rgba(59,130,246,.5);box-shadow:0 0 0 3px rgba(59,130,246,.08);}
.aa-ta::placeholder{color:var(--t3);}
.aa-hints{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px;}
.aa-hint{font-size:10px;font-family:'JetBrains Mono',monospace;color:#93c5fd;
  background:var(--bluelt);padding:2px 7px;border-radius:4px;border:1px solid rgba(59,130,246,.2);}

/* SELECT */
.aa-sw{position:relative;}
.aa-sel{width:100%;box-sizing:border-box;background:var(--s2);border:1px solid var(--b1);
  border-radius:8px;color:var(--t1);padding:9px 30px 9px 11px;
  font-size:12.5px;font-family:'Inter',sans-serif;font-weight:500;
  outline:none;cursor:pointer;appearance:none;transition:border-color .2s;}
.aa-sel:focus{border-color:rgba(59,130,246,.5);}
.aa-sa{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--t3);
  pointer-events:none;font-size:11px;}

/* BOTÕES */
.aa-btn{width:100%;padding:11px;border-radius:8px;border:none;
  font-family:'Inter',sans-serif;font-weight:600;font-size:13px;
  cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;
  transition:all .15s;margin-bottom:7px;letter-spacing:-.1px;}
.aa-btn:active{transform:scale(.98);}
.aa-btn:disabled{opacity:.35;cursor:not-allowed;transform:none!important;}
.aa-btn-run{background:var(--blue);color:#fff;box-shadow:0 2px 12px rgba(59,130,246,.3);}
.aa-btn-run:hover:not(:disabled){background:#2563eb;box-shadow:0 4px 20px rgba(59,130,246,.4);transform:translateY(-1px);}
.aa-btn-stop{background:var(--redlt);border:1px solid rgba(239,68,68,.25);color:#fca5a5;display:none;padding:9px;font-size:12px;}
.aa-btn-stop:hover{background:rgba(239,68,68,.18);}
.aa-btn-sec{background:var(--s2);border:1px solid var(--b1);color:var(--t2);font-size:12px;padding:9px;}
.aa-btn-sec:hover{border-color:var(--b2);color:var(--t1);}
.aa-btn-ghost{background:transparent;border:1px dashed var(--b1);color:var(--t3);font-size:11.5px;padding:8px;margin-bottom:0;}
.aa-btn-ghost:hover{border-color:rgba(59,130,246,.4);color:var(--blue);}

/* STATUS */
.aa-st{padding:9px 11px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;
  font-size:11.5px;font-family:'JetBrains Mono',monospace;color:var(--t3);
  line-height:1.5;min-height:36px;margin-bottom:7px;transition:all .2s;}
.aa-st.on{color:#93c5fd;border-color:rgba(59,130,246,.3);background:var(--bluelt);}
.aa-pw{height:2px;background:var(--s3);border-radius:2px;overflow:hidden;margin-bottom:10px;display:none;}
.aa-pw.on{display:block;}
.aa-pb{height:100%;background:linear-gradient(90deg,var(--blue),#6366f1);border-radius:2px;width:0%;transition:width .5s ease;}
.aa-div{height:1px;background:var(--b1);margin:8px 0;}

/* LOG */
.aa-log{border-top:1px solid var(--b1);background:var(--s1);flex-shrink:0;}
.aa-lh{padding:7px 12px;display:flex;align-items:center;justify-content:space-between;
  cursor:pointer;user-select:none;}
.aa-ll{font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;
  letter-spacing:1.2px;display:flex;align-items:center;gap:6px;}
.aa-lcount{background:var(--s3);color:var(--t3);font-size:9px;font-weight:700;
  padding:1px 5px;border-radius:9px;}
.aa-lclr{background:none;border:none;color:var(--t3);font-size:10.5px;cursor:pointer;
  font-family:'Inter',sans-serif;padding:2px 7px;border-radius:5px;transition:all .15s;}
.aa-lclr:hover{color:var(--red);background:var(--redlt);}
.aa-lb{max-height:150px;overflow-y:auto;padding:4px 12px 10px;
  scrollbar-width:thin;scrollbar-color:var(--b1) transparent;}
.aa-le{font-size:10.5px;font-family:'JetBrains Mono',monospace;
  padding:2px 0 2px 8px;border-left:2px solid;margin-bottom:3px;line-height:1.4;
  opacity:0;animation:logfade .15s ease forwards;}
@keyframes logfade{from{opacity:0;transform:translateX(-2px)}to{opacity:1;transform:translateX(0)}}
.aa-le.info{border-color:rgba(99,102,241,.6);color:#a5b4fc;}
.aa-le.ok{border-color:rgba(34,197,94,.5);color:#86efac;}
.aa-le.warn{border-color:rgba(245,158,11,.5);color:#fcd34d;}
.aa-le.err{border-color:rgba(239,68,68,.5);color:#fca5a5;}

/* OVERLAY / MODAL */
.aa-ov{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);
  z-index:2147483647;display:flex;align-items:center;justify-content:center;
  animation:ovfade .15s ease;}
@keyframes ovfade{from{opacity:0}to{opacity:1}}
.aa-modal{background:var(--s1);border:1px solid var(--b2);border-radius:14px;
  padding:22px 20px 18px;max-width:420px;width:92%;
  box-shadow:0 24px 60px rgba(0,0,0,.8);
  animation:modalpop .2s cubic-bezier(.34,1.5,.64,1);}
@keyframes modalpop{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}
.aa-m-ico{font-size:36px;text-align:center;margin-bottom:8px;}
.aa-m-ttl{font-size:15px;font-weight:700;color:var(--t1);text-align:center;margin-bottom:6px;}
.aa-m-msg{font-size:12.5px;color:var(--t2);text-align:center;line-height:1.55;
  margin-bottom:14px;white-space:pre-line;}
.aa-m-det{background:var(--bg);border:1px solid var(--b1);border-radius:7px;
  padding:8px 10px;font-size:10.5px;font-family:'JetBrains Mono',monospace;color:var(--t3);
  margin-bottom:14px;max-height:80px;overflow-y:auto;white-space:pre-wrap;}
.aa-m-inp{width:100%;padding:10px 11px;background:var(--s2);border:1px solid var(--b2);
  border-radius:8px;color:var(--t1);font-size:13px;font-family:'JetBrains Mono',monospace;
  margin-bottom:13px;box-sizing:border-box;outline:none;transition:border-color .2s;}
.aa-m-inp:focus{border-color:rgba(59,130,246,.6);box-shadow:0 0 0 3px rgba(59,130,246,.08);}
.aa-m-btns{display:flex;gap:7px;}
.aa-mb{flex:1;padding:10px;border-radius:8px;border:none;font-family:'Inter',sans-serif;
  font-weight:600;font-size:12.5px;cursor:pointer;transition:all .15s;}
.aa-mb.p{background:var(--blue);color:#fff;}
.aa-mb.p:hover{background:#2563eb;}
.aa-mb.s{background:var(--s3);border:1px solid var(--b1);color:var(--t2);}
.aa-mb.s:hover{color:var(--t1);border-color:var(--b2);}
.aa-mb.d{background:var(--redlt);border:1px solid rgba(239,68,68,.3);color:#fca5a5;}
.aa-mb.d:hover{background:rgba(239,68,68,.18);}

/* TABELA DE RESULTADOS */
.aa-res-modal{max-width:460px;width:95%;}
.aa-res-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px;}
.aa-res-cell{background:var(--s2);border:1px solid var(--b1);border-radius:8px;
  padding:8px 4px;text-align:center;}
.aa-res-val{font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace;}
.aa-res-lbl{font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;margin-top:1px;}
.aa-rtable{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:14px;}
.aa-rtable thead th{text-align:left;color:var(--t3);font-size:9.5px;font-weight:600;
  text-transform:uppercase;letter-spacing:.8px;padding:4px 8px;border-bottom:1px solid var(--b1);}
.aa-rtable tbody td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.03);color:var(--t1);}
.aa-rtable tbody tr:last-child td{border-bottom:none;}
.aa-rtable tbody tr.ok td{background:rgba(34,197,94,.06);}
.aa-rtable tbody tr.fail td{background:rgba(239,68,68,.06);}
.aa-rtable .tag-ok{color:var(--green);font-weight:700;font-size:10.5px;}
.aa-rtable .tag-fail{color:var(--red);font-weight:700;font-size:10.5px;}
.aa-rtable .motivo{color:var(--t3);font-size:9.5px;font-family:'JetBrains Mono',monospace;}
.aa-res-tip{font-size:11px;color:var(--t3);text-align:center;margin-bottom:12px;line-height:1.5;}

/* Lista modal */
.aa-list-item{padding:10px 12px;border-radius:8px;border:1px solid var(--b1);background:var(--s2);
  color:var(--t1);cursor:pointer;text-align:left;font-family:'Inter',sans-serif;
  font-size:12.5px;transition:all .15s;width:100%;box-sizing:border-box;margin-bottom:5px;}
.aa-list-item:hover{border-color:var(--b2);background:var(--s3);}
.aa-list-item strong{color:var(--blue);}
.aa-list-item span{color:var(--t3);font-size:11px;}
.aa-list-item small{display:block;color:var(--t3);font-size:10.5px;font-family:'JetBrains Mono',monospace;margin-top:2px;}

/* Resumo final */
.aa-final-modal{max-width:480px;width:96%;}
.aa-final-sec{background:var(--s2);border:1px solid var(--b1);border-radius:8px;
  padding:10px 12px;margin-bottom:8px;font-size:12px;}
.aa-final-row{display:flex;justify-content:space-between;align-items:center;
  padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04);}
.aa-final-row:last-child{border-bottom:none;}
.aa-final-k{color:var(--t3);}
.aa-final-v{font-weight:600;color:var(--t1);}
`;
  document.head.appendChild(s);
}

// ═══ PAINEL ════════════════════════════════════════════
function buildPanel(){
  if(document.getElementById('__aa__'))return;
  const root=document.createElement('div');
  root.id='__aa__';
  root.innerHTML=`
<div class="aah">
  <div class="aah-l">
    <div class="aah-ico">📦</div>
    <div><div class="aah-title">Auto Ativos</div><div class="aah-sub">v15 · MAGALU</div></div>
  </div>
  <div class="aah-btns">
    <button class="aah-btn" id="aa-min" title="Minimizar">&#8212;</button>
    <button class="aah-btn close-btn" id="aa-close" title="Fechar">&#10005;</button>
  </div>
</div>

<div class="aat w" id="aa-tok">
  <div class="aat-dot"></div>
  <span id="aa-tok-txt">Aguardando token — faça qualquer ação no site</span>
</div>

<div class="aas">
  <div class="aac">
    <div class="aac-label">Filiais e Produtos</div>
    <textarea class="aa-ta" id="aa-ta" rows="6" placeholder="790&#10;1321 - TC500 x2&#10;452 - Cadeira - 3&#10;500,microcomputador,1"></textarea>
    <div class="aa-hints">
      <span class="aa-hint">500</span><span class="aa-hint">500 - prod</span>
      <span class="aa-hint">500 - prod x2</span><span class="aa-hint">500,prod,2</span>
    </div>
  </div>
  <div class="aac">
    <div class="aac-label">Modo de Execução</div>
    <div class="aa-sw">
      <select class="aa-sel" id="aa-mode">
        <option value="full">🔄 Processo Completo</option>
        <option value="sep">⚡ A partir da Separação</option>
        <option value="carga">📦 A partir da Carga</option>
      </select>
      <span class="aa-sa">▾</span>
    </div>
  </div>
  <button class="aa-btn aa-btn-run" id="aa-run">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    Iniciar Processo
  </button>
  <button class="aa-btn aa-btn-stop" id="aa-stop">⏹ Parar</button>
  <button class="aa-btn aa-btn-sec" id="aa-email">📧 Enviar e-mails p/ carga</button>
  <button class="aa-btn aa-btn-ghost" id="aa-sheets">🏷️ Gerar ETQ</button>
  <div class="aa-div"></div>
  <div class="aa-st" id="aa-st">Pronto para iniciar.</div>
  <div class="aa-pw" id="aa-pw"><div class="aa-pb" id="aa-pb"></div></div>
</div>

<div class="aa-log">
  <div class="aa-lh" id="aa-lh">
    <span class="aa-ll">▲ Logs <span class="aa-lcount" id="aa-lc">0</span></span>
    <button class="aa-lclr" id="aa-lclr">limpar</button>
  </div>
  <div class="aa-lb" id="aa-lb">
    <div class="aa-le info">Aguardando...</div>
  </div>
</div>`;
  document.body.appendChild(root);

  const tab=document.createElement('button');
  tab.id='__aa_tab__';
  tab.innerHTML='<i>AUTO</i>';
  document.body.appendChild(tab);

  function setMargin(w){document.body.style.setProperty('margin-right',w,'important');}
  setMargin('340px');
  document.body.style.transition='margin-right .28s';

  document.getElementById('aa-close').addEventListener('click',function(e){
    e.stopPropagation();
    root.classList.add('off');
    tab.style.display='flex';
    setMargin('0');
  });

  tab.addEventListener('click',function(){
    root.classList.remove('off');
    tab.style.display='none';
    setMargin('340px');
  });

  let mini=false;
  const minBtn=document.getElementById('aa-min');
  minBtn.addEventListener('click',function(e){
    e.stopPropagation();
    mini=!mini;
    const parts=root.querySelectorAll('.aas, .aa-log');
    parts.forEach(el=>{el.style.display=mini?'none':'';});
    const tok=root.querySelector('.aat');
    if(tok)tok.style.display=mini?'none':'';
    root.style.height=mini?'52px':'100vh';
    setMargin(mini?'0':'340px');
    minBtn.innerHTML=mini?'&#9633;':'&#8212;';
    minBtn.title=mini?'Restaurar':'Minimizar';
  });

  document.getElementById('aa-run').addEventListener('click',start);
  document.getElementById('aa-stop').addEventListener('click',()=>{
    S.stop=true;setSt('Parada solicitada...');log('Interrompido pelo usuário.','warn');
  });
  document.getElementById('aa-email').addEventListener('click',testarEmails);
  document.getElementById('aa-sheets').addEventListener('click',()=>{
    const jobs=parseFiliais(document.getElementById('aa-ta')?.value||'');
    if(!jobs.length){log('Nenhuma filial.','warn');return;}
    emitirEtiquetas([...new Set(jobs.map(j=>norm(j.filial)).filter(Boolean))]);
  });

  let logOpen=true;
  document.getElementById('aa-lh').addEventListener('click',()=>{
    logOpen=!logOpen;
    document.getElementById('aa-lb').style.display=logOpen?'':'none';
  });
  document.getElementById('aa-lclr').addEventListener('click',e=>{
    e.stopPropagation();
    document.getElementById('aa-lb').innerHTML='';
    _lc=0;document.getElementById('aa-lc').textContent='0';
  });

  setInterval(uiToken,8000);
}

function uiToken(){
  const el=document.getElementById('aa-tok');
  const tx=document.getElementById('aa-tok-txt');
  if(!el||!tx)return;
  if(!getTok()){el.className='aat w';tx.textContent='Aguardando token — faça qualquer ação no site';return;}
  if(_tokenSessaoExpirou){el.className='aat w';tx.textContent='Sessão expirou — clique em qualquer menu do portal';return;}
  const m=tokMins();
  if(m!==null&&m<2){el.className='aat ex';tx.textContent=`Token expirando em ${m}min — renovando...`;}
  else{el.className='aat ok';tx.textContent=m!==null?`Token ativo · ${m} min restantes`:'Token ativo';}
}

// ═══ UI HELPERS ════════════════════════════════════════
function setSt(t,on=true){
  const el=document.getElementById('aa-st');
  if(!el)return;el.textContent=t;el.className='aa-st'+(on?' on':'');
}
function setProg(p){
  const w=document.getElementById('aa-pw'),b=document.getElementById('aa-pb');
  if(!w||!b)return;
  if(p===null){w.classList.remove('on');return;}
  w.classList.add('on');b.style.width=p+'%';
}
let _lc=0;
function log(msg,type='info'){
  const lb=document.getElementById('aa-lb');if(!lb)return;
  _lc++;
  const lc=document.getElementById('aa-lc');if(lc)lc.textContent=_lc;
  const t=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const icons={info:'›',ok:'✓',warn:'⚠',err:'✗'};
  const d=document.createElement('div');
  d.className='aa-le '+type;
  d.textContent=`${icons[type]||'›'} ${t}  ${msg}`;
  lb.appendChild(d);lb.scrollTop=lb.scrollHeight;
  if(lb.children.length>200)lb.removeChild(lb.children[0]);
}

// ═══ MODAIS ════════════════════════════════════════════
function modal(cfg){
  return new Promise(res=>{
    const ov=document.createElement('div');ov.className='aa-ov';
    const m=document.createElement('div');m.className='aa-modal';
    if(cfg.wide)m.className+=' '+cfg.wide;
    const ico=cfg.icone||(cfg.tipo==='err'?'⚠️':cfg.tipo==='ok'?'✅':'ℹ️');
    const tc=cfg.tipo==='err'?'#fca5a5':cfg.tipo==='ok'?'#86efac':cfg.tipo==='warn'?'#fcd34d':'#93c5fd';
    let h=`<div class="aa-m-ico">${ico}</div>
<div class="aa-m-ttl" style="color:${tc}">${cfg.titulo}</div>
<div class="aa-m-msg">${cfg.mensagem||''}</div>`;
    if(cfg.det)h+=`<div class="aa-m-det">${cfg.det}</div>`;
    if(cfg.html)h+=cfg.html;
    h+='<div class="aa-m-btns">';
    (cfg.btns||[]).forEach(b=>{h+=`<button class="aa-mb ${b.cls||'s'}" data-v="${b.v}">${b.t}</button>`;});
    h+='</div>';
    m.innerHTML=h;ov.appendChild(m);document.body.appendChild(ov);
    m.querySelectorAll('[data-v]').forEach(btn=>{btn.addEventListener('click',()=>{ov.remove();res(btn.dataset.v);});});
    ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();res(null);}});
  });
}
function prompt2(cfg){
  return new Promise(res=>{
    const ov=document.createElement('div');ov.className='aa-ov';
    const m=document.createElement('div');m.className='aa-modal';
    const ico=cfg.icone||'📝';
    m.innerHTML=`<div class="aa-m-ico">${ico}</div>
<div class="aa-m-ttl" style="color:#93c5fd">${cfg.titulo}</div>
<div class="aa-m-msg">${cfg.mensagem||''}</div>
<input class="aa-m-inp" id="__aai__" placeholder="${cfg.ph||''}" />
<div class="aa-m-btns">
  <button class="aa-mb s" id="__aac__">Cancelar</button>
  <button class="aa-mb p" id="__aao__">Confirmar</button>
</div>`;
    ov.appendChild(m);document.body.appendChild(ov);
    const inp=m.querySelector('#__aai__');setTimeout(()=>inp.focus(),50);
    m.querySelector('#__aac__').addEventListener('click',()=>{ov.remove();res(null);});
    const ok=()=>{ov.remove();res(inp.value.trim()||null);};
    m.querySelector('#__aao__').addEventListener('click',ok);
    inp.addEventListener('keypress',e=>{if(e.key==='Enter')ok();});
  });
}
function listaModal(cfg){
  return new Promise(res=>{
    const ov=document.createElement('div');ov.className='aa-ov';
    const m=document.createElement('div');m.className='aa-modal';m.style.maxWidth='400px';
    let h=`<div class="aa-m-ico">${cfg.icone||'📋'}</div>
<div class="aa-m-ttl" style="color:#93c5fd">${cfg.titulo}</div>
<div style="max-height:250px;overflow-y:auto;margin-bottom:12px;">`;
    cfg.itens.forEach((item,i)=>{
      h+=`<button class="aa-list-item" data-i="${i}">
<strong>${item.t}</strong><span style="margin-left:8px">${item.s||''}</span>
${item.d?`<small>${item.d}</small>`:''}</button>`;
    });
    h+=`</div><button class="aa-mb s" id="__aalc__">Cancelar</button>`;
    m.innerHTML=h;ov.appendChild(m);document.body.appendChild(ov);
    m.querySelectorAll('[data-i]').forEach(btn=>{btn.addEventListener('click',()=>{ov.remove();res(parseInt(btn.dataset.i));});});
    m.querySelector('#__aalc__').addEventListener('click',()=>{ov.remove();res(null);});
  });
}

// ═══ MODAL RESUMO SOLICITAÇÃO ══════════════════════════
async function modalResumoSolicitacao(){
  const results=Object.values(S.results);
  const oks=results.filter(r=>r.status==='ok');
  const fails=results.filter(r=>r.status==='fail');
  let tabHTML=`<table class="aa-rtable">
<thead><tr><th>Filial</th><th>Produto</th><th>Qtd</th><th>Status</th></tr></thead><tbody>`;
  const ordered=[...oks,...fails];
  for(const r of ordered){
    const cls=r.status==='ok'?'ok':'fail';
    const tag=r.status==='ok'?`<span class="tag-ok">✓ OK</span>`:`<span class="tag-fail">✗ Falhou</span>`;
    tabHTML+=`<tr class="${cls}"><td><strong>${r.f}</strong></td>
<td style="font-family:'JetBrains Mono',monospace;font-size:10.5px">${r.p}</td>
<td style="font-family:'JetBrains Mono',monospace;font-size:11px">${r.status==='ok'?'×'+r.qtd:'—'}</td>
<td>${tag}</td></tr>`;
    if(r.status==='fail'){
      tabHTML+=`<tr class="fail"><td colspan="4" class="motivo">↳ ${r.motivo}</td></tr>`;
    }
  }
  tabHTML+='</tbody></table>';
  const tip=fails.length>0
    ?`<div class="aa-res-tip">⚠️ Riscando do papel: <strong style="color:#fcd34d">${fails.map(f=>f.f).join(', ')}</strong> não precisam ser bipadas.</div>`
    :`<div class="aa-res-tip" style="color:#86efac">✓ Todas as filiais foram enviadas com sucesso!</div>`;
  const v=await modal({
    icone:oks.length>0&&fails.length===0?'🎯':'📋',
    titulo:'Resultado das Solicitações',
    tipo:fails.length>0?'warn':'ok',
    wide:'aa-res-modal',
    html:`
<div class="aa-res-sum">
  <div class="aa-res-cell"><div class="aa-res-val" style="color:#93c5fd">${results.length}</div><div class="aa-res-lbl">Total</div></div>
  <div class="aa-res-cell"><div class="aa-res-val" style="color:var(--green)">${oks.length}</div><div class="aa-res-lbl">OK</div></div>
  <div class="aa-res-cell"><div class="aa-res-val" style="color:${fails.length?'var(--red)':'var(--green)'}">  ${fails.length}</div><div class="aa-res-lbl">Falhas</div></div>
</div>
${tip}
<div style="max-height:200px;overflow-y:auto;border:1px solid var(--b1);border-radius:8px;margin-bottom:12px;">
${tabHTML}
</div>`,
    btns:[
      {t:'🛑 Parar aqui',v:'stop',cls:'d'},
      {t:'⚡ Continuar separação',v:'go',cls:'p'},
    ]
  });
  return v;
}

// ═══ PROCESS START ════════════════════════════════════
async function start(){
  const raw=document.getElementById('aa-ta')?.value||'';
  const jobs=parseFiliais(raw);
  const mode=document.getElementById('aa-mode')?.value||'full';
  if(!getTok()){
    await modal({tipo:'err',icone:'🔐',titulo:'Token não capturado',mensagem:'Faça qualquer ação no site (clique em Recebimento, Expedição, etc.) para o token ser capturado.',btns:[{t:'Entendido',v:'ok',cls:'p'}]});
    return;
  }
  if(!jobs.length){
    await modal({tipo:'err',icone:'📝',titulo:'Nenhuma filial',mensagem:'Informe ao menos uma filial no campo acima.',btns:[{t:'Ok',v:'ok',cls:'p'}]});
    return;
  }
  const mLabel={full:'COMPLETO',sep:'SEPARAÇÃO',carga:'CARGA'};
  Object.assign(S,{running:true,stop:false,jobs,results:{},sentItems:[],sepFiliais:[],jobsOk:[],sepAssets:[],
    cargaId:null,cargaOk:false,freight:null,depDate:null,
    confOk:0,confErr:0,confFilOk:[],confFilErr:[],tracks:{},
    nfeOk:false,nfeSucess:[],nfeFail:[],startTime:Date.now(),modo:mLabel[mode]||mode});
  for(const j of jobs)setRes(j.filial,j.prod,'pending','Em processamento');

  document.getElementById('aa-run').style.display='none';
  document.getElementById('aa-stop').style.display='flex';
  setProg(5);
  log(`Modo ${mLabel[mode]} · ${jobs.length} job(s)`,'info');

  try{
    if(mode==='full'){
      setSt('Etapa 1 — Solicitações');setProg(10);
      await stepSolicitacao();
      if(!S.stop){
        const oks=Object.values(S.results).filter(r=>r.status==='ok');
        if(oks.length>0){
          const dec=await modalResumoSolicitacao();
          if(dec==='stop'||dec===null){S.stop=true;}
        }else{
          await modal({tipo:'err',icone:'😔',titulo:'Nenhuma solicitação processada',mensagem:'Nenhuma filial teve itens enviados para separação.\n\nVerifique os dados e tente novamente.',btns:[{t:'Ok',v:'ok',cls:'p'}]});
          S.stop=true;
        }
      }
      if(!S.stop&&S.jobsOk.length){setSt('Etapa 2 — Separação');setProg(28);await stepSeparacao();if(!S.stop)await stepBuscarSep();}
      if(!S.stop&&S.sepAssets.length){setSt('Etapa 3 — Carga');setProg(50);await stepCarga();}
      if(!S.stop&&S.cargaId&&S.cargaOk){setSt('Etapa 4 — Conferência');setProg(68);await stepConferencia();}
    }else if(mode==='sep'){
      S.jobsOk=[...jobs];S.sepFiliais=[...new Set(jobs.map(j=>j.filial))];
      await stepSeparacao();if(!S.stop)await stepBuscarSep();
      if(!S.stop&&S.sepAssets.length)await stepCarga();
      if(!S.stop&&S.cargaId&&S.cargaOk)await stepConferencia();
    }else if(mode==='carga'){
      S.sepFiliais=[...new Set(jobs.map(j=>j.filial))];
      await stepBuscarSep();
      if(!S.stop&&S.sepAssets.length)await stepCarga();
      if(!S.stop&&S.cargaId&&S.cargaOk)await stepConferencia();
    }
  }catch(e){
    log(`Erro fatal: ${e.message}`,'err');
    setSt(`Erro: ${e.message}`,true);
  }finally{
    // Garante que o e-mail seja sempre enviado ao final, independente de erros
    if(S.cargaId&&!S.stop){
      try{
        const fils=[...new Set([...S.confFilOk,...S.confFilErr,...S.sepFiliais].map(f=>norm(f)).filter(Boolean))];
        if(fils.length){
          const ipf=await _fetchItensCarga(fils);
          await envEmails(fils,ipf);
        }
      }catch(e){log('Erro ao enviar e-mails finais: '+e.message,'err');}
    }
  }

  S.running=false;
  document.getElementById('aa-run').style.display='flex';
  document.getElementById('aa-stop').style.display='none';
  setProg(100);setTimeout(()=>setProg(null),600);
  setSt(S.stop?'Interrompido.':'Processo finalizado ✓',false);
  if(!S.stop)log('Finalizado.','ok');
  await finalModal();
}

// ═══ ETAPAS ════════════════════════════════════════════
async function stepSolicitacao(){
  log('── SOLICITAÇÕES ──','info');
  for(let i=0;i<S.jobs.length;i++){
    if(S.stop)break;
    const job=S.jobs[i];
    const pu=job.prod.toUpperCase();
    setSt(`Solicitação ${i+1}/${S.jobs.length} — Filial ${job.filial}`);
    log(`Buscando filial ${job.filial} · "${job.prod}"`,'info');
    try{
      const resp=await A.sols(job.filial);
      const sols=Array.isArray(resp)?resp:(resp?.records||resp?.content||[]);
      if(!sols.length){setRes(job.filial,job.prod,'fail','Nenhuma solicitação encontrada para esta filial');log(`Filial ${job.filial}: sem solicitações.`,'warn');continue;}
      let total=0,found=false;
      for(const sol of sols){
        if(S.stop)break;
        const solId=sol.id||sol.solicitationId;if(!solId)continue;
        const det=await A.solDet(solId);if(!det)continue;
        const assets=det.solicitationAssets?.pending?.assets||det.assets?.filter(a=>a.status==='PENDING')||det.solicitationBranchAssets?.filter(a=>a.status==='PENDING')||[];
        for(const asset of assets){
          const rn=[asset.itemName,asset.name,asset.description,asset.productDescription,asset.assetName].find(v=>typeof v==='string'&&v.trim());
          const iname=(rn||'').toUpperCase();
          const icode=asset.itemCode||asset.code||asset.sku||asset.productCode;
          const sbaid=asset.solicitationBranchAssetId||asset.id;
          const qtd=asset.pending||asset.amount||asset.quantity||1;
          if(!iname.includes(pu))continue;
          found=true;
          try{
            await A.envSep(sbaid,icode,qtd);total+=qtd;
            S.sentItems.push({filial:job.filial,product:iname,quantidade:qtd,solicitationBranchAssetId:sbaid,itemCode:icode});
            log(`✓ Filial ${job.filial}: "${iname}" ×${qtd}`,'ok');
          }catch(e){log(`Erro asset ${sbaid}: ${e.message}`,'err');}
          await sleep(300);
        }
      }
      if(total>0){
        S.jobsOk.push(job);if(!S.sepFiliais.includes(job.filial))S.sepFiliais.push(job.filial);
        setRes(job.filial,job.prod,'ok',`${total} item(s) enviados`,total);
        log(`✓ Filial ${job.filial}: ${total} item(s) ok.`,'ok');
      }else if(!found){
        setRes(job.filial,job.prod,'fail',`"${job.prod}" não encontrado nas solicitações pendentes`);
        log(`Filial ${job.filial}: "${job.prod}" não encontrado.`,'warn');
      }else{
        setRes(job.filial,job.prod,'fail','Produto encontrado mas falhou ao enviar');
        log(`Filial ${job.filial}: erro ao enviar.`,'err');
      }
    }catch(e){
      setRes(job.filial,job.prod,'fail',`Erro de API: ${e.message}`);
      log(`Erro filial ${job.filial}: ${e.message}`,'err');
      const d=await modal({tipo:'err',titulo:'Erro na Solicitação',mensagem:`Filial ${job.filial} falhou.`,det:e.message,btns:[{t:'🛑 Parar',v:'stop',cls:'d'},{t:'⏭ Pular',v:'skip',cls:'p'}]});
      if(d==='stop'){S.stop=true;break;}
    }
    await sleep(500);
  }
}

async function stepSeparacao(){
  log('── SEPARAÇÃO ──','info');
  const plan={};
  for(const d of S.sentItems){
    const fn=norm(d.filial),ic=(d.itemCode||'').toString().trim(),qtd=Number(d.quantidade||1);
    if(!fn||!ic||!qtd)continue;
    plan[fn]=plan[fn]||{};
    if(!plan[fn][ic])plan[fn][ic]={ic,desc:d.product||`Item ${ic}`,qtd:0};
    plan[fn][ic].qtd+=qtd;
  }
  const flist=(S.sepFiliais.length?S.sepFiliais:Object.keys(plan)).map(f=>norm(f)).filter(Boolean);
  for(let i=0;i<flist.length;i++){
    if(S.stop)break;
    const fn=flist[i];const fp=plan[fn];
    if(!fp||!Object.keys(fp).length){log(`Filial ${fn}: sem plano.`,'warn');continue;}
    setSt(`Separação ${i+1}/${flist.length} — Filial ${fn}`);
    log(`Bipagem — Filial ${fn}`,'warn');
    const used=new Set();
    for(const item of Object.values(fp)){
      if(S.stop)break;
      const{ic,desc,qtd:total}=item;if(!total)continue;
      log(`Filial ${fn}: "${desc}" → bipar ${total}`,'info');
      let bip=0;
      while(bip<total&&!S.stop){
        const inp=await prompt2({icone:'🔍',titulo:`Bipagem — Filial ${fn}`,mensagem:`${desc}\nItemCode: ${ic}\n\nProgresso: ${bip}/${total}\n\nBipe ou cole o assetId:`,ph:'assetId...'});
        if(inp===null){
          const d=await modal({tipo:'err',titulo:'Bipagem cancelada',mensagem:'O que deseja fazer?',btns:[{t:'🛑 Abortar',v:'abort',cls:'d'},{t:'🔄 Continuar',v:'retry',cls:'p'}]});
          if(d==='abort')throw new Error(`Separação cancelada filial ${fn}`);
          continue;
        }
        const ids=String(inp).split(/[\s,;]+/).map(x=>norm(x)).filter(Boolean);
        for(const aid of ids){
          if(bip>=total)break;
          if(used.has(aid)){log(`Ativo ${aid} já bipado.`,'warn');continue;}
          try{
            await A.sepAsset(aid,fn);used.add(aid);bip++;
            log(`✓ Ativo ${aid} (${bip}/${total})`,'ok');
          }catch(e){
            log(`Erro bipar ${aid}: ${e.message}`,'err');
            const d=await modal({tipo:'err',titulo:'Erro ao bipar',mensagem:`Ativo ${aid} falhou.`,det:e.message,btns:[{t:'🛑 Parar',v:'stop',cls:'d'},{t:'⏭ Pular',v:'skip'},{t:'🔄 Tentar',v:'retry',cls:'p'}]});
            if(d==='stop'){S.stop=true;throw new Error('Interrompido');}
            if(d==='skip')bip++;
          }
          await sleep(150);
        }
      }
    }
  }
  log('Separação concluída.','ok');
}

async function stepBuscarSep(){
  log('── BUSCANDO SEPARADOS ──','info');
  setSt('Buscando ativos separados...');
  const sep=await A.listSep();
  if(!sep?.length){log('Nenhum ativo separado.','warn');return;}
  for(const g of sep){
    for(const b of(g.solicitationsBranch||[])){
      const bid=b.branchId,fn=norm(bid);
      const match=!S.sepFiliais.length||S.sepFiliais.some(f=>norm(f)===fn);
      if(!match)continue;
      const ids=(b.solicitationsAssets||[]).map(sa=>sa.id);
      for(const item of(b.items||[])){
        const{itemCode:ic,description:desc}=item;
        if(!ic||!ids.length)continue;
        try{
          const dets=await A.detSep(ids,ic);
          if(dets?.length)for(const a of dets){const id=a.separatedAssetId||a.id;if(id)S.sepAssets.push({separatedAssetId:id,branchId:bid,itemCode:ic,description:desc});}
          log(`Filial ${bid}: ${dets?.length||0} "${desc}" prontos.`,'info');
        }catch(e){log(`Erro item ${ic}: ${e.message}`,'err');}
        await sleep(200);
      }
    }
  }
  log(`Total: ${S.sepAssets.length} ativo(s).`,'ok');
}

async function stepCarga(){
  log('── CARGA ──','info');
  if(!S.sepAssets.length)throw new Error('Nenhum ativo para a carga');
  const la=S.sepAssets.map(a=>({separatedAssetId:a.separatedAssetId}));
  const op=await modal({icone:'🚚',titulo:'Opção de Carga',mensagem:`${la.length} ativo(s) prontos.\n\nComo deseja prosseguir?`,btns:[{t:'➕ Nova Carga',v:'new',cls:'p'},{t:'📋 Carga Existente',v:'ex'}]});
  if(!op)return;
  try{
    if(op==='ex')await addCargaEx(la);
    else await novaCarga(la);
  }catch(e){
    log(`Erro carga: ${e.message}`,'err');
    const id=await prompt2({icone:'⚠️',titulo:'Erro na API',mensagem:'Digite o ID da carga manualmente:',ph:'ID...'});
    if(id&&!isNaN(parseInt(id))){S.cargaId=parseInt(id);log(`Carga ${id} manual.`,'warn');}
    else throw e;
  }
}

async function addCargaEx(la){
  const r=await A.listarCargas();const cs=r?.records||(Array.isArray(r)?r:[]);
  if(!cs.length)return novaCarga(la);
  const idx=await listaModal({icone:'📋',titulo:'Selecionar Carga',itens:cs.map(c=>({t:`Carga #${c.id}`,s:`${c.freightType||'?'} · ${c.date?c.date.split('T')[0]:'?'}`,d:c.destinationsCode||''}))});
  if(idx===null)return;
  const cargaSel=cs[idx];
  S.cargaId=cargaSel.id;
  // Pega os dados da carga existente pra usar no e-mail
  S.freight=cargaSel.freightType||'DEDICATED';
  S.depDate=cargaSel.departureDate||cargaSel.date||'';
  await A.addCarga(S.cargaId,C.OC,la);
  log(`✓ ${la.length} ativo(s) → carga #${S.cargaId}`,'ok');
  const c=await modal({tipo:'ok',titulo:'Ativos adicionados!',mensagem:`Carga #${S.cargaId}\n${la.length} ativos.\n\nConferir agora?`,btns:[{t:'Não',v:'n'},{t:'Sim',v:'s',cls:'p'}]});
  S.cargaOk=c==='s';
}

async function novaCarga(la){
  const r=await A.criarCarga(C.OC,la);
  S.cargaId=r?.loadId||r?.id;if(!S.cargaId)throw new Error('API não retornou loadId');
  log(`✓ Carga #${S.cargaId} criada!`,'ok');
  // Tipo de frete — agora com ABA
  const tp=await prompt2({icone:'🚚',titulo:'Tipo de Frete',mensagem:'D = DEDICADO\nC = CORREIOS\nA = ABA',ph:'D, C ou A'});
  if(!tp){log('Carga criada, não enviada.','warn');return;}
  let ft='DEDICATED';
  const tpu=tp.trim().toUpperCase();
  if(tpu.startsWith('C'))ft='CORREIOS';
  else if(tpu.startsWith('A'))ft='ABA';
  else ft='DEDICATED';
  S.freight=ft;
  const agora=new Date();
  const dh=await prompt2({icone:'📅',titulo:'Data e Hora da Saída',mensagem:'Formato: YYYY-MM-DD HH:MM\n(em branco = amanhã 08:00)',ph:`${agora.toISOString().split('T')[0]} 08:00`});
  let dd;
  if(!dh){const t=new Date();t.setDate(t.getDate()+1);t.setHours(8,0,0,0);dd=t.toISOString().slice(0,19);}
  else{const pts=dh.trim().split(/[\s,]+/);dd=`${pts[0]}T${pts[1]||'08:00'}:00`;}
  S.depDate=dd;
  const freteLabel=ft==='CORREIOS'?'Correios':ft==='ABA'?'ABA':'Dedicado';
  const c=await modal({tipo:'info',icone:'📤',titulo:'Confirmar Envio',mensagem:`Carga: #${S.cargaId}\nTipo: ${freteLabel}\nSaída: ${dd.replace('T',' ')}\nAtivos: ${la.length}`,btns:[{t:'Cancelar',v:'n'},{t:'Enviar',v:'s',cls:'p'}]});
  if(c!=='s'){log('Envio cancelado.','warn');return;}
  await A.enviarCarga(S.cargaId,ft,dd);S.cargaOk=true;log(`✓ Carga #${S.cargaId} enviada!`,'ok');
}

async function stepConferencia(){
  log('── CONFERÊNCIA ──','info');
  const lid=S.cargaId;
  const ci=await A.filsCarga(lid);if(!ci){log('Sem info da carga.','err');return;}

  // Se ainda não temos freight/depDate (modo carga com carga existente), busca da API
  if(!S.freight||!S.depDate){
    try{
      const det=await A.detCarga(lid);
      if(det){
        S.freight=S.freight||det.freightType||'DEDICATED';
        S.depDate=S.depDate||det.departureDate||det.date||'';
      }
    }catch(e){log('Não foi possível buscar dados da carga: '+e.message,'warn');}
  }

  const isCorr=ci.freightType==='CORREIOS'||(S.freight==='CORREIOS');
  const fils=[];const _seen=new Set();
  for(const s of(ci.stockCd||[]))for(const b of(s.branches||[])){const id=b.number||b.branchId;if(id&&b.status==='PENDING'){const _n=String(id).replace(/\D/g,'').replace(/^0+/,'')||'0';if(!_seen.has(_n)){_seen.add(_n);fils.push({branchId:id});}}}
  const ord=S.jobs.map(j=>norm(j.filial));
  fils.sort((a,b)=>{const ia=ord.indexOf(norm(a.branchId)),ib=ord.indexOf(norm(b.branchId));return(ia<0?9999:ia)-(ib<0?9999:ib);});
  if(!fils.length){log('Sem filiais pendentes.','info');return;}
  log(`${fils.length} filial(is) para conferir.`,'info');
  if(isCorr){
    for(const f of fils){
      let tr=null;
      while(!tr){
        tr=await prompt2({icone:'📮',titulo:`Rastreio — Filial ${f.branchId}`,mensagem:`Código obrigatório para filial ${f.branchId}:`,ph:'AA123456789BR'});
        if(!tr){const d=await modal({tipo:'err',titulo:'Rastreio obrigatório',mensagem:'Sem rastreio não é possível continuar.',btns:[{t:'🛑 Abortar',v:'abort',cls:'d'},{t:'🔄 Tentar',v:'retry',cls:'p'}]});if(d==='abort')throw new Error('Conferência cancelada: sem rastreio');}
      }
      const _raw=String(f.branchId).replace(/\D/g,'');
      const _norm=_raw.replace(/^0+/,'');
      S.tracks[f.branchId]=tr;
      S.tracks[_raw]=tr;
      S.tracks[_norm]=tr;
      S.tracks[_norm.padStart(3,'0')]=tr;
      S.tracks[_norm.padStart(4,'0')]=tr;
      log(`Rastreio filial ${_norm}: ${tr}`,'ok');
    }
  }
  let tot=0,errs=0;
  for(let i=0;i<fils.length;i++){
    if(S.stop)break;
    const{branchId}=fils[i];
    setSt(`Conferindo filial ${branchId} (${i+1}/${fils.length})...`);setProg(68+Math.round(i/fils.length*25));
    try{
      const its=await A.itensBranch(lid,branchId);if(!its?.length){log(`Filial ${branchId}: sem itens.`,'info');continue;}
      let c=0,e=0;
      for(const g of its)for(const item of(g.items||[]))for(const asset of(item.separatedAssets||[])){
        if(S.stop)break;const aid=asset.assetId;if(!aid)continue;
        let rt=0,ok=false;
        while(rt<C.RET&&!ok){try{await A.conferir(lid,aid,isCorr?(S.tracks[branchId]||''):'');c++;tot++;ok=true;}catch(e2){if(e2.message&&e2.message.includes('409')){log(`Ativo ${aid}: ja conferido (ok)`,'info');c++;tot++;ok=true;}else{rt++;if(rt>=C.RET){e++;errs++;log(`Erro ativo ${aid}: ${e2.message}`,'err');}else await sleep(C.RD);}}}
        await sleep(150);
      }
      e>0?S.confFilErr.push(branchId):S.confFilOk.push(branchId);
      log(`Filial ${branchId}: ${c} ok${e?` · ${e} erro(s)`:''}`,'ok');
    }catch(e){log(`Erro filial ${branchId}: ${e.message}`,'err');S.confFilErr.push(branchId);}
    await sleep(300);
  }
  S.confOk=tot;S.confErr=errs;
  log(`Conferência: ${tot} ok · ${errs} erro(s).`,'ok');
  const fc=fils.map(f=>f.branchId);
  if(tot>0){
    if(errs===0)await stepNFe(lid,fc);
    else{const d=await modal({tipo:'warn',titulo:'Houve erros',mensagem:`${tot} conferidos · ${errs} erros.\n\nEmitir NF-e mesmo assim?`,btns:[{t:'Não',v:'n'},{t:'Sim',v:'s',cls:'p'}]});if(d==='s')await stepNFe(lid,fc);}
  }
}

async function stepNFe(lid,fils){
  log('── NF-E ──','info');S.nfeFail=[];S.nfeSucess=[];
  const c=await modal({tipo:'info',icone:'📄',titulo:'Emitir NF-e',mensagem:`Carga #${lid}\n${fils.length} filial(is)\n\nEmitir as NF-e agora?`,btns:[{t:'Agora não',v:'n'},{t:'Emitir',v:'s',cls:'p'}]});
  if(c!=='s'){emitirEtiquetas([...new Set(fils.map(f=>norm(f)).filter(Boolean))]);return;}
  for(let i=0;i<fils.length;i++){
    const fid=fils[i];setSt(`NF-e filial ${fid} (${i+1}/${fils.length})...`);
    let t=0,ok=false;
    while(t<C.RET&&!ok){try{t++;await A.nfe(lid,fid);ok=true;S.nfeSucess.push(fid);log(`✓ NF-e filial ${fid}`,'ok');}catch(e){if(t<C.RET)await sleep(C.RD);else{S.nfeFail.push({branchId:fid,erro:e.message});log(`Erro NF-e ${fid}: ${e.message}`,'err');}}}
    if(i<fils.length-1)await sleep(500);
  }
  S.nfeOk=S.nfeSucess.length>0;
  log(`NF-e: ${S.nfeSucess.length} ok · ${S.nfeFail.length} erro(s).`,S.nfeFail.length?'warn':'ok');
  emitirEtiquetas([...new Set(fils.map(f=>norm(f)).filter(Boolean))]);
}

async function emitirEtiquetas(fils){
  if(!fils?.length)return;
  const c=await modal({tipo:'info',icone:'🖨️',titulo:'Emitir Etiquetas',mensagem:`Filiais: ${fils.join(', ')}\nCarga: #${S.cargaId}\n\nAbrir Google Planilhas?`,btns:[{t:'Não',v:'n'},{t:'Abrir',v:'s',cls:'p'}]});
  if(c!=='s')return;
  const pl=encodeURIComponent(JSON.stringify({filiais:fils,carga:S.cargaId,origem:C.OC,timestamp:Date.now()}));
  window.open(`https://script.google.com/a/macros/magazineluiza.com.br/s/AKfycbwHsUtz3myhdcLh8VdQABCMRhSmmaGRFZjAvEgr57JC2pkMr-bXamqjt5kagdsFqzF7Aw/exec?autoPrint=${pl}`,'_blank');
  const _ipf=await _fetchItensCarga(fils);
  await envEmails(fils,_ipf);
}

// Busca itens por filial da carga atual
async function _fetchItensCarga(fils){
  const ipf={};
  if(!S.cargaId)return ipf;
  for(const f of fils){
    try{
      const its=await A.itensBranch(S.cargaId,f);
      const lst=[];
      if(its?.length)for(const g of its)for(const it of(g.items||[]))lst.push({produto:it.itemName||it.description||'Produto',qtd:(it.separatedAssets||[]).length||1});
      ipf[f]=lst.length?lst:[{produto:'Produto não identificado',qtd:1}];
    }catch(_){ipf[f]=[];}
  }
  return ipf;
}

async function envEmails(fils,itensPorFilial={},rastreiosOverride=null){
  if(!fils?.length)return;
  log(`E-mails para ${fils.length} filial(is)...`,'info');
  const APPS_URL='https://script.google.com/macros/s/AKfycbxhXM_SZyYON_Ue2xh0PMD_nqiywwS_zIqKAdGP0rHGe9nENgeKP1lKOJdQHeSPTSsuxw/exec';
  const rastreiosNorm={};
  for(const f of fils){
    const fn=String(f).replace(/\D/g,'').replace(/^0+/,'')||'0';
    let tr=null;
    if(rastreiosOverride){
      tr=rastreiosOverride[fn]||rastreiosOverride[f]||null;
    }else{
      tr=S.tracks[f]||S.tracks[fn]
        ||S.tracks[fn.padStart(3,'0')]||S.tracks[fn.padStart(4,'0')]
        ||S.tracks[fn.padStart(5,'0')]||S.tracks['0'+fn]||null;
    }
    if(tr)rastreiosNorm[fn]=tr;
  }
  const payload=JSON.stringify({acao:'enviarEmails',filiais:fils,carga:S.cargaId,freightType:S.freight||'DEDICATED',departureDate:S.depDate||'',rastreios:rastreiosNorm,itensPorFilial});
  return new Promise(resolve=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST',APPS_URL,true);
    xhr.setRequestHeader('Content-Type','text/plain;charset=UTF-8');
    xhr.onload=()=>{
      try{
        const j=JSON.parse(xhr.responseText);
        if(j.ok)log(`✓ E-mails enviados: ${(j.enviados||fils).join(', ')}${j.erros?.length?' | Erros: '+j.erros.map(e=>e.filial).join(','):''}`,'ok');
        else log(`Apps Script erro: ${j.erro}`,'err');
      }catch(_){
        log(`E-mails disparados para: ${fils.join(', ')} (sem confirmação - verifique Apps Script)`,'ok');
      }
      resolve();
    };
    xhr.onerror=()=>{
      log(`Erro de rede ao enviar e-mails. Tentando GET...`,'warn');
      const params=new URLSearchParams({acao:'enviarEmails',filiais:fils.join(','),carga:String(S.cargaId||''),freightType:S.freight||'DEDICATED',departureDate:S.depDate||''});
      const w=window.open(APPS_URL+'?'+params.toString(),'_blank');
      setTimeout(()=>{try{w&&w.close();}catch(_){}},5000);
      log('Fallback GET disparado.','warn');
      resolve();
    };
    xhr.send(payload);
  });
}

async function testarEmails(){
  log('Buscando cargas...','info');
  let cs=[];try{const r=await A.listarCargas();cs=r?.records||(Array.isArray(r)?r:[]);}catch(e){log(`Erro: ${e.message}`,'err');return;}
  if(!cs.length){log('Nenhuma carga.','warn');return;}
  const idx=await listaModal({icone:'📧',titulo:'Selecione a Carga',itens:cs.map(c=>({t:`Carga #${c.id}`,s:`${c.freightType||'?'} · ${c.date?c.date.split('T')[0]:'?'}`,d:c.destinationsCode||''}))});
  if(idx===null)return;
  const ch=cs[idx];S.cargaId=ch.id;S.freight=ch.freightType;S.depDate=ch.departureDate||ch.date||'';
  const ci=await A.filsCarga(ch.id);
  let fils=[];for(const s of(ci?.stockCd||[]))for(const b of(s.branches||[])){const id=b.number||b.branchId;if(id){const _n=String(id).replace(/\D/g,'').replace(/^0+/,'')||'0';fils.push(_n);}}fils=[...new Set(fils)];
  if(!fils.length){log('Sem filiais.','warn');return;}
  const ipf=await _fetchItensCarga(fils);
  const c=await modal({tipo:'info',icone:'📧',titulo:'Confirmar',mensagem:`Carga #${ch.id} · ${ch.freightType}\nFiliais (${fils.length}): ${fils.join(', ')}\n\nIsso enviará e-mails REAIS.`,btns:[{t:'Cancelar',v:'n'},{t:'Enviar',v:'s',cls:'p'}]});
  if(c!=='s')return;

  const rastreiosEmail={};
  if(ch.freightType==='CORREIOS'){
    log('Buscando códigos de rastreio automaticamente...','info');
    for(const f of fils){
      const fn=String(f).replace(/\D/g,'').replace(/^0+/,'')||'0';
      let trEncontrado=null;
      try{
        const its=await A.itensBranch(ch.id,f);
        if(its?.length){
          outer:for(const g of its){
            for(const it of(g.items||[])){
              for(const asset of(it.separatedAssets||[])){
                const tr=asset.trackingNumber||asset.tracking||asset.trackCode||null;
                if(tr&&String(tr).trim()&&String(tr).trim()!=='null'){trEncontrado=String(tr).trim();break outer;}
              }
            }
          }
        }
      }catch(e){log(`Erro ao buscar rastreio filial ${fn}: ${e.message}`,'warn');}
      if(trEncontrado){
        rastreiosEmail[fn]=trEncontrado;
        log(`✓ Rastreio filial ${fn}: ${trEncontrado}`,'ok');
      }else{
        log(`Rastreio não encontrado para filial ${fn}, solicitando manualmente...`,'warn');
        let tr=null;
        while(!tr){
          tr=await prompt2({icone:'📮',titulo:`Rastreio — Filial ${fn}`,mensagem:`Digite o código para filial ${fn}:`,ph:'AA123456789BR'});
          if(!tr){
            const d=await modal({tipo:'err',titulo:'Rastreio obrigatório',mensagem:`Sem rastreio a filial ${fn} não receberá o código no e-mail.`,btns:[{t:'Pular esta filial',v:'skip',cls:'d'},{t:'Digitar',v:'retry',cls:'p'}]});
            if(d==='skip'){tr='(não informado)';break;}
          }
        }
        rastreiosEmail[fn]=tr;
        log(`Rastreio filial ${fn}: ${tr} (manual)`,'info');
      }
    }
  }
  await envEmails(fils,ipf,rastreiosEmail);
}

// ═══ RESUMO FINAL ══════════════════════════════════════
async function finalModal(){
  const results=Object.values(S.results);
  const oks=results.filter(r=>r.status==='ok');
  const fails=results.filter(r=>r.status==='fail');
  const dur=S.startTime?Math.round((Date.now()-S.startTime)/1000):0;
  const mm=Math.floor(dur/60),ss=dur%60;
  const rks=Object.keys(S.tracks||{});
  let resTable='';
  if(results.length>0){
    resTable=`<div style="max-height:160px;overflow-y:auto;border:1px solid var(--b1);border-radius:8px;margin-bottom:10px;">
<table class="aa-rtable"><thead><tr><th>Filial</th><th>Produto</th><th>Status</th></tr></thead><tbody>`;
    for(const r of[...oks,...fails]){
      const cls=r.status==='ok'?'ok':'fail';
      const tag=r.status==='ok'?`<span class="tag-ok">✓ ×${r.qtd}</span>`:`<span class="tag-fail">✗ Falhou</span>`;
      resTable+=`<tr class="${cls}"><td><strong>${r.f}</strong></td>
<td style="font-family:'JetBrains Mono',monospace;font-size:10px">${r.p}</td><td>${tag}</td></tr>`;
    }
    resTable+='</tbody></table></div>';
  }
  let cargaInfo='';
  if(S.cargaId){
    const freteLabel=S.freight==='CORREIOS'?'Correios':S.freight==='ABA'?'ABA':'Dedicado';
    cargaInfo=`<div class="aa-final-sec">
<div class="aa-final-row"><span class="aa-final-k">Carga</span><span class="aa-final-v">#${S.cargaId}</span></div>
<div class="aa-final-row"><span class="aa-final-k">Tipo</span><span class="aa-final-v">${freteLabel}</span></div>
<div class="aa-final-row"><span class="aa-final-k">Conferidos</span><span class="aa-final-v" style="color:${S.confErr?'#fca5a5':'#86efac'}">${S.confOk}${S.confErr?` · ${S.confErr} erros`:' ✓'}</span></div>
<div class="aa-final-row"><span class="aa-final-k">NF-e</span><span class="aa-final-v" style="color:${S.nfeOk?'#86efac':'#fcd34d'}">${S.nfeOk?'✓ Solicitada':'⏳ Pendente'}</span></div>
</div>`;
  }
  let rast='';
  if(rks.length){
    rast=`<div class="aa-final-sec"><div style="font-size:9.5px;color:var(--t3);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Rastreios</div>
${rks.map(k=>`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#93c5fd;margin-bottom:2px">${k} → ${S.tracks[k]}</div>`).join('')}
</div>`;
  }
  const v=await modal({
    icone:fails.length?'⚠️':'🎉',
    titulo:fails.length?`${fails.length} falha(s) — veja o resumo`:'Processo concluído!',
    tipo:fails.length?'warn':'ok',
    wide:'aa-final-modal',
    html:`
<div style="font-size:10.5px;color:var(--t3);text-align:center;margin-bottom:12px;font-family:'JetBrains Mono',monospace">${new Date().toLocaleString('pt-BR')} · ${mm>0?mm+'m ':''}${ss}s · ${S.modo||''}</div>
<div class="aa-res-sum">
  <div class="aa-res-cell"><div class="aa-res-val" style="color:#93c5fd">${S.jobs.length}</div><div class="aa-res-lbl">Filiais</div></div>
  <div class="aa-res-cell"><div class="aa-res-val" style="color:var(--green)">${oks.length}</div><div class="aa-res-lbl">OK</div></div>
  <div class="aa-res-cell"><div class="aa-res-val" style="color:${fails.length?'var(--red)':'var(--green)'}">  ${fails.length}</div><div class="aa-res-lbl">Falhas</div></div>
</div>
${resTable}${cargaInfo}${rast}`,
    btns:[{t:'📋 Copiar',v:'copy'},{t:'Fechar',v:'close',cls:'p'}]
  });
  if(v==='copy'){
    const lines=['AUTO ATIVOS v15 — '+new Date().toLocaleString('pt-BR'),`Modo: ${S.modo} · ${mm}m${ss}s`,'','=== RESULTADO POR FILIAL ==='];
    for(const r of results){lines.push(`  ${r.f.padEnd(6)} ${r.p.padEnd(20)} ${r.status==='ok'?'✓ OK (×'+r.qtd+')':'✗ FALHOU'}`);if(r.status==='fail')lines.push(`         ${r.motivo}`);}
    if(S.cargaId){lines.push('',`=== CARGA #${S.cargaId} ===`,`Tipo: ${S.freight||'N/A'}`,`Conferidos: ${S.confOk} | Erros: ${S.confErr}`,`NF-e: ${S.nfeOk?'Solicitada':'Pendente'}`);}
    if(rks.length){lines.push('','=== RASTREIOS ===');rks.forEach(k=>lines.push(`  ${k}: ${S.tracks[k]}`));}
    navigator.clipboard.writeText(lines.join('\n'));
  }
}

// ═══ INIT ══════════════════════════════════════════════
injectCSS();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(buildPanel,600));
else setTimeout(buildPanel,600);
syncTok();
})();
