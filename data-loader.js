'use strict';
window.loadValidatedData=async function(scope='full'){
 const base=scope==='canary'?'data/validation-canary/':'data/validated/';
 const get=async url=>{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('Не удалось загрузить проверенные данные');return r;};
 const manifest=await (await get(base+'manifest.json')).json();
 if(manifest.schemaVersion!==1||manifest.scope!==scope||!/^([a-f0-9]{64})\.json$/.test(manifest.bundle)||manifest.bundle!==manifest.sha256+'.json')throw Error('Неверный паспорт набора данных');
 const bytes=await (await get(base+manifest.bundle)).arrayBuffer();
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(digest!==manifest.sha256)throw Error('Данные повреждены или не совпадают с проверенной версией');
 const bundle=JSON.parse(new TextDecoder().decode(bytes));
 if(bundle.schemaVersion!==1||bundle.scope!==scope||bundle.validation?.status!=='passed_with_limitations'||bundle.validation.summary.observations!==bundle.observations.length)throw Error('Набор не прошёл проверку');
 const ids=new Set();
 for(const r of bundle.observations){
  if(ids.has(r.id)||!bundle.sources[r.source]||r.sourceSha256!==bundle.sources[r.source].sha256||![2024,2025].includes(r.year)||![null,'missing','reported_zero','observed'].includes(r.status)||!(r.value===null||Number.isFinite(r.value)&&r.value>=0))throw Error('Ошибка структуры проверенного набора');ids.add(r.id);
 }
 for(const f of bundle.views.connections.flows)if(!ids.has(f.observation)||!bundle.views.connections.nodes[f.origin]||!bundle.views.connections.nodes[f.destination]||!(f.value>0))throw Error('Торговая связь не подтверждена исходной записью');
 return bundle;
};
