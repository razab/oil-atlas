'use strict';
(async()=>{
 const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 try{
  const scope=new URLSearchParams(location.search).get('canary')==='1'?'canary':'full',bundle=await loadValidatedData(scope),v=bundle.validation,s=v.summary;
  window.atlasValidation=bundle;
  $('#status').textContent='Проверки пройдены; ограничения покрытия перечислены ниже.';
  $('#scope').textContent=scope==='canary'?'Проверочный срез: Россия, США, Франция и контрольные страны. Это тест пути от источников до опубликованной карты.':'Зафиксированная версия от '+bundle.retrieved+'. Данные собраны и нормализованы до загрузки карты.';
  const labels={observations:'исходных записей',directedFlows:'связей на карте',comparableOilBalances:'стран с нефтяным балансом',reserveCountries:'стран с запасами',reconciliations:'сверок итогов',reportedZeros:'опубликованных нулей',missing:'явных пропусков'};
  $('#metrics').innerHTML=Object.entries(labels).map(([k,label])=>`<div class="metric"><strong>${s[k]}</strong>${label}</div>`).join('');
  $('#limitations').innerHTML=v.limitations.map(t=>`<li>${esc(t)}</li>`).join('');
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:8}).format(n);
  $('#checks').innerHTML=v.reconciliations.map(c=>`<tr><td>${esc(c.label)}</td><td>${fmt(c.actual)}</td><td>${fmt(c.expected)}</td><td>${c.tolerance}</td><td>${esc(c.unit)}</td></tr>`).join('');
  $('#sources').innerHTML=Object.entries(bundle.sources).map(([name,s])=>`<p><strong>${esc(name)}</strong>${s.url?` · <a href="${esc(s.url)}" target="_blank" rel="noopener">Источник ↗</a>`:''}<br><small>SHA-256: <code>${s.sha256}</code>${s.authentication?'<br>'+esc(s.authentication):''}${s.extraction?'<br>'+esc(s.extraction):''}</small></p>`).join('');
  $('#excluded').innerHTML=v.excluded.map(c=>`<p><strong>${esc(c.label)}</strong> · ${esc(c.source)}<br><small>${esc(c.reason)}</small></p>`).join('');
  const render=()=>{
   const q=$('#search').value.trim().toLowerCase(),rows=bundle.observations.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
   $('#count').textContent=`Найдено ${rows.length}; показаны первые ${Math.min(rows.length,60)}.`;
   $('#observations').innerHTML=rows.slice(0,60).map(r=>`<tr><td><button class="record" data-record="${esc(r.id)}">${esc(r.origin?r.origin+' → '+r.destination:r.country+(r.subdivision?' / '+r.subdivision:''))}</button><br><small>${esc(r.locator)}</small></td><td>${esc(r.product)} / ${esc(r.measure)}</td><td>${r.year}</td><td>${r.value===null?'нет данных':fmt(r.value)+' '+esc(r.unit)}</td><td>${esc(r.status)}</td></tr>`).join('');
   document.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>{const r=bundle.observations.find(x=>x.id===b.dataset.record);$('#record-detail').textContent=JSON.stringify(r,null,2);$('#record-detail').hidden=false;$('#record-detail').scrollIntoView({block:'nearest'});});
  };$('#search').oninput=render;render();
  const base=scope==='canary'?'data/validation-canary/':'data/validated/';const m=await (await fetch(base+'manifest.json',{cache:'no-cache'})).json();$('#download').href=base+m.bundle;
 }catch(e){$('#status').className='error';$('#status').textContent='Набор не допущен к отображению: '+e.message;console.error(e);}
})();
