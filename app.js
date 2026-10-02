'use strict';
const $ = s => document.querySelector(s);
const fmt = (v, digits=2) => v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('ru-RU', {maximumFractionDigits:digits,minimumFractionDigits:digits});
const signed = v => v == null ? '—' : `${v>0?'+':''}${fmt(v)}`;
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const climate = v => v == null ? 'unknown' : v >= 0 ? 'surplus' : 'deficit';
const modeNames = {balance:'Производство − потребление · млн барр./сутки',production:'Производство нефти, конденсата и NGL · млн барр./сутки · 2025',consumption:'Спрос на нефть без биотоплива · млн барр./сутки · 2025',reserves:'Доказанные запасы сырой нефти · млрд баррелей · конец 2024'};
const explanations = {balance:'Зелёный — производит больше, чем потребляет. Оранжевый — потребляет больше, чем производит. Серый — нет сопоставимых данных.',production:'Чем насыщеннее зелёный, тем больше производство нефти, конденсата и NGL. Серый — нет данных.',consumption:'Чем насыщеннее оранжевый, тем больше спрос на нефть. Серый — нет данных.',reserves:'Доказанные запасы сырой нефти на конец 2024 года. Серый — нет отдельного значения для страны. Нефтяные пески Канады исключены.'};
const chokes = [
 {name:'Малаккский пролив',value:23.2,coords:[101.5,3.5],short:'Малакка'},
 {name:'Ормузский пролив',value:20.9,coords:[56.5,26.5],short:'Ормуз'},
 {name:'Мыс Доброй Надежды',value:9.1,coords:[18.5,-34.5],short:'Добрая Надежда'},
 {name:'Суэц + трубопровод SUMED',value:4.9,coords:[32.5,30],short:'Суэц / SUMED'},
 {name:'Датские проливы',value:4.9,coords:[12,56],short:'Датские'},
 {name:'Баб-эль-Мандеб',value:4.2,coords:[43.3,12.6],short:'Баб-эль-Мандеб'},
 {name:'Турецкие проливы',value:3.7,coords:[26.5,40],short:'Турецкие'},
 {name:'Панамский канал',value:2.3,coords:[-79.7,9],short:'Панама'}
];
let data, countries, byId, features, path, projection, svg, zoom, mapGroup, countryPaths, countryDots, nodeGroup;
let mode='balance', selected='SAU', allRows=false;
const stateFromHash = () => {
 const q = new URLSearchParams(location.hash.slice(1));
 mode = Object.hasOwn(modeNames,q.get('mode')) ? q.get('mode') : 'balance';
 selected = countries?.has(q.get('country')) ? q.get('country') : countries?.has('SAU') ? 'SAU' : data.countries[0]?.iso;
 $('#routes-toggle').checked=q.get('routes')==='1';
};
function writeState(){ const q=new URLSearchParams({country:selected,mode});if($('#routes-toggle').checked)q.set('routes','1');history.replaceState(null,'',`#${q}`); }
function selectCountry(iso, scroll=false){if(!countries.has(iso))return; selected=iso;renderCountry();renderMode();writeState();$('#country-search').value='';$('#search-results').hidden=true;if(scroll)$('#atlas').scrollIntoView({behavior:'smooth'});}
function renderCountry(){
 const c=countries.get(selected);if(!c)return;
 const b=c.balance, cls=climate(b), status=b==null?'Нет сопоставимого баланса':b>0?'↑ Производит больше, чем потребляет':b<0?'↓ Потребляет больше, чем производит':'Производство равно потреблению';
 const max=Math.max(c.production||0,c.consumption||0,0.001);
 $('#country-details').innerHTML=`<div class="country-eyebrow"><span>КАРТОЧКА СТРАНЫ</span><span>${esc(c.iso)} / 2025</span></div><h3 class="country-name">${esc(c.name)}</h3><span class="status-badge ${cls==='deficit'?'negative':cls==='unknown'?'unknown':''}">${status}</span><div class="balance-big ${cls}">${signed(b)}</div><p class="balance-unit">баланс · млн баррелей в сутки</p><div class="detail-row"><span>Производство</span><b>${fmt(c.production)} млн</b></div><div class="comparison-bar"><span style="width:${(c.production||0)/max*100}%"></span></div><div class="detail-row"><span>Потребление</span><b>${fmt(c.consumption)} млн</b></div><div class="comparison-bar orange"><span style="width:${(c.consumption||0)/max*100}%"></span></div><div class="reserve-block"><div class="detail-row"><span>Доказанные запасы</span><b>${fmt(c.reserves,1)} млрд</b></div><div class="country-eyebrow"><span>СЫРАЯ НЕФТЬ</span><span>${c.reserveYear?'КОНЕЦ '+c.reserveYear:'НЕТ ДАННЫХ'}</span></div><div class="years-callout"><strong>${fmt(c.yearsConsumption,0)}</strong> условных лет<br>при потреблении уровня 2025 года${c.yearsProduction!==null?`<br><span>${fmt(c.yearsProduction,0)} лет при добыче сырой нефти</span>`:''}</div><p class="country-disclaimer">Производство: ${esc(c.productionSource??'нет данных')}. Спрос: ${esc(c.consumptionSource??'нет данных')}.<br>${c.reserveNote?esc(c.reserveNote):c.reserves==null?'Нет отдельного значения запасов в таблице OPEC. Пропуск не означает отсутствие нефти.':'Запасы / годовой спрос. Грубое сопоставление сырой нефти и нефтепродуктов; не прогноз исчерпания.'}</p></div>`;
}
function color(v){
 if(v==null)return '#344852';
 if(mode==='balance'){const t=Math.min(1,Math.sqrt(Math.abs(v)/12));return d3.interpolateRgb('#31494d',v>=0?'#36b38c':'#e68d52')(t);}
 const max = mode==='reserves'?303.221:25;
 return d3.interpolateRgb('#31494d',mode==='consumption'?'#e69b65':mode==='reserves'?'#b6c781':'#43bf9d')(Math.min(1,Math.sqrt(v/max)));
}
function renderMode(){
 if(!countryPaths)return;
 if(countryDots)countryDots.attr('fill',c=>color(c[mode])).classed('selected',c=>c.iso===selected);
 countryPaths.attr('fill',f=>color(byId.get(String(+f.id))?.[mode]??null)).classed('selected',f=>byId.get(String(+f.id))?.iso===selected);
 document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
 $('#map-subtitle').textContent=modeNames[mode];$('#map-explainer').textContent=explanations[mode];
 const labels=mode==='balance'?['≤ −12','Дефицит / избыток','≥ +12']:['0',mode==='reserves'?'млрд барр.':'млн барр./сутки',mode==='reserves'?'303+':'25+'];
 const ramp=mode==='balance'?'linear-gradient(90deg,#e68d52,#31494d,#36b38c)':`linear-gradient(90deg,#31494d,${mode==='consumption'?'#e69b65':mode==='reserves'?'#b6c781':'#43bf9d'})`;
 $('#legend').innerHTML=`<div class="legend-ramp" style="background:${ramp}"></div><div class="legend-labels">${labels.map(x=>`<span>${x}</span>`).join('')}</div><span class="legend-none">Нет данных</span>`;
}
function showTip(event, title, copy){
 const el=$('#tooltip'),container=$('#map-container').getBoundingClientRect();
 el.innerHTML=`<strong>${esc(title)}</strong>${esc(copy)}`;el.hidden=false;
 const width=el.offsetWidth;const x=Math.min(container.width-width-8,Math.max(8,event.clientX-container.left+12));const y=Math.min(container.height-el.offsetHeight-8,Math.max(8,event.clientY-container.top-25));
 el.style.left=`${x}px`;el.style.top=`${y}px`;
}
function initMap(world){
 features=topojson.feature(world,world.objects.countries).features.filter(f=>f.properties.name!=='Antarctica');
 projection=d3.geoNaturalEarth1().fitExtent([[20,20],[980,500]],{type:'FeatureCollection',features});path=d3.geoPath(projection);svg=d3.select('#world-map');
 mapGroup=svg.append('g');mapGroup.append('path').datum(d3.geoGraticule10()).attr('d',path).attr('class','graticule');
 countryPaths=mapGroup.append('g').selectAll('path').data(features).join('path').attr('class','country').attr('d',path).attr('data-id',f=>String(+f.id)).attr('data-iso',f=>byId.get(String(+f.id))?.iso??'').attr('aria-label',f=>byId.get(String(+f.id))?.name??f.properties.name).on('click',(e,f)=>{
  const c=byId.get(String(+f.id));if(c)selectCountry(c.iso);else showTip(e,f.properties.name,'Нет данных EIA в выбранном срезе');
 }).on('mousemove',(e,f)=>{const c=byId.get(String(+f.id));showTip(e,c?.name??f.properties.name,c?`${mode==='balance'?signed(c[mode]):fmt(c[mode])} ${mode==='reserves'?'млрд баррелей':'млн барр./сутки'}`:'Нет сопоставимых данных');}).on('mouseleave',()=>$('#tooltip').hidden=true);
 const featureById=new Map(features.map(f=>[String(+f.id),f]));
 const small=data.countries.filter(c=>c.id&&(!featureById.has(String(+c.id))||path.area(featureById.get(String(+c.id)))<4));
 countryDots=mapGroup.append('g').selectAll('circle').data(small).join('circle').attr('class','country-dot').attr('cx',c=>projection(c.coordinates)[0]).attr('cy',c=>projection(c.coordinates)[1]).attr('r',2.7).attr('data-country-dot',c=>c.iso).on('click',(e,c)=>selectCountry(c.iso)).on('mousemove',(e,c)=>showTip(e,c.name,`${mode==='balance'?signed(c[mode]):fmt(c[mode])} ${mode==='reserves'?'млрд баррелей':'млн барр./сутки'}`)).on('mouseleave',()=>$('#tooltip').hidden=true);
 nodeGroup=mapGroup.append('g').attr('class','route-overlay').style('display','none');
 const lines=[[[51,27],[56.5,26.5],[60,22],[69,11],[82,5],[96,6],[101.5,3.5],[105,2],[113,10],[121,23]],[[56.5,26.5],[60,22],[59,15],[49,11],[43.3,12.6],[38,21],[34,27],[32.5,30],[31,32],[25,34],[16,35],[7,37],[-6,36],[-12,44],[-5,51],[3,53]],[[56.5,26.5],[61,20],[61,8],[53,-4],[46,-15],[37,-31],[22,-38],[12,-33],[3,-14],[-11,12],[-19,35],[-10,48],[2,53]]];
 for(const line of lines)nodeGroup.append('path').datum({type:'LineString',coordinates:line}).attr('d',path).attr('class','route-line');
 nodeGroup.append('path').datum({type:'LineString',coordinates:[[-110,53],[-104,46],[-99,38]]}).attr('d',path).attr('class','pipeline-line');
 nodeGroup.selectAll('circle').data(chokes).join('circle').attr('class','choke-marker').attr('cx',c=>projection(c.coords)[0]).attr('cy',c=>projection(c.coords)[1]).attr('r',c=>3+Math.sqrt(c.value)*1.1).on('mousemove',(e,c)=>showTip(e,c.name,`${fmt(c.value,1)} млн барр./сутки · I пол. 2025`)).on('mouseleave',()=>$('#tooltip').hidden=true).on('click',(e,c)=>showTip(e,c.name,`${fmt(c.value,1)} млн барр./сутки · I пол. 2025`));
 nodeGroup.selectAll('text').data(chokes.filter(c=>c.value>8||c.short==='Панама')).join('text').attr('class','choke-label').attr('x',c=>projection(c.coords)[0]+10).attr('y',c=>projection(c.coords)[1]-8).text(c=>c.short);
 zoom=d3.zoom().scaleExtent([1,6]).translateExtent([[0,0],[1000,535]]).extent([[0,0],[1000,535]]).on('zoom',e=>{mapGroup.attr('transform',e.transform);$('#tooltip').hidden=true;});svg.call(zoom).on('dblclick.zoom',null);
 $('#zoom-in').onclick=()=>svg.transition().duration(180).call(zoom.scaleBy,1.5);$('#zoom-out').onclick=()=>svg.transition().duration(180).call(zoom.scaleBy,1/1.5);$('#reset-map').onclick=()=>svg.transition().duration(180).call(zoom.transform,d3.zoomIdentity);
 renderMode();renderRoutes();
}
function renderRoutes(){if(nodeGroup)nodeGroup.style('display',$('#routes-toggle').checked?null:'none');}
function revealRoutes(index){$('#routes-toggle').checked=true;renderRoutes();writeState();$('#atlas').scrollIntoView({behavior:'smooth'});if(index!=null){const p=projection(chokes[index].coords);svg.transition().duration(350).call(zoom.transform,d3.zoomIdentity.translate(500-p[0]*2,267-p[1]*2).scale(2));}else svg.transition().duration(180).call(zoom.transform,d3.zoomIdentity);}
function renderRankings(){
 const valid=data.countries.filter(c=>c.balance!=null);
 for(const [id,positive]of [['surplus-list',true],['deficit-list',false]]){
  const rows=valid.filter(c=>positive?c.balance>0:c.balance<0).sort((a,b)=>positive?b.balance-a.balance:a.balance-b.balance).slice(0,5),max=Math.max(...rows.map(c=>Math.abs(c.balance)),1);
  $('#'+id).innerHTML=rows.map((c,i)=>`<button class="rank-row ${positive?'':'negative-rank'}" data-country="${c.iso}"><span class="rank-number">0${i+1}</span><span>${esc(c.name)}</span><span class="rank-bar"><i style="width:${Math.abs(c.balance)/max*100}%"></i></span><span class="rank-value ${climate(c.balance)}">${signed(c.balance)}</span></button>`).join('');
 }
}
function renderTable(){
 const region=$('#region-filter').value,sort=$('#sort-by').value,filtered=data.countries.filter(c=>region==='all'||c.region===region).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'ru'):(b[sort]??-Infinity)-(a[sort]??-Infinity));
 const rows=allRows?filtered:filtered.slice(0,12);
 $('#country-table').innerHTML=rows.map(c=>`<tr><td><button data-country="${c.iso}">${esc(c.name)}</button></td><td>${fmt(c.production)}</td><td>${fmt(c.consumption)}</td><td class="${climate(c.balance)}">${signed(c.balance)}</td><td>${fmt(c.reserves,1)}${c.iso==='CAN'?' *':''}</td><td>${fmt(c.yearsConsumption,0)}</td></tr>`).join('');
 $('#table-count').textContent=`${rows.length} из ${filtered.length} стран и территорий`;
 $('#show-all').hidden=filtered.length<=12;$('#show-all').textContent=allRows?'Свернуть таблицу ↑':'Показать все страны ↓';
}
function search(){
 const q=$('#country-search').value.trim().toLocaleLowerCase('ru');
 const matches=data.countries.filter(c=>[c.name,c.english,c.iso].some(s=>s.toLocaleLowerCase('ru').includes(q))).slice(0,9);
 $('#search-results').hidden=!q;$('#search-results').innerHTML=matches.length?matches.map(c=>`<button data-country="${c.iso}">${esc(c.name)} <small>${c.iso}</small></button>`).join(''):'<p>Страна не найдена</p>';
}
function exportCsv(){
 const header=['ISO','Страна','Производство (млн барр./сутки, 2025)','Потребление (млн барр./сутки, 2025)','Баланс (млн барр./сутки, 2025)','Добыча сырой нефти и конденсата (млн барр./сутки, 2025)','Запасы сырой нефти (млрд барр., конец 2024)','Запасы / потребление (условных лет)','Запасы / добыча сырой нефти (условных лет)','Примечание'];
 const cell=x=>`"${String(x??'').replace(/"/g,'""')}"`;
 const rows=data.countries.map(c=>[c.iso,c.name,c.production,c.consumption,c.balance,c.crude,c.reserves,c.yearsConsumption,c.yearsProduction,c.reserveNote??'']);
 const blob=new Blob(['\uFEFF'+[header,...rows].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='oil-atlas-2025.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function start(){
 const responses=await Promise.all(['data/snapshot.json','data/world.json','data/trade.json'].map(u=>fetch(u).then(r=>{if(!r.ok)throw Error(`${u}: ${r.status}`);return r.json();})));
 data=responses[0];countries=new Map(data.countries.map(c=>[c.iso,c]));byId=new Map(data.countries.filter(c=>c.id).map(c=>[String(+c.id),c]));
 if(!data.countries.length)throw Error('Нет данных стран');stateFromHash();
 $('#world-production').textContent=fmt(data.world.production,1);$('#world-consumption').textContent=fmt(data.world.consumption,1);$('#world-reserves').textContent=fmt(data.reservesWorld,0);
 const complete=data.countries.filter(c=>c.balance!=null),share=complete.reduce((sum,c)=>sum+c.consumption,0)/data.world.consumption*100;$('#coverage').textContent=`${complete.length} стран с балансом · ${fmt(share,0)}% мирового спроса${data.canary?' · ПРОБНАЯ ВЕРСИЯ':''}`;
 renderCountry();initMap(responses[1]);renderRankings();renderTable();writeState();
 $('#trade-list').innerHTML=responses[2].flows.slice(0,8).map(t=>`<div class="trade-row"><span>${esc(t.fromName)}<span class="arrow">→</span>${esc(t.toName)}</span><b>${fmt(t.value,1)}</b></div>`).join('');
 $('#choke-list').innerHTML=chokes.map((c,i)=>`<div class="choke-row"><span>${c.name}</span><b>${fmt(c.value,1)}</b><button data-choke="${i}" aria-label="Показать ${c.name} на карте">↗</button></div>`).join('');
 $('#source-links').innerHTML=[...data.sources,{name:'Energy Institute · торговля · 2024',url:'https://www.energyinst.org/statistical-review/resources-and-data-downloads'}].map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`).join('');
 document.addEventListener('click',e=>{const button=e.target.closest('[data-country]');if(button)selectCountry(button.dataset.country,!button.closest('#search-results'));const choke=e.target.closest('[data-choke]');if(choke)revealRoutes(Number(choke.dataset.choke));if(!e.target.closest('.search-box')&&!e.target.closest('#search-results'))$('#search-results').hidden=true;});
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;renderMode();writeState();});
 $('#country-search').oninput=search;$('#country-search').onkeydown=e=>{if(e.key==='Escape')$('#search-results').hidden=true;if(e.key==='Enter')$('#search-results button')?.click();};
 document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#country-search').focus();}});
 $('#routes-toggle').onchange=()=>{renderRoutes();writeState();};$('#show-routes').onclick=()=>revealRoutes();$('#region-filter').onchange=()=>{allRows=false;renderTable();};$('#sort-by').onchange=renderTable;$('#show-all').onclick=()=>{allRows=!allRows;renderTable();};$('#download-csv').onclick=exportCsv;
 window.addEventListener('hashchange',()=>{stateFromHash();renderCountry();renderMode();renderRoutes();});
 window.oilAtlas={data,selectCountry,get mode(){return mode;},get selected(){return selected;}};
}
start().catch(e=>{console.error(e);$('#error-message').textContent='Не удалось загрузить атлас. Проверьте подключение и обновите страницу. '+e.message;$('#error-message').hidden=false;$('#coverage').textContent='Данные не загружены';});
