'use strict';
(async()=>{
 const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const products={crude:'Сырая нефть',oil_liquids:'Нефтяные жидкости',ngpl:'Газовые нефтяные жидкости',natural_gas:'Весь природный газ',pipeline:'Трубопроводный газ',lng:'СПГ',gasoline:'Готовый бензин',diesel:'Дистилляты',refined:'Нефтепродукты (HS 271012/271019/271020)'},measures={production:'Производство',consumption:'Спрос',refinery_input:'Вход на НПЗ',product_supplied:'Внутренний рынок',reserves:'Запасы',opening_stock:'Начальный складской запас',closing_stock:'Конечный складской запас',origin_share:'Доля поставщика',refining_capacity:'Проектная мощность НПЗ',trade_component:'Компонент торговли HS',trade:'Поставки',total_imports:'Итог импорта',total_exports:'Итог экспорта'},statuses={observed:'Опубликовано',reported_zero:'Ноль в источнике',missing:'Нет значения'},units={'bbl/day':'барр./сутки','tonne/year':'тонн/год','m3/year':'м³/год',bbl:'барр.',tonne:'тонн',percent:'%'};
 try{
  const scope=new URLSearchParams(location.search).get('canary')==='1'?'canary':'full',bundle=await loadValidatedData(scope),v=bundle.validation,s=v.summary;
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:8}).format(n);
  $('#status').textContent='Проверки пройдены; ограничения покрытия перечислены ниже.';
  $('#scope').textContent=scope==='canary'?'Проверочный срез: Россия, США, Франция и контрольные страны. Это тест пути от источников до опубликованной карты.':'Зафиксированная версия от '+bundle.retrieved+'. Данные собраны и нормализованы до загрузки карты.';
  const labels={observations:'исходных записей',directedFlows:'связей на карте',comparableOilBalances:'стран с нефтяным балансом',reserveCountries:'стран с запасами',reconciliations:'сверок итогов',reportedZeros:'опубликованных нулей',missing:'явных пропусков'};
  $('#metrics').innerHTML=Object.entries(labels).map(([k,label])=>`<div class="metric"><strong>${s[k]}</strong>${label}</div>`).join('');
  $('#comparisons').innerHTML=v.comparisons.map(c=>`<p><strong>${esc(c.label)}</strong><br>${esc(c.note)}${c.values?'<br>'+c.values.map(n=>fmt(n)+' '+esc(c.unit)).join(' / '):''}</p>`).join('');
  $('#limitations').innerHTML=v.limitations.map(t=>`<li>${esc(t)}</li>`).join('');
  $('#checks').innerHTML=v.reconciliations.map(c=>`<tr><td>${esc(c.label)}</td><td>${fmt(c.actual)}</td><td>${fmt(c.expected)}</td><td>${c.tolerance}</td><td>${esc(c.unit)}</td></tr>`).join('');
  $('#sources').innerHTML=Object.entries(bundle.sources).map(([name,s])=>`<p><strong>${esc(name)}</strong>${s.url?` · <a href="${esc(s.url)}" target="_blank" rel="noopener">Источник ↗</a>`:''}<br><small>SHA-256: <code>${s.sha256}</code>${s.pdfSha256?'<br>SHA-256 исходного PDF: <code>'+esc(s.pdfSha256)+'</code>':''}${s.authentication?'<br>'+esc(s.authentication):''}${s.extraction?'<br>'+esc(s.extraction):''}</small></p>`).join('');
  $('#excluded').innerHTML=v.excluded.map(c=>`<p><strong>${esc(c.label)}</strong> · ${esc(c.source)}<br><small>${esc(c.reason)}</small></p>`).join('');
  const render=()=>{
   const q=$('#search').value.trim().toLowerCase(),rows=bundle.observations.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
   $('#count').textContent=`Найдено ${rows.length}; показаны первые ${Math.min(rows.length,60)}.`;
   $('#observations').innerHTML=rows.slice(0,60).map(r=>`<tr><td><button class="record" data-record="${esc(r.id)}">${esc(r.origin?r.origin+' → '+r.destination:r.country+(r.subdivision?' / '+r.subdivision:''))}</button><br><small>${esc(r.locator)}</small></td><td>${esc(products[r.product]||r.product)} / ${esc(measures[r.measure]||r.measure)}</td><td>${r.year}</td><td>${r.value===null?'нет данных':fmt(r.value)+' '+esc(units[r.unit]||r.unit)}</td><td>${r.estimated?'≈ Оценка / расчёт из долей':esc(statuses[r.status]||r.status)}</td></tr>`).join('');
   document.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>{const r=bundle.observations.find(x=>x.id===b.dataset.record);$('#record-detail').textContent=JSON.stringify(r,null,2);$('#record-detail').hidden=false;$('#record-detail').scrollIntoView({block:'nearest'});});
  };$('#search').value=new URLSearchParams(location.search).get('q')||'';$('#search').oninput=render;render();
  const base=scope==='canary'?'data/validation-canary/':'data/validated/';const m=await (await fetch(base+'manifest.json',{cache:'no-cache'})).json();$('#download').href=base+m.bundle;window.atlasValidation=bundle;
 }catch(e){$('#status').className='error';$('#status').textContent='Набор не допущен к отображению: '+e.message;console.error(e);}
})();
