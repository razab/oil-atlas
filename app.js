'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const nf=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}), whole=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
const colors={imports:'#76d6b0',exports:'#efaa70',selected:'#efe5cc',empty:'#263a46'};
const products={crude:'Сырая нефть',gasoline:'Готовый автомобильный бензин',diesel:'Дизель и другие дистилляты',pipeline:'Трубопроводный газ',lng:'Сжиженный природный газ'};
const units={kbpd:'тыс. барр./сутки',Mt:'млн тонн/год',bcm:'млрд м³/год'};
const params=new URLSearchParams(location.hash.slice(1));
const state={country:params.get('country')||'FRA',product:params.get('product')||'crude',direction:params.get('direction')||'imports',mode:params.get('v')==='2'?(params.get('mode')||'trade'):'trade',sites:params.get('sites')==='1',all:params.get('all')==='1'};
if(!products[state.product])state.product='crude';if(!['imports','exports','both'].includes(state.direction))state.direction='imports';if(!['trade','balance','reserves','production','consumption'].includes(state.mode))state.mode='trade';
let data,graph,countries,byCode,byId,features,usStates,svg,projection,path,zoom,layer,transform=d3.zoomIdentity,W,H,currentFlows=[];
const fmt=(v,d=1)=>v==null?'нет данных':d&&v>0&&v<.1?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:Math.min(6,Math.ceil(-Math.log10(v))+1)}).format(v):(d?nf:whole).format(v);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=f=>`${fmt(f.value)} ${units[f.unit]}`;
function selectedBounds(){
 const feature=features.find(f=>byId[String(+f.id)]?.iso===state.country);
 if(!feature){const p=screen(state.country);return [p[0]-12,p[1]-12,p[0]+12,p[1]+12];}
 let geometry=feature;
 if(feature.geometry.type==='MultiPolygon'){
  const parts=feature.geometry.coordinates.map(coordinates=>({type:'Polygon',coordinates}));
  geometry=parts.find(part=>d3.geoContains(part,graph.nodes[state.country].coordinates))||parts.sort((a,b)=>d3.geoArea(b)-d3.geoArea(a))[0];
 }
 const bounds=path.bounds(geometry),a=transform.apply(bounds[0]),b=transform.apply(bounds[1]);
 return [Math.max(0,a[0]-12),Math.max(0,a[1]-12),Math.min(W,b[0]+12),Math.min(H,b[1]+12)];
}
function positionPanel(){
 const card=$('#country-card'),r=selectedBounds(),gap=14,top=74,bottom=H-54;
 card.classList.remove('auto-compact');card.style.visibility='visible';card.style.removeProperty('--panel-height');
 const width=Math.min(280,W-28),height=Math.min(card.scrollHeight,bottom-top);
 const area=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
 const preferred=screen(state.country)[0]<W/2?'right':'left';
 const candidates=[];
 for(const side of [preferred,preferred==='left'?'right':'left']){
  const x=side==='left'?gap:W-gap-width;
  for(const y of [top,Math.max(top,bottom-height)]){
   candidates.push({side,x,y,height,overlap:area([x,y,x+width,y+height],r)});
  }
  for(const [y,h] of [[top,Math.min(height,r[1]-top-8)],[Math.max(top,r[3]+8),Math.min(height,bottom-r[3]-8)]]){
   if(h>=90)candidates.push({side,x,y,height:h,overlap:area([x,y,x+width,y+h],r)});
  }
 }
 candidates.sort((a,b)=>a.overlap-b.overlap||b.height-a.height);
 let best=candidates[0];
 if(best.overlap>0){
  const compact=[];
  for(const side of [preferred,preferred==='left'?'right':'left']){
   const x=side==='left'?gap:W-gap-width;
   for(const y of [top,bottom-64])compact.push({side,x,y,height:64,overlap:area([x,y,x+width,y+64],r)});
  }
  compact.sort((a,b)=>a.overlap-b.overlap);best=compact[0];card.classList.add('auto-compact');
  if(best.overlap>0)card.style.visibility='hidden';
 }
 $('#country-info').hidden=card.style.visibility!=='hidden';
 card.dataset.side=best.side;card.style.left=best.x+'px';card.style.right='auto';card.style.top=best.y+'px';card.style.bottom='auto';
 card.style.setProperty('--panel-height',best.height+'px');
}
function placeLabel(xy,width,height,placed){
 const left=8,top=64,bottom=H-45,card=$('#country-card').getBoundingClientRect();
 const blockers=$('#country-card').style.visibility==='hidden'?[]:[{x:card.x,y:card.y,w:card.width,h:card.height}];
 const candidates=[];
 for(let row=0;row<18;row++)for(const sign of row?[1,-1]:[1])for(const side of [1,-1]){
  const x=Math.max(left,Math.min(W-width-12,xy[0]+(side===1?12:-width-12)));
  const y=Math.max(top,Math.min(bottom-height,xy[1]-height/2+row*(height+7)*sign));
  candidates.push({x,y,w:width,h:height,cost:Math.hypot(x+(side===1?0:width)-xy[0],y+height/2-xy[1])});
 }
 candidates.sort((a,b)=>a.cost-b.cost);
 return candidates.find(a=>![...placed,...blockers].some(b=>a.x<b.x+b.w+5&&a.x+a.w>b.x-5&&a.y<b.y+b.h+5&&a.y+a.h>b.y-5))||candidates[0];
}
function save(){const p=new URLSearchParams({v:'2',country:state.country,product:state.product,mode:state.mode,direction:state.direction,sites:state.sites?'1':'0',all:state.all?'1':'0'});history.replaceState(null,'','#'+p);}
function selectedFlows(){
 const related=graph.flows.filter(f=>f.product===state.product&&(f.origin===state.country||f.destination===state.country));
 const unique=new Map();related.sort((a,b)=>(a.owner===state.country?-1:0)-(b.owner===state.country?-1:0));
 for(const f of related){const key=f.origin+':'+f.destination;if(!unique.has(key))unique.set(key,f);}
 return [...unique.values()].filter(f=>state.direction==='both'||(state.direction==='imports'?f.destination===state.country:f.origin===state.country)).sort((a,b)=>b.value-a.value);
}
function choose(code){if(!graph.nodes[code]||graph.nodes[code].kind!=='country')return;state.country=code;state.sites=false;state.all=false;$('#detail-popup').hidden=true;$('#search-results').hidden=true;$('#country-search').value='';$('.search').hidden=true;$('#search-toggle').setAttribute('aria-expanded','false');svg.call(zoom.transform,d3.zoomIdentity);render();}
function showPopup(html){$('#popup-content').innerHTML=html;$('#detail-popup').hidden=false;}
function showState(s){
 const v=graph.states[s.properties.name];
 showPopup(`<p class="eyebrow">ШТАТ / США · 2025</p><h2>${esc(s.properties.name)}</h2><p class="big-number">${fmt(v?.crude)}</p><p>тыс. барр./сутки · добыча сырой нефти с конденсатом${v?'':' · нет отдельного значения'}</p><p>Потребление штата пока не загружено. Бассейны могут пересекать границы нескольких штатов; их объёмы нельзя складывать с объёмами штатов.</p><a href="https://www.eia.gov/dnav/pet/pet_crd_crpdn_adc_mbbl_a.htm" target="_blank" rel="noopener">EIA · добыча по штатам ↗</a>`);
}
function showEdge(f){
 const src=graph.sources[f.source],a=graph.nodes[f.origin],b=graph.nodes[f.destination];
 const transport={pipeline:'По трубопроводам. Межстрановая связь; точная трасса здесь не восстановлена.',lng:'СПГ перевозят морскими газовозами, затем регазифицируют. Связь не привязана к конкретному терминалу или рейсу.',crude:'Перевозка танкерами и/или по трубопроводам. Этот набор торговли не разделяет объём по способам перевозки.',gasoline:'Готовое топливо после переработки: танкеры и/или другие виды транспорта. Вид транспорта не разделён в исходной таблице.',diesel:'Дистиллятное топливо после переработки, включая дизель и отопительное топливо. Вид транспорта не разделён в исходной таблице.'};
 showPopup(`<p class="eyebrow">${esc(products[f.product])} · ${f.year}</p><h2>${esc(a.name)} → ${esc(b.name)}</h2><p class="big-number">${fmt(f.value)}</p><p>${units[f.unit]}${f.unit==='kbpd'?' · среднее за год':''}</p><p>${transport[f.product]}</p>${f.note?`<p>${esc(f.note)}</p>`:''}${a.kind==='region'||b.kind==='region'?'<p>Это региональная группа. Объём не распределён по входящим в неё странам.</p>':''}<a href="${src.url}" target="_blank" rel="noopener">${esc(src.label)} ↗</a><button class="jump" data-jump="${f.origin===state.country?f.destination:f.origin}">Перейти к ${esc(f.origin===state.country?b.name:a.name)} ↗</button>`);
 $('.jump').onclick=()=>choose($('.jump').dataset.jump);
}
function countryCard(){
 const c=byCode[state.country],node=graph.nodes[state.country];if(!node)return;
 const gas=state.mode==='trade'&&(state.product==='pipeline'||state.product==='lng');const g=graph.gas[state.country]||{};
 const domestic=state.mode==='trade'?graph.domestic?.[state.country]?.[state.product]:null;
 const production=domestic?domestic.production:gas?g.production:c?.production,consumption=domestic?domestic.consumption:gas?g.consumption:c?.consumption;
 const factor=gas||domestic?1:1000,unit=gas?'млрд м³/год':'тыс. барр./сутки',bal=production!=null&&consumption!=null?production-consumption:null;
 let note=gas?'Внутренние производство и спрос на весь природный газ · 2025. СПГ — форма перевозки этого газа.':'Внутренние производство и спрос на все нефтяные жидкости · 2025. Производство включает NGL; это не только сырая нефть.';
 if(domestic)note=domestic.note;
 let explain='';
 if(state.country==='USA'&&!gas)explain=`США добывают лёгкую нефть и импортируют более тяжёлые сорта для своих НПЗ. Из них также делают бензин и дизель для экспорта. <a href="https://www.eia.gov/todayinenergy/detail.php?id=42936" target="_blank" rel="noopener">Почему импортируют ↗</a>`;
 if(state.country==='USA'&&gas)explain='Канада → США — импорт трубопроводного газа. США → Мексика — экспорт. СПГ — отдельный морской поток: переключатель сверху.';
 if(state.country==='FRA'&&state.product==='crude')explain='Поставщики на карте — страны добычи сырья по INSEE/SDES. Это сырьё для НПЗ; внутренний спрос включает уже готовые нефтепродукты.';
 const reserve=c?.reserves!=null?`<div class="reserves">Доказанные запасы · 2024<br><strong>${fmt(c.reserves)} млрд баррелей</strong>${c.yearsConsumption!=null?` · ${fmt(c.yearsConsumption)} условных лет при спросе 2025`:''}${c.reserveNote?`<br>${esc(c.reserveNote)}`:''}</div>`:'';
 $('#country-details').innerHTML=`<p class="eyebrow">${state.country} / ${state.mode==='trade'?products[state.product]:'Нефтяные жидкости'}</p><h1 class="country-name">${esc(node.name)}</h1><div class="stats"><div><span class="stat-label">${domestic?domestic.productionLabel:gas?'Производство газа внутри страны':'Производство нефти и NGL'}</span><strong class="stat-value" data-stat="production">${fmt(production==null?null:production*factor,gas?1:0)}</strong><span class="stat-unit">${unit}</span></div><div><span class="stat-label">${domestic?domestic.consumptionLabel:gas?'Потребление газа внутри страны':'Спрос на нефтяные жидкости'}</span><strong class="stat-value" data-stat="consumption">${fmt(consumption==null?null:consumption*factor,gas?1:0)}</strong><span class="stat-unit">${unit}</span></div><div class="stat-balance"><span class="stat-label">${bal==null?'Баланс неизвестен':domestic&&state.product==='crude'?(bal<0?'НПЗ перерабатывают сверх добычи':'Добыча выше переработки'):bal>=0?'Производство выше спроса':'Спрос выше производства'}</span><strong class="${bal>=0?'incoming':'outgoing'}" data-stat="balance">${bal==null?'—':fmt(Math.abs(bal)*factor,gas?1:0)}</strong></div></div><p class="context-note">${note} Разница не равна фактическому экспорту.</p>${explain?`<p class="explanation">${explain}</p>`:''}${state.mode==='reserves'?reserve:''}`;
 const all=selectedFlows();currentFlows=state.all?all:all.slice(0,9);
 const incoming=all.filter(f=>f.destination===state.country),outgoing=all.filter(f=>f.origin===state.country);
 let coverage=`${all.length} ${all.length===1?'связь':'связей'} в наборе · ${[...new Set(all.map(f=>f.year))].join(' / ')||'нет годовых связей'}. `;
 if(state.country==='FRA'&&state.product==='crude')coverage+=(graph.canary?'Проверка показывает 5 из 7 поставщиков. Полный источник: ':'')+'7 поставщиков покрывают 36,5 из 45,9 млн тонн импорта (79,5%). Остальные не распределены по странам в этой таблице.';
 else if(state.country==='USA'&&['crude','gasoline','diesel'].includes(state.product)){
   coverage+=`Полный импорт ${fmt(graph.totals[`USA:${state.product}:imports`])}; экспорт ${fmt(graph.totals[`USA:${state.product}:exports`])} тыс. барр./сутки · EIA 2025.`;
 }else if(!all.length)coverage+='Нет национальной торговой таблицы для этой страны и топлива. Это не означает отсутствия поставок.';
 else coverage+='Показаны опубликованные связи; региональные группы подписаны отдельно. Этот набор может не покрывать всю торговлю страны.';
 if(graph.canary)coverage+=' Проверочный срез: связи США и Франции.';
 $('#coverage-note').textContent=coverage;
 $('#all-flows').textContent=state.all?'Показать 9 крупнейших':`Все связи на карте (${all.length})`;
 $('#all-flows').disabled=all.length<=9;
 $('#country-controls').style.display=state.mode==='trade'?'':'none';
 const hasSites=graph.sites.some(s=>s.country===state.country);
 $('#sites-button').hidden=!hasSites;$('#sites-button').classList.toggle('active',state.sites);
 $('#sites-button').textContent=state.sites?'← Вернуться к мировым связям':state.country==='USA'?'Где именно? Добыча и СПГ ↗':'Где именно? СПГ и газопровод ↗';
 $('#map-caption').innerHTML=`<strong>${state.sites?'Внутри страны':(state.mode==='trade'?products[state.product]:({balance:'Избыток и дефицит',production:'Производство',consumption:'Спрос',reserves:'Запасы'}[state.mode]))+' · '+node.name}</strong>${state.sites?'Нажмите на район добычи или терминал.':state.direction==='imports'?'Откуда поступает → сюда':state.direction==='exports'?'Отсюда → кто покупает':'Поставщики и покупатели'}${!state.sites&&state.mode==='trade'?`<br>${incoming.length} поставщиков · ${outgoing.length} покупателей в выбранном направлении`:''}`;
}
function metricColor(c){
 if(!c||c[state.mode]==null)return colors.empty;
 if(state.mode==='balance')return d3.scaleDivergingSymlog(d3.interpolateRgbBasis(['#d79566','#2f4550','#78d6b0'])).domain([-15,0,15])(c.balance);
 const max={production:22,consumption:20,reserves:310}[state.mode];return d3.scaleSequentialSqrt(d3.interpolateRgb('#263d49','#8bd9bf')).domain([0,max])(c[state.mode]);
}
function paintCountries(){
 const partners=new Map();for(const f of currentFlows){const code=f.origin===state.country?f.destination:f.origin;partners.set(code,f.destination===state.country?'imports':'exports');}
 layer.selectAll('.country').attr('fill',f=>{const code=byId[String(+f.id)]?.iso;return state.mode!=='trade'?metricColor(byCode[code]):code===state.country?colors.selected:!state.sites&&partners.has(code)?d3.color(colors[partners.get(code)]).darker(1.6):colors.empty;}).classed('selected',f=>byId[String(+f.id)]?.iso===state.country);
}
function point(code){return projection(graph.nodes[code]?.coordinates||[0,0]);}
function screen(code){return transform.apply(point(code));}
function curve(f){
 const a=point(f.origin),b=point(f.destination),dx=b[0]-a[0],dy=b[1]-a[1],dist=Math.hypot(dx,dy)||1;
 const bend=Math.min(90,dist*.2)*(f.origin<f.destination?1:-1),mx=(a[0]+b[0])/2-dy/dist*bend,my=(a[1]+b[1])/2+dx/dist*bend;
 return `M${a}Q${mx},${my} ${b}`;
}
function mapOverlays(){
 positionPanel();
 svg.selectAll('.screen-layer').remove();const overlay=svg.append('g').attr('class','screen-layer');
 layer.select('.flow-layer').remove();const edges=layer.append('g').attr('class','flow-layer');
 if(state.mode==='trade'&&!state.sites){
  for(const f of currentFlows){const direction=f.destination===state.country?'imports':'exports';
   edges.append('path').datum(f).attr('class','edge-hit').attr('d',curve(f)).attr('data-origin',f.origin).attr('data-destination',f.destination).attr('data-flow',f.id).on('click',(e,x)=>{e.stopPropagation();showEdge(x);});
   edges.append('path').attr('class','edge').attr('d',curve(f)).attr('stroke',colors[direction]).attr('stroke-width',1.3+2.7*Math.sqrt(f.value/Math.max(...currentFlows.filter(x=>x.unit===f.unit).map(x=>x.value)))).attr('marker-end',`url(#arrow-${direction})`);
  }
  const grouped=d3.group(currentFlows,f=>f.origin===state.country?f.destination:f.origin),labels=[];
  for(const [code,fs] of grouped){const xy=screen(code),f=fs[0],dir=f.destination===state.country?'imports':'exports';
   overlay.append('circle').attr('class','map-dot').attr('cx',xy[0]).attr('cy',xy[1]).attr('r',4).attr('fill',colors[dir]);
   if(xy[0]<-20||xy[0]>W+20||xy[1]<-20||xy[1]>H+20)continue;
   const name=graph.nodes[code].name,lines=fs.map(x=>`${x.destination===state.country?'→':'←'} ${amount(x)} · ${x.year}`),width=Math.min(225,Math.max(name.length*6.2,...lines.map(l=>l.length*5.4))+18),height=21+lines.length*15;
   const position=placeLabel(xy,width,height,labels),{x,y}=position;labels.push(position);
   overlay.append('line').attr('class','label-link').attr('x1',xy[0]).attr('y1',xy[1]).attr('x2',x+width/2).attr('y2',y+height/2);
   const g=overlay.append('g').attr('class','partner-label').attr('data-partner',code).attr('role','button').attr('tabindex',0).attr('aria-label',`${name}: ${lines.join('; ')}`).attr('transform',`translate(${x},${y})`).on('click',()=>showEdge(f)).on('keydown',e=>{if(e.key==='Enter')showEdge(f);});
   g.append('rect').attr('width',width).attr('height',height).attr('rx',6);g.append('text').attr('x',9).attr('y',15).text(name);
   lines.forEach((l,i)=>g.append('text').attr('class','amount').attr('x',9).attr('y',30+15*i).style('fill',colors[fs[i].destination===state.country?'imports':'exports']).text(l));
  }
  const xy=screen(state.country);overlay.append('circle').attr('cx',xy[0]).attr('cy',xy[1]).attr('r',7).attr('fill',colors.selected).attr('stroke','#0c1820').attr('stroke-width',2);
 }
 layer.select('.state-layer').remove();
 if(state.mode!=='trade'){
  const rows=data.countries.filter(c=>c[state.mode]!=null).sort((a,b)=>Math.abs(b[state.mode])-Math.abs(a[state.mode])).slice(0,8);
  const selected=byCode[state.country];if(selected&&selected[state.mode]!=null&&!rows.includes(selected))rows.push(selected);
  const placed=[];
  for(const c of rows){
   const xy=screen(c.iso),v=c[state.mode],value=state.mode==='reserves'?`${fmt(v)} млрд барр. · 2024`:`${state.mode==='balance'?(v>=0?'+':'−'):''}${fmt(Math.abs(v)*1000,0)} тыс. барр./сутки`;
   const width=Math.max(c.name.length*6,value.length*5.4)+18,height=40,position=placeLabel(xy,width,height,placed);placed.push(position);
   overlay.append('line').attr('class','label-link').attr('x1',xy[0]).attr('y1',xy[1]).attr('x2',position.x).attr('y2',position.y+20);
   const g=overlay.append('g').attr('class','partner-label metric-label').attr('data-metric',c.iso).attr('transform',`translate(${position.x},${position.y})`).attr('role','button').attr('tabindex',0).on('click',()=>choose(c.iso)).on('keydown',e=>{if(e.key==='Enter')choose(c.iso);});
   g.append('rect').attr('width',width).attr('height',height).attr('rx',6);g.append('text').attr('x',9).attr('y',15).text(c.name);g.append('text').attr('class','amount').attr('x',9).attr('y',31).style('fill',state.mode==='balance'&&v<0?colors.exports:colors.imports).text(value);
  }
 }
 if(state.sites){
   if(state.country==='USA'){
    const sl=layer.append('g').attr('class','state-layer');sl.selectAll('path').data(usStates).join('path').attr('class','state').attr('data-state',s=>s.properties.name).attr('role','button').attr('tabindex',0).attr('aria-label',s=>s.properties.name).attr('d',path).style('fill',s=>graph.states[s.properties.name]?.crude!=null?d3.scaleSequentialSqrt(d3.interpolateRgb('#193340','#75b59e')).domain([0,5800])(graph.states[s.properties.name].crude):'#193340').on('click',(e,s)=>{e.stopPropagation();showState(s);}).on('keydown',(e,s)=>{if(e.key==='Enter')showState(s);});
   }
   const siteLabels=[];
   for(const s of graph.sites.filter(s=>s.country===state.country)){
    const xy=transform.apply(projection(s.coordinates));const g=overlay.append('g').attr('class',`site ${s.kind}`).attr('data-site',s.id).attr('transform',`translate(${xy})`).attr('role','button').attr('tabindex',0).attr('aria-label',s.name);
    const click=()=>showPopup(`<p class="eyebrow">${s.kind==='basin'?'ДОБЫЧА СЫРОЙ НЕФТИ':s.kind==='terminal'?'ТЕРМИНАЛ СПГ':'ГАЗОПРОВОД'} · ${s.year}</p><h2>${esc(s.name)}</h2><p>${esc(s.detail)}</p><a href="${s.url}" target="_blank" rel="noopener">Источник ↗</a>`);
    g.on('click',click).on('keydown',e=>{if(e.key==='Enter')click();});g.append('circle').attr('r',s.kind==='basin'?8:5);
    const width=s.name.length*5.8+16,height=26,position=placeLabel(xy,width,height,siteLabels),lx=position.x,ly=position.y;siteLabels.push(position);
    g.append('line').attr('class','label-link').attr('x1',0).attr('y1',0).attr('x2',lx-xy[0]).attr('y2',ly+height/2-xy[1]);
    g.append('rect').attr('x',lx-xy[0]).attr('y',ly-xy[1]).attr('width',width).attr('height',height).attr('rx',5).attr('fill','#10232cf2').attr('stroke','#537582').attr('stroke-width',.7);
    g.append('text').attr('x',lx+8-xy[0]).attr('y',ly+17-xy[1]).text(s.name);
   }
   for(const infra of graph.infrastructure.filter(i=>i.country===state.country)){
     edges.append('path').attr('d',path({type:'LineString',coordinates:infra.coordinates})).attr('class','edge').attr('stroke',colors.imports).attr('stroke-width',3).attr('stroke-dasharray','6 4');
   }
 }
}
function render(){
 save();countryCard();paintCountries();mapOverlays();$('#edition').textContent=graph.canary?'2025 · проверочный срез':'2025';$('#current-fuel').textContent=({crude:'Нефть',gasoline:'Бензин',diesel:'Дизель',pipeline:'Газ',lng:'СПГ'}[state.product]);
 $$('[data-product]').forEach(b=>{const active=b.dataset.product===state.product;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
 $$('[data-direction]').forEach(b=>{const active=b.dataset.direction===state.direction;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});$('#map-mode').value=state.mode;
 $('#legend').innerHTML=state.sites?'<span><i style="background:#efc278"></i>Район добычи</span><span><i style="background:#8ec9ed"></i>Терминал СПГ</span>':state.mode==='trade'?`<span><i style="background:${colors.imports}"></i>Поставщики → сюда</span><span><i style="background:${colors.exports}"></i>Отсюда → покупатели</span>`:state.mode==='balance'?'<span>Дефицит</span><span class="legend-bar"></span><span>Избыток</span>':`<span>${{production:'Производство',consumption:'Спрос',reserves:'Запасы'}[state.mode]}</span><span class="legend-bar"></span><span>Больше</span>`;
 $('#route-note').textContent=state.sites?'Положение объектов приблизительное. Нажмите на точку.':'Линии — торговые связи, не путь судна. Нажмите на линию или подпись.';
 window.oilAtlas={data,graph,state,visibleFlows:currentFlows,selectCountry:choose,getSelectedBounds:selectedBounds,getView:()=>({x:transform.x,y:transform.y,k:transform.k,translate:projection.translate(),scale:projection.scale()})};
}
function initMap(){
 W=innerWidth;H=innerHeight;svg=d3.select('#world-map').attr('viewBox',`0 0 ${W} ${H}`);svg.selectAll('*').remove();
 projection=d3.geoNaturalEarth1().scale(Math.min((W-32)/6.25,(H-32)/3.1)).translate([W/2,H/2]);path=d3.geoPath(projection);
 const defs=svg.append('defs');for(const dir of ['imports','exports'])defs.append('marker').attr('id','arrow-'+dir).attr('viewBox','0 0 10 10').attr('refX',9).attr('refY',5).attr('markerWidth',4).attr('markerHeight',4).attr('orient','auto').append('path').attr('d','M0,0L10,5L0,10Z').attr('fill',colors[dir]);
 layer=svg.append('g').attr('class','geo-layer');layer.append('path').datum(d3.geoGraticule10()).attr('class','graticule').attr('d',path);
 layer.append('g').selectAll('path').data(features).join('path').attr('class','country').attr('data-iso',f=>byId[String(+f.id)]?.iso||'').attr('d',path).on('click',(e,f)=>{const c=byId[String(+f.id)];if(c){e.stopPropagation();choose(c.iso);}}).append('title').text(f=>byId[String(+f.id)]?.name||f.properties?.name||'');
 zoom=d3.zoom().scaleExtent([1,18]).on('zoom',e=>{transform=e.transform;layer.attr('transform',transform);if(graph)mapOverlays();});svg.call(zoom);transform=d3.zoomIdentity;render();if(state.sites)focusSites();
}
function focusSites(){
 const xy=projection(state.country==='USA'?[-97,37]:[3,51]);const k=state.country==='USA'?3.8:5.7;const cx=W*.5,cy=H*.5;svg.call(zoom.transform,d3.zoomIdentity.translate(cx-k*xy[0],cy-k*xy[1]).scale(k));
}
async function main(){
 [data,graph,countries,usStates]=await Promise.all(['data/snapshot.json','data/connections.json?v=2-full-1','data/world.json','data/us-states.json'].map(async u=>{const r=await fetch(u);if(!r.ok)throw Error('Не удалось загрузить '+u);return r.json();}));
 byCode=Object.fromEntries(data.countries.map(c=>[c.iso,c]));byId=Object.fromEntries(data.countries.filter(c=>c.id).map(c=>[String(+c.id),c]));
 features=topojson.feature(countries,countries.objects.countries).features.filter(f=>String(f.id)!=='010');usStates=topojson.feature(usStates,usStates.objects.states).features;
 if(graph.nodes[state.country]?.kind!=='country')state.country='FRA';
 $('#about-content').innerHTML=`<p><strong>Внутренние производство и спрос:</strong> Energy Institute 2026, год 2025. Нефтяные жидкости: нефть, конденсат и NGL. Для небольших производителей — EIA 2025. Спрос на нефтяные жидкости не равен объёму переработки сырой нефти.</p><p><strong>Торговля США:</strong> национальные таблицы EIA 2025. Годовые тысячи баррелей делятся на 365 для среднего суточного объёма. Бензин — finished motor gasoline; дистилляты включают дизель и отопительное топливо.</p><p><strong>Импорт Франции:</strong> INSEE/SDES, предварительные данные 2025, млн тонн/год. Страна происхождения — страна добычи, поэтому серия может отличаться от EIA, учитывающей экспорт из США. Показаны семь поставщиков, 79,5% полного импорта. Непоказанный остаток не распределён.</p><p><strong>Газ:</strong> матрицы трубопроводной торговли и СПГ Energy Institute 2026 за 2025. Они содержат страны и сводные группы. Для Франции в трубопроводной матрице есть только ЕС; его объём не присвоен Франции. Вместо этого отдельно показан существующий газопровод Franpipe.</p><p><strong>Другие связи сырой нефти:</strong> матрица EI 2025 за 2024. Она не содержит полного разбиения всех стран. Бензин и дистилляты вне торговли с США пока не покрыты.</p><p><strong>Запасы:</strong> OPEC ASB 2025, состояние на конец 2024. Границы стран: Natural Earth; штаты США: Census 2017 / us-atlas.</p>${Object.values(graph.sources).map(s=>`<p><a href="${s.url}" target="_blank" rel="noopener">${esc(s.label)} ↗</a></p>`).join('')}`;
 initMap();
 $('#search-toggle').onclick=()=>{const open=$('.search').hidden;$('.search').hidden=!open;$('#search-toggle').setAttribute('aria-expanded',open);$('#map-settings').hidden=true;$('#filters-toggle').setAttribute('aria-expanded','false');if(open)$('#country-search').focus();};
 $('#filters-toggle').onclick=()=>{const open=$('#map-settings').hidden;$('#map-settings').hidden=!open;$('#filters-toggle').setAttribute('aria-expanded',open);$('.search').hidden=true;$('#search-toggle').setAttribute('aria-expanded','false');};
 $('#country-info').onclick=()=>showPopup($('#country-details').innerHTML);
 $$('[data-product]').forEach(b=>b.onclick=()=>{state.product=b.dataset.product;state.mode='trade';state.all=false;state.sites=false;$('#detail-popup').hidden=true;svg.call(zoom.transform,d3.zoomIdentity);render();});
 $$('[data-direction]').forEach(b=>b.onclick=()=>{state.direction=b.dataset.direction;render();});
 $('#all-flows').onclick=()=>{state.all=!state.all;render();};
 $('#map-mode').onchange=e=>{state.mode=e.target.value;state.sites=false;svg.call(zoom.transform,d3.zoomIdentity);render();};
 $('#sites-button').onclick=()=>{state.sites=!state.sites;render();if(state.sites)focusSites();else svg.call(zoom.transform,d3.zoomIdentity);};
 $('#reset-map').onclick=()=>svg.call(zoom.transform,d3.zoomIdentity);$('#zoom-in').onclick=()=>svg.call(zoom.scaleBy,1.4);$('#zoom-out').onclick=()=>svg.call(zoom.scaleBy,1/1.4);
 $('#world-button').onclick=()=>{state.sites=false;svg.call(zoom.transform,d3.zoomIdentity);render();};
 $('#collapse-card').onclick=()=>{$('#country-card').classList.toggle('collapsed');positionPanel();mapOverlays();$('#collapse-card').textContent=$('#country-card').classList.contains('collapsed')?'+':'−';};
 $('#close-popup').onclick=()=>$('#detail-popup').hidden=true;
 $('#about-button').onclick=()=>$('#about').showModal();$('#close-about').onclick=()=>$('#about').close();
 $('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.();
 $('#country-search').oninput=e=>{const term=e.target.value.trim().toLowerCase();const found=Object.values(graph.nodes).filter(c=>c.kind==='country'&&(c.name.toLowerCase().includes(term)||c.code.toLowerCase().includes(term)||metadataName(c.code).includes(term))).slice(0,9);$('#search-results').hidden=!term;$('#search-results').innerHTML=found.length?found.map(c=>`<button data-country="${c.code}">${esc(c.name)}</button>`).join(''):'<p>Страна не найдена</p>';$$('#search-results button').forEach(b=>b.onclick=()=>choose(b.dataset.country));};
 $('#country-search').onkeydown=e=>{if(e.key==='Escape')$('#search-results').hidden=true;if(e.key==='Enter')$('#search-results button')?.click();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#detail-popup').hidden=true;$('#search-results').hidden=true;$('.search').hidden=true;$('#map-settings').hidden=true;$('#search-toggle').setAttribute('aria-expanded','false');$('#filters-toggle').setAttribute('aria-expanded','false');}if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();$('.search').hidden=false;$('#search-toggle').setAttribute('aria-expanded','true');$('#country-search').focus();}});
 let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(initMap,150);});
}
function metadataName(code){return (byCode[code]?.english||'').toLowerCase();}
main().catch(e=>{$('#error-message').hidden=false;$('#error-message').textContent='Карта не загрузилась: '+e.message;console.error(e);});
