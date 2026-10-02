'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const nf=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}), whole=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
const colors={imports:'#76d6b0',exports:'#efaa70',selected:'#efe5cc',empty:'#263a46'};
const products={crude:'Сырая нефть',gasoline:'Готовый автомобильный бензин',diesel:'Дизель и другие дистилляты',pipeline:'Трубопроводный газ',lng:'Сжиженный природный газ'};
const units={kbpd:'тыс. барр./сутки',Mt:'млн тонн/год',bcm:'млрд м³/год'};
const params=new URLSearchParams(location.hash.slice(1));
const state={country:params.get('country')||'FRA',product:params.get('product')||'crude',direction:params.get('direction')||'both',mode:params.get('v')==='2'?(params.get('mode')||'trade'):'trade',sites:params.get('sites')==='1',all:params.get('all')==='1',partner:params.get('partner')||null};
if(!products[state.product])state.product='crude';if(!['imports','exports','both'].includes(state.direction))state.direction='both';if(!['trade','balance','reserves','production','consumption'].includes(state.mode))state.mode='trade';
let release,byObservation={},data,graph,countries,byCode,byId,features,usStates,svg,projection,path,zoom,layer,transform=d3.zoomIdentity,W,H,currentFlows=[],selectedLocation=null;
const fmt=(v,d=1)=>v==null?'нет данных':d&&v>0&&v<.1?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:Math.min(6,Math.ceil(-Math.log10(v))+1)}).format(v):(d?nf:whole).format(v);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const productTags={crude:'Нефть',gasoline:'Бензин',diesel:'Дистилляты',pipeline:'Газ · труба',lng:'СПГ'};
function displayQuantity(f){
 if(f.unit==='bcm'&&f.value<1)return {value:f.value*1000,unit:'млн м³/год'};
 if(f.unit==='Mt'&&f.value<.01)return {value:f.value*1e6,unit:'тонн/год'};
 if(f.unit==='kbpd'&&f.value<1)return {value:f.value*1000,unit:'барр./сутки'};
 return {value:f.value,unit:units[f.unit]};
}
const amount=f=>{const q=displayQuantity(f);return `${fmt(q.value)} ${q.unit}`;};
const nodeName=code=>graph.nodes[code].name;
const flowRoute=f=>`${graph.nodes[f.origin].name} → ${graph.nodes[f.destination].name}`;
const flowDirection=f=>f.destination===state.country?'imports':'exports';
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
 const card=$('#country-card'),gap=14,top=74,bottom=H-54,blockers=[selectedBounds()];
 for(const selector of ['#map-settings','.search','#search-results','#detail-popup','.zoom-controls']){
  const el=$(selector);if(!el.hidden&&el.getClientRects().length){const b=el.getBoundingClientRect();blockers.push([b.left,b.top,b.right,b.bottom]);}
 }
 card.classList.remove('auto-compact');card.style.visibility='visible';card.style.removeProperty('--panel-height');
 const width=Math.min(280,W-28),height=Math.min(card.scrollHeight,bottom-top);
 const preferred=screen(state.country)[0]<W/2?'right':'left',spaces=[];
 for(const side of [preferred,preferred==='left'?'right':'left']){
  const x=side==='left'?gap:W-gap-width;let free=[[top,bottom]];
  for(const b of blockers){
   if(b[2]<=x||b[0]>=x+width)continue;
   free=free.flatMap(([a,z])=>b[3]+8<=a||b[1]-8>=z?[[a,z]]:[[a,Math.min(z,b[1]-8)],[Math.max(a,b[3]+8),z]].filter(([lo,hi])=>hi>lo));
  }
  for(const [a,z] of free)spaces.push({side,x,y:a,height:Math.min(height,z-a),room:z-a});
 }
 const candidates=spaces.filter(s=>s.room>=Math.min(90,height));
 candidates.sort((a,b)=>b.height-a.height);
 let best=candidates[0];
 if(!best){
  best=spaces.find(s=>s.room>=64);card.classList.add('auto-compact');
  if(best)best={...best,height:64};
  else {best={side:preferred,x:preferred==='left'?gap:W-gap-width,y:top,height:64};card.style.visibility='hidden';}
 }
 $('#country-info').hidden=card.style.visibility!=='hidden';
 card.dataset.side=best.side;card.style.left=best.x+'px';card.style.right='auto';card.style.top=best.y+'px';card.style.bottom='auto';
 card.style.setProperty('--panel-height',best.height+'px');
}
function closeMapMenus(){
 $('.search').hidden=true;$('#search-results').hidden=true;$('#map-settings').hidden=true;
 $('#search-toggle').setAttribute('aria-expanded','false');$('#filters-toggle').setAttribute('aria-expanded','false');
}
function mapObstacles(){
 return ['#country-card','#map-settings','.search','#search-results','#detail-popup','.zoom-controls','.compact-toolbar'].flatMap(selector=>{
  const el=$(selector);if(el.hidden||!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')return [];
  const b=el.getBoundingClientRect();return [{x:b.x,y:b.y,w:b.width,h:b.height}];
 });
}
function placeLabel(xy,width,height,placed){
 const left=8,top=64,bottom=H-45,blockers=mapObstacles();
 const candidates=[];
 for(let row=0;row<18;row++)for(const sign of row?[1,-1]:[1])for(const side of [1,-1]){
  const x=Math.max(left,Math.min(W-width-12,xy[0]+(side===1?12:-width-12)));
  const y=Math.max(top,Math.min(bottom-height,xy[1]-height/2+row*(height+7)*sign));
  candidates.push({x,y,w:width,h:height,cost:Math.hypot(x+(side===1?0:width)-xy[0],y+height/2-xy[1])});
 }
 candidates.sort((a,b)=>a.cost-b.cost);
 return candidates.find(a=>![...placed,...blockers].some(b=>a.x<b.x+b.w+5&&a.x+a.w>b.x-5&&a.y<b.y+b.h+5&&a.y+a.h>b.y-5))||candidates[0];
}
function save(){const p=new URLSearchParams({v:'2',country:state.country,product:state.product,mode:state.mode,direction:state.direction,sites:state.sites?'1':'0',all:state.all?'1':'0'});if(state.partner)p.set('partner',state.partner);history.replaceState(null,'','#'+p);}
function selectedFlows(direction=state.direction){
 const related=graph.flows.filter(f=>f.product===state.product&&(f.origin===state.country||f.destination===state.country));
 const unique=new Map();related.sort((a,b)=>(a.owner===state.country?-1:0)-(b.owner===state.country?-1:0));
 for(const f of related){const key=f.origin+':'+f.destination;if(!unique.has(key))unique.set(key,f);}
 return [...unique.values()].filter(f=>direction==='both'||(direction==='imports'?f.destination===state.country:f.origin===state.country)).sort((a,b)=>b.year-a.year||a.unit.localeCompare(b.unit)||b.value-a.value);
}
function visibleSelection(all){
 if(state.all)return all;
 const shown=new Set(all.slice(0,9).map(f=>f.id));
 // Keep both directions represented, and retain the bilateral context on a country jump.
 if(state.direction==='both')for(const direction of ['imports','exports']){const f=all.find(f=>flowDirection(f)===direction);if(f)shown.add(f.id);}
 if(state.partner)for(const f of all)if(f.origin===state.partner||f.destination===state.partner)shown.add(f.id);
 return all.filter(f=>shown.has(f.id));
}
function choose(code,location=null){
 if(!graph.nodes[code]||graph.nodes[code].kind!=='country')return;
 if(code!==state.country){const previous=state.country;state.partner=state.mode==='trade'&&graph.flows.some(f=>f.product===state.product&&((f.origin===previous&&f.destination===code)||(f.origin===code&&f.destination===previous)))?previous:null;}
 selectedLocation=location?.every(Number.isFinite)?location:null;state.country=code;state.direction='both';state.sites=false;state.all=false;$('#detail-popup').hidden=true;closeMapMenus();$('#country-search').value='';render();
}
function showPopup(html){closeMapMenus();$('#popup-content').innerHTML=html;$('#detail-popup').hidden=false;mapOverlays();}
function showState(s){
 const v=graph.states[s.properties.name];
 showPopup(`<p class="eyebrow">ШТАТ / США · 2025</p><h2>${esc(s.properties.name)}</h2><p class="big-number">${fmt(v?.crude)}</p><p>тыс. барр./сутки · добыча сырой нефти с конденсатом${v?'':' · нет отдельного значения'}</p><p>Потребление штата пока не загружено. Бассейны могут пересекать границы нескольких штатов; их объёмы нельзя складывать с объёмами штатов.</p><a href="https://www.eia.gov/dnav/pet/pet_crd_crpdn_adc_mbbl_a.htm" target="_blank" rel="noopener">EIA · добыча по штатам ↗</a>`);
}
function showEdge(f){
 const src=graph.sources[f.source],a=graph.nodes[f.origin],b=graph.nodes[f.destination],observation=byObservation[f.observation],q=displayQuantity(f);
 const transport={pipeline:'По трубопроводам. Межстрановая связь; точная трасса здесь не восстановлена.',lng:'СПГ перевозят морскими газовозами, затем регазифицируют. Связь не привязана к конкретному терминалу или рейсу.',crude:'Перевозка танкерами и/или по трубопроводам. Этот набор торговли не разделяет объём по способам перевозки.',gasoline:'Готовое топливо после переработки: танкеры и/или другие виды транспорта. Вид транспорта не разделён в исходной таблице.',diesel:'Дистиллятное топливо после переработки, включая дизель и отопительное топливо. Вид транспорта не разделён в исходной таблице.'};
 showPopup(`<p class="eyebrow">${esc(products[f.product])} · ${f.year}</p><h2>${esc(a.name)} → ${esc(b.name)}</h2><p class="big-number">${fmt(q.value)}</p><p>${q.unit}${f.unit==='kbpd'?' · среднее за год':''}</p><p><strong>${flowDirection(f)==='imports'?'Импорт в выбранную страну':'Экспорт из выбранной страны'} · ${esc(nodeName(state.country))}</strong></p><p>${transport[f.product]}${f.product==='lng'?' Объём СПГ указан в газовом эквиваленте.':''}</p>${f.note?`<p>${esc(f.note)}</p>`:''}${observation?`<p class="context-note">Проверено по исходной записи: ${esc(observation.locator)}.<br><a href="validation.html?q=${encodeURIComponent(observation.id)}" target="_blank" rel="noopener">Число, единицы и проверка ↗</a></p>`:''}${a.kind==='region'||b.kind==='region'?'<p>Это региональная группа. Объём не распределён по входящим в неё странам.</p>':''}<a href="${src.url}" target="_blank" rel="noopener">${esc(src.label)} ↗</a><button class="jump" data-jump="${f.origin===state.country?f.destination:f.origin}">Перейти к ${esc(f.origin===state.country?b.name:a.name)} ↗</button>`);
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
 if(state.country==='CAN'&&state.product==='lng')explain='Входящие линии показывают импорт СПГ в Канаду, включая Перу и США. Канада также экспортирует СПГ: LNG Canada отправил первый груз 30 июня 2025. <a href="https://www.lngcanada.ca/news/first-cargo-puts-canada-on-the-map-of-lng-exporting-nations/" target="_blank" rel="noopener">Источник ↗</a>';
 if(state.country==='FRA'&&state.product==='crude')explain='Поставщики на карте — страны добычи сырья по INSEE/SDES. Это сырьё для НПЗ; внутренний спрос включает уже готовые нефтепродукты.';
 const reserve=c?.reserves!=null?`<div class="reserves">Доказанные запасы · 2024<br><strong>${fmt(c.reserves)} млрд баррелей</strong>${c.yearsConsumption!=null?` · ${fmt(c.yearsConsumption)} условных лет при спросе 2025`:''}${c.reserveNote?`<br>${esc(c.reserveNote)}`:''}</div>`:'';
 $('#country-details').innerHTML=`<p class="eyebrow">${state.country} / ${state.mode==='trade'?products[state.product]:'Нефтяные жидкости'}</p><h1 class="country-name">${esc(node.name)}</h1><div class="stats"><div><span class="stat-label">${domestic?domestic.productionLabel:gas?'Производство газа внутри страны':'Производство нефти и NGL'}</span><strong class="stat-value" data-stat="production">${fmt(production==null?null:production*factor,gas?1:0)}</strong><span class="stat-unit">${unit}</span></div><div><span class="stat-label">${domestic?domestic.consumptionLabel:gas?'Потребление газа внутри страны':'Спрос на нефтяные жидкости'}</span><strong class="stat-value" data-stat="consumption">${fmt(consumption==null?null:consumption*factor,gas?1:0)}</strong><span class="stat-unit">${unit}</span></div><div class="stat-balance"><span class="stat-label">${bal==null?'Баланс неизвестен':domestic&&state.product==='crude'?(bal<0?'НПЗ перерабатывают сверх добычи':'Добыча выше переработки'):bal>=0?'Производство выше спроса':'Спрос выше производства'}</span><strong class="${bal>=0?'incoming':'outgoing'}" data-stat="balance">${bal==null?'—':fmt(Math.abs(bal)*factor,gas?1:0)}</strong></div></div><p class="context-note">${note} Разница не равна фактическому экспорту.</p>${explain?`<p class="explanation">${explain}</p>`:''}${state.mode==='reserves'?reserve:''}`;
 const all=selectedFlows();currentFlows=visibleSelection(all);
 const incoming=selectedFlows('imports'),outgoing=selectedFlows('exports'),both=selectedFlows('both');
 for(const b of $$('[data-direction]')){
  const direction=b.dataset.direction,count={imports:incoming.length,exports:outgoing.length,both:both.length}[direction];
  b.textContent=({imports:'Поставщики',exports:'Покупатели',both:'Оба'}[direction])+` (${count})`;
 }
 let coverage=`На карте ${currentFlows.length} из ${all.length} связей в выборке. ${all.length} ${all.length===1?'связь':'связей'} в наборе · ${[...new Set(all.map(f=>f.year))].join(' / ')||'нет годовых связей'}. `;
 const fuelGenitive=({crude:'сырой нефти',gasoline:'бензина',diesel:'дистиллятов',pipeline:'трубопроводного газа',lng:'СПГ'}[state.product]);
 if(!all.length&&both.length)coverage=state.direction==='imports'?`Входящие поставки ${fuelGenitive} в эту страну в наборе не указаны. Есть ${outgoing.length} направлений экспорта — откройте «Покупатели».`:`Исходящие поставки ${fuelGenitive} из этой страны в наборе не указаны. Есть ${incoming.length} направлений импорта — откройте «Поставщики».`;
 else if(state.country==='FRA'&&state.product==='crude')coverage+=(graph.canary?'Проверка показывает 5 из 7 поставщиков. Полный источник: ':'')+'7 поставщиков покрывают 36,5 из 45,9 млн тонн импорта (79,5%). Остальные не распределены по странам в этой таблице.';
 else if(state.country==='USA'&&['crude','gasoline','diesel'].includes(state.product)){
   coverage+=`Полный импорт ${fmt(graph.totals[`USA:${state.product}:imports`])}; экспорт ${fmt(graph.totals[`USA:${state.product}:exports`])} тыс. барр./сутки · EIA 2025.`;
 }else if(!all.length)coverage+='Нет национальной торговой таблицы для этой страны и топлива. Это не означает отсутствия поставок.';
 else coverage+='Показаны опубликованные связи; региональные группы подписаны отдельно. Этот набор может не покрывать всю торговлю страны.';
 if(new Set(all.map(f=>f.unit)).size>1)coverage+=' Разные единицы показаны отдельно; общая сумма и общий рейтинг не рассчитываются.';
 if(state.partner&&currentFlows.some(f=>f.origin===state.partner||f.destination===state.partner))coverage+=` Связь с ${graph.nodes[state.partner].name} сохранена при переходе.`;
 if(state.country==='CAN'&&state.product==='lng')coverage+=' Экспорт СПГ Канады в этой матрице не выделен отдельным столбцом; отсутствие отдельных исходящих связей не означает нулевой экспорт.';
 if(graph.canary)coverage+=' Проверочный срез данных.';
 $('#coverage-note').textContent=coverage;
 const alternate=state.direction==='imports'?'exports':'imports';
 $('#opposite-flows').hidden=all.length>0||both.length===0;
 $('#opposite-flows').dataset.directionToShow=alternate;
 $('#opposite-flows').textContent=alternate==='exports'?`Показать экспорт: ${outgoing.length} направлений →`:`Показать импорт: ${incoming.length} направлений →`;
 $('#all-flows').textContent=state.all?'Основные связи':`Все связи на карте (${all.length})`;
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
 const partners=new Map();for(const f of currentFlows){const code=f.origin===state.country?f.destination:f.origin;if(!partners.has(code))partners.set(code,new Set());partners.get(code).add(flowDirection(f));}
 layer.selectAll('.country').attr('fill',f=>{const code=byId[String(+f.id)]?.iso,dirs=partners.get(code);return state.mode!=='trade'?metricColor(byCode[code]):code===state.country?colors.selected:!state.sites&&dirs?(dirs.size===2?'url(#trade-both-country)':d3.color(colors[[...dirs][0]]).darker(1.6)):colors.empty;}).classed('selected',f=>byId[String(+f.id)]?.iso===state.country);
}

function point(code){return projection(graph.nodes[code]?.coordinates||[0,0]);}
function screen(code){return transform.apply(point(code));}
function flowGeometry(f){
 const a=point(f.origin),b=point(f.destination),dx=b[0]-a[0],dy=b[1]-a[1],dist=Math.hypot(dx,dy)||1;
 // Reverse flows bend onto opposite sides of the chord, so both can be read and clicked.
 const bend=Math.min(90,dist*.2),c=[(a[0]+b[0])/2-dy/dist*bend,(a[1]+b[1])/2+dx/dist*bend];
 return {a,b,c};
}
function curve(f){
 const {a,b,c}=flowGeometry(f),t=.56;
 const left=a.map((v,i)=>(1-t)*v+t*c[i]),right=c.map((v,i)=>(1-t)*v+t*b[i]),mid=left.map((v,i)=>(1-t)*v+t*right[i]);
 // Exact quadratic subdivision places an arrow midway along the same smooth path.
 return `M${a}Q${left} ${mid}Q${right} ${b}`;
}
function inMap(p){return p.every(Number.isFinite)&&p[0]>=10&&p[0]<=W-10&&p[1]>=64&&p[1]<=H-48;}
function clearPoint(p,obstacles){return inMap(p)&&!obstacles.some(b=>p[0]>=b.x-4&&p[0]<=b.x+b.w+4&&p[1]>=b.y-4&&p[1]<=b.y+b.h+4);}
function visibleFlow(f,obstacles){
 const g=flowGeometry(f),a=transform.apply(g.a),b=transform.apply(g.b),c=transform.apply(g.c);
 const p=t=>a.map((v,i)=>(1-t)**2*v+2*(1-t)*t*c[i]+t*t*b[i]),breaks=[0,1];
 // Split at exact intersections with the viewport and controls, including when both endpoints are off screen.
 const roots=(axis,value)=>{
  const A=a[axis]-2*c[axis]+b[axis],B=2*(c[axis]-a[axis]),C=a[axis]-value;
  if(Math.abs(A)<1e-10){if(Math.abs(B)>1e-10)breaks.push(-C/B);return;}
  const D=B*B-4*A*C;if(D>=0){breaks.push((-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A));}
 };
 for(const v of [10,W-10])roots(0,v);for(const v of [64,H-48])roots(1,v);
 for(const box of obstacles){for(const v of [box.x-4,box.x+box.w+4])roots(0,v);for(const v of [box.y-4,box.y+box.h+4])roots(1,v);}
 const ts=[...new Set(breaks.filter(t=>t>=0&&t<=1))].sort((x,y)=>x-y),segments=[];
 for(let i=1;i<ts.length;i++){
  const lo=ts[i-1],hi=ts[i],t=(lo+hi)/2,xy=p(t);if(hi-lo<1e-8||!clearPoint(xy,obstacles))continue;
  const length=Math.hypot(...p(lo).map((v,j)=>v-xy[j]))+Math.hypot(...p(hi).map((v,j)=>v-xy[j]));
  segments.push({point:xy,length,angle:Math.atan2((1-t)*(c[1]-a[1])+t*(b[1]-c[1]),(1-t)*(c[0]-a[0])+t*(b[0]-c[0]))*180/Math.PI});
 }
 segments.sort((x,y)=>y.length-x.length);return {segment:segments[0],markerVisible:clearPoint(p(.56),obstacles)};
}
function focusCountry(){
 selectedLocation=null;const xy=point(state.country),k=transform.k;
 svg.call(zoom.transform,d3.zoomIdentity.translate(W/2-k*xy[0],H/2-k*xy[1]).scale(k));
}
function countryCaption(overlay,labels,obstacles){
 let xy=selectedLocation?transform.apply(projection(selectedLocation)):screen(state.country);
 if(!clearPoint(xy,obstacles)){
  const el=layer.select(`.country[data-iso="${state.country}"]`).node(),points=[];
  if(el){const length=el.getTotalLength();for(let i=0;i<=120;i++){const p=el.getPointAtLength(length*i/120),v=transform.apply([p.x,p.y]);if(clearPoint(v,obstacles))points.push(v);}}
  points.sort((a,b)=>Math.hypot(a[0]-W/2,a[1]-H/2)-Math.hypot(b[0]-W/2,b[1]-H/2));if(points.length)xy=points[0];
 }
 const visible=clearPoint(xy,obstacles),name=nodeName(state.country),width=Math.min(W-28,Math.max(visible?0:145,name.length*7)+20),height=visible?27:43;
 const anchor=visible?xy:[Math.max(14,Math.min(W-14,xy[0])),Math.max(74,Math.min(H-60,xy[1]))],position=placeLabel(anchor,width,height,labels);labels.push(position);
 const g=overlay.append('g').attr('class','selected-country-label').attr('data-country-label',state.country).attr('data-offscreen',!visible).attr('transform',`translate(${position.x},${position.y})`).attr('role','button').attr('tabindex',0).attr('aria-label',visible?`Сведения: ${name}`:`Показать на карте: ${name}`);
 const click=()=>visible?showPopup($('#country-details').innerHTML):focusCountry();g.on('click',click).on('keydown',e=>{if(e.key==='Enter')click();});
 g.append('rect').attr('width',width).attr('height',height).attr('rx',7);g.append('text').attr('x',10).attr('y',18).text(name);
 if(!visible)g.append('text').attr('class','caption-action').attr('x',10).attr('y',34).text('Показать на карте →');
 else overlay.append('line').attr('class','label-link').attr('x1',xy[0]).attr('y1',xy[1]).attr('x2',position.x+width/2).attr('y2',position.y+height/2).lower();
 const dot=screen(state.country);if(inMap(dot))overlay.append('circle').attr('class','selected-country-dot').attr('cx',dot[0]).attr('cy',dot[1]).attr('r',6).attr('fill',colors.selected).attr('stroke','#0c1820').attr('stroke-width',2);
}
function mapOverlays(){
 positionPanel();
 svg.selectAll('marker').attr('markerWidth',12/transform.k).attr('markerHeight',12/transform.k);
 svg.selectAll('.screen-layer').remove();const overlay=svg.append('g').attr('class','screen-layer'),labels=[],obstacles=mapObstacles();
 countryCaption(overlay,labels,obstacles);
 layer.select('.flow-layer').remove();const edges=layer.append('g').attr('class','flow-layer');
 if(state.mode==='trade'&&!state.sites){
  for(const f of currentFlows){const direction=f.destination===state.country?'imports':'exports';
   edges.append('path').datum(f).attr('class','edge-hit').attr('d',curve(f)).attr('data-origin',f.origin).attr('data-destination',f.destination).attr('data-flow',f.id).on('click',(e,x)=>{e.stopPropagation();showEdge(x);});
   edges.append('path').attr('class','edge').attr('data-flow',f.id).attr('data-origin',f.origin).attr('data-destination',f.destination).attr('d',curve(f)).attr('stroke',colors[direction]).attr('stroke-width',1.3+2.7*Math.sqrt(f.value/Math.max(...currentFlows.filter(x=>x.unit===f.unit&&x.year===f.year).map(x=>x.value)))).attr('marker-mid',`url(#arrow-${direction})`);
  }
  const visibility=new Map(currentFlows.map(f=>[f.id,visibleFlow(f,obstacles)]));
  for(const f of currentFlows){const v=visibility.get(f.id);if(v.segment&&!v.markerVisible)overlay.append('path').attr('class','viewport-arrow').attr('data-flow',f.id).attr('d','M-5,-5L6,0L-5,5Z').attr('transform',`translate(${v.segment.point}) rotate(${v.segment.angle})`).attr('fill',colors[flowDirection(f)]);}
  const grouped=d3.group(currentFlows,f=>f.origin===state.country?f.destination:f.origin);
  for(const [code,fs] of grouped){const xy=screen(code),f=fs[0],dirs=new Set(fs.map(flowDirection));
   overlay.append('circle').attr('class','map-dot').attr('cx',xy[0]).attr('cy',xy[1]).attr('r',4).attr('fill',dirs.size===2?'url(#trade-both-dot)':colors[flowDirection(f)]);
   const onMap=clearPoint(xy,obstacles),visible=fs.map(f=>visibility.get(f.id).segment).filter(Boolean).sort((a,b)=>b.length-a.length)[0],anchor=onMap?xy:visible?.point;
   if(!anchor)continue;
   const name=fs.length===1?flowRoute(f):graph.nodes[code].name,lines=fs.flatMap(x=>fs.length===1?[`${amount(x)} · ${productTags[x.product]} · ${x.year}`]:[flowRoute(x),`${amount(x)} · ${productTags[x.product]} · ${x.year}`]);
   const width=Math.min(W-28,340,Math.max(name.length*6.2,...lines.map(l=>l.length*5.4))+18),height=21+lines.length*15;
   const position=placeLabel(anchor,width,height,labels),{x,y}=position;labels.push(position);
   overlay.append('line').attr('class','label-link').attr('x1',anchor[0]).attr('y1',anchor[1]).attr('x2',x+width/2).attr('y2',y+height/2);
   const g=overlay.append('g').attr('class','partner-label').attr('data-partner',code).attr('data-anchor',onMap?'country':'flow').attr('data-offscreen',!inMap(xy)).attr('role',fs.length===1?'button':'group').attr('tabindex',fs.length===1?0:null).attr('aria-label',fs.map(x=>`${flowRoute(x)}: ${amount(x)} · ${products[x.product]} · ${x.year}`).join('; ')).attr('transform',`translate(${x},${y})`).on('click',()=>showEdge(f)).on('keydown',e=>{if(e.key==='Enter'&&fs.length===1)showEdge(f);});
   g.append('rect').attr('width',width).attr('height',height).attr('rx',6);g.append('text').attr('x',9).attr('y',15).text(name);
   let row=0;
   for(const flow of fs){
    const texts=fs.length===1?[`${amount(flow)} · ${productTags[flow.product]} · ${flow.year}`]:[flowRoute(flow),`${amount(flow)} · ${productTags[flow.product]} · ${flow.year}`];
    const rg=g.append('g').attr('class','flow-row').attr('data-flow',flow.id).attr('role',fs.length>1?'button':null).attr('tabindex',fs.length>1?0:null).attr('aria-label',`${flowRoute(flow)}: ${amount(flow)}`).on('click',e=>{e.stopPropagation();showEdge(flow);}).on('keydown',e=>{if(e.key==='Enter'){e.stopPropagation();showEdge(flow);}});
    rg.append('rect').attr('class','flow-row-hit').attr('x',4).attr('y',18+row*15).attr('width',width-8).attr('height',texts.length*15);
    for(const l of texts)rg.append('text').attr('class','amount').attr('x',9).attr('y',30+(row++)*15).style('fill',colors[flowDirection(flow)]).text(l);
   }
  }
 }
 layer.select('.state-layer').remove();
 if(state.mode!=='trade'){
  const rows=data.countries.filter(c=>c[state.mode]!=null).sort((a,b)=>Math.abs(b[state.mode])-Math.abs(a[state.mode])).slice(0,8);
  const selected=byCode[state.country];if(selected&&selected[state.mode]!=null&&!rows.includes(selected))rows.push(selected);
  const placed=labels;
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
   const siteLabels=labels;
   for(const s of graph.sites.filter(s=>s.country===state.country)){
    const xy=transform.apply(projection(s.coordinates));const g=overlay.append('g').attr('class',`site ${s.kind}`).attr('data-site',s.id).attr('transform',`translate(${xy})`).attr('role','button').attr('tabindex',0).attr('aria-label',s.name);
    const click=()=>showPopup(`<p class="eyebrow">${s.kind==='basin'?'ДОБЫЧА СЫРОЙ НЕФТИ':s.kind==='terminal'?'ТЕРМИНАЛ СПГ':'ГАЗОПРОВОД'} · ${s.year}</p><h2>${esc(s.name)}</h2>${s.production!=null?`<p class="big-number">${fmt(s.production)}</p><p>тыс. барр./сутки · добыча сырой нефти · ${s.year}</p>`:''}<p>${esc(s.detail)}</p>${s.observation?`<p><a href="validation.html?q=${encodeURIComponent(s.observation)}" target="_blank" rel="noopener">Исходное число и проверка ↗</a></p>`:''}<a href="${s.url}" target="_blank" rel="noopener">Источник ↗</a>`);
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
 $('#legend').innerHTML=state.sites?'<span><i style="background:#efc278"></i>Район добычи</span><span><i style="background:#8ec9ed"></i>Терминал СПГ</span>':state.mode==='trade'?`<span><i style="background:${colors.imports}"></i>Импорт в выбранную страну</span><span><i style="background:${colors.exports}"></i>Экспорт из неё</span><span><i style="background:linear-gradient(90deg,${colors.imports} 50%,${colors.exports} 50%)"></i>Оба направления</span>`:state.mode==='balance'?'<span>Дефицит</span><span class="legend-bar"></span><span>Избыток</span>':`<span>${{production:'Производство',consumption:'Спрос',reserves:'Запасы'}[state.mode]}</span><span class="legend-bar"></span><span>Больше</span>`;
 $('#route-note').textContent=state.sites?'Положение объектов приблизительное. Нажмите на точку.':'Линии — торговые связи, не путь судна. Нажмите на линию или подпись.';
 window.oilAtlas={data,graph,state,validation:release.validation,visibleFlows:currentFlows,selectCountry:choose,getSelectedBounds:selectedBounds,getView:()=>({x:transform.x,y:transform.y,k:transform.k,translate:projection.translate(),scale:projection.scale()})};
}
function initMap(preserveView=false){
 const center=preserveView&&projection?transform.invert([W/2,H/2]).map((v,i)=>(v-projection.translate()[i])/projection.scale()):null,previousZoom=transform.k;
 W=innerWidth;H=innerHeight;svg=d3.select('#world-map').attr('viewBox',`0 0 ${W} ${H}`);svg.selectAll('*').remove();
 projection=d3.geoNaturalEarth1().scale(Math.min((W-32)/6.25,(H-32)/3.1)).translate([W/2,H/2]);path=d3.geoPath(projection);
 const defs=svg.append('defs');for(const dir of ['imports','exports'])defs.append('marker').attr('id','arrow-'+dir).attr('viewBox','0 0 10 10').attr('markerUnits','userSpaceOnUse').attr('refX',5).attr('refY',5).attr('markerWidth',4).attr('markerHeight',4).attr('orient','auto').append('path').attr('d','M0,0L10,5L0,10Z').attr('fill',colors[dir]);
 for(const [id,dark] of [['trade-both-country',true],['trade-both-dot',false]]){
  const gradient=defs.append('linearGradient').attr('id',id);for(const [offset,direction] of [['0%','imports'],['50%','imports'],['50%','exports'],['100%','exports']])gradient.append('stop').attr('offset',offset).attr('stop-color',dark?d3.color(colors[direction]).darker(1.6):colors[direction]);
 }
 layer=svg.append('g').attr('class','geo-layer');layer.append('path').datum(d3.geoGraticule10()).attr('class','graticule').attr('d',path);
 layer.append('g').selectAll('path').data(features).join('path').attr('class','country').attr('data-iso',f=>byId[String(+f.id)]?.iso||'').attr('d',path).on('click',(e,f)=>{const c=byId[String(+f.id)];if(c){e.stopPropagation();choose(c.iso,projection.invert(d3.pointer(e,layer.node())));}}).append('title').text(f=>byId[String(+f.id)]?.name||f.properties?.name||'');
 zoom=d3.zoom().scaleExtent([1,18]).on('zoom',e=>{transform=e.transform;layer.attr('transform',transform);if(graph)mapOverlays();});svg.call(zoom);
 const xy=center?.map((v,i)=>projection.translate()[i]+v*projection.scale());
 svg.call(zoom.transform,xy?d3.zoomIdentity.translate(W/2-previousZoom*xy[0],H/2-previousZoom*xy[1]).scale(previousZoom):d3.zoomIdentity);
 render();if(state.sites&&!preserveView)focusSites();
}
function focusSites(){
 const xy=projection(state.country==='USA'?[-97,37]:[3,51]);const k=state.country==='USA'?3.8:5.7;const cx=W*.5,cy=H*.5;svg.call(zoom.transform,d3.zoomIdentity.translate(cx-k*xy[0],cy-k*xy[1]).scale(k));
}
async function main(){
 release=await loadValidatedData(new URLSearchParams(location.search).get('audit')==='canary'?'canary':'full');
 data=release.views.snapshot;graph=release.views.connections;byObservation=Object.fromEntries(release.observations.map(r=>[r.id,r]));
 if(!graph.nodes[state.partner]||state.partner===state.country)state.partner=null;
 [countries,usStates]=await Promise.all(['data/world.json','data/us-states.json'].map(async u=>{const r=await fetch(u);if(!r.ok)throw Error('Не удалось загрузить геометрию');return r.json();}));
 byCode=Object.fromEntries(data.countries.map(c=>[c.iso,c]));byId=Object.fromEntries(data.countries.filter(c=>c.id).map(c=>[String(+c.id),c]));
 features=topojson.feature(countries,countries.objects.countries).features.filter(f=>String(f.id)!=='010');usStates=topojson.feature(usStates,usStates.objects.states).features;
 if(graph.nodes[state.country]?.kind!=='country')state.country='FRA';
 $('#about-content').innerHTML=`<p><strong>Набор прошёл проверку:</strong> ${release.validation.summary.observations} исходных записей, ${release.validation.summary.reconciliations} сверок итогов. <a href="validation.html" target="_blank" rel="noopener">Отчёт, ограничения и поиск исходных чисел ↗</a></p><p><strong>Внутренние производство и спрос:</strong> Energy Institute 2026, год 2025. Нефтяные жидкости: нефть, конденсат и NGL. Для небольших производителей — EIA 2025. Спрос на нефтяные жидкости не равен объёму переработки сырой нефти.</p><p><strong>Торговля США:</strong> национальные таблицы EIA 2025. Годовые тысячи баррелей делятся на 365 для среднего суточного объёма. Бензин — finished motor gasoline; дистилляты включают дизель и отопительное топливо.</p><p><strong>Импорт Франции:</strong> INSEE/SDES, предварительные данные 2025, млн тонн/год. Страна происхождения — страна добычи, поэтому серия может отличаться от EIA, учитывающей экспорт из США. Показаны семь поставщиков, 79,5% полного импорта. Непоказанный остаток не распределён.</p><p><strong>Газ:</strong> матрицы трубопроводной торговли и СПГ Energy Institute 2026 за 2025. Они содержат страны и сводные группы. Для Франции в трубопроводной матрице есть только ЕС; его объём не присвоен Франции. Вместо этого отдельно показан существующий газопровод Franpipe.</p><p><strong>Другие связи сырой нефти:</strong> матрица EI 2025 за 2024. Она не содержит полного разбиения всех стран. Бензин и дистилляты вне торговли с США пока не покрыты.</p><p><strong>Запасы:</strong> OPEC ASB 2025, состояние на конец 2024. Границы стран: Natural Earth; штаты США: Census 2017 / us-atlas.</p>${Object.values(graph.sources).map(s=>`<p><a href="${s.url}" target="_blank" rel="noopener">${esc(s.label)} ↗</a></p>`).join('')}`;
 initMap();
 $('#search-toggle').onclick=()=>{const open=$('.search').hidden;$('.search').hidden=!open;$('#search-toggle').setAttribute('aria-expanded',open);$('#map-settings').hidden=true;$('#filters-toggle').setAttribute('aria-expanded','false');if(open){$('#detail-popup').hidden=true;$('#country-search').focus();}mapOverlays();};
 $('#filters-toggle').onclick=()=>{const open=$('#map-settings').hidden;$('#map-settings').hidden=!open;$('#filters-toggle').setAttribute('aria-expanded',open);$('.search').hidden=true;$('#search-toggle').setAttribute('aria-expanded','false');if(open)$('#detail-popup').hidden=true;mapOverlays();};
 $('#country-info').onclick=()=>showPopup($('#country-details').innerHTML);
 $$('[data-product]').forEach(b=>b.onclick=()=>{state.product=b.dataset.product;state.mode='trade';state.all=false;state.sites=false;$('#detail-popup').hidden=true;closeMapMenus();render();});
 $$('[data-direction]').forEach(b=>b.onclick=()=>{state.direction=b.dataset.direction;render();});
 $('#all-flows').onclick=()=>{state.all=!state.all;render();};
 $('#opposite-flows').onclick=()=>{state.direction=$('#opposite-flows').dataset.directionToShow;state.all=true;render();};
 $('#map-mode').onchange=e=>{state.mode=e.target.value;state.sites=false;$('#detail-popup').hidden=true;closeMapMenus();render();};
 $('#sites-button').onclick=()=>{state.sites=!state.sites;render();if(state.sites)focusSites();};
 $('#reset-map').onclick=()=>svg.call(zoom.transform,d3.zoomIdentity);$('#zoom-in').onclick=()=>svg.call(zoom.scaleBy,1.4);$('#zoom-out').onclick=()=>svg.call(zoom.scaleBy,1/1.4);
 $('#world-button').onclick=()=>{state.sites=false;closeMapMenus();svg.call(zoom.transform,d3.zoomIdentity);render();};
 $('#collapse-card').onclick=()=>{$('#country-card').classList.toggle('collapsed');positionPanel();mapOverlays();$('#collapse-card').textContent=$('#country-card').classList.contains('collapsed')?'+':'−';};
 $('#close-popup').onclick=()=>{$('#detail-popup').hidden=true;mapOverlays();};
 $('#about-button').onclick=()=>$('#about').showModal();$('#close-about').onclick=()=>$('#about').close();
 $('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.();
 $('#country-search').oninput=e=>{const term=e.target.value.trim().toLowerCase();const found=Object.values(graph.nodes).filter(c=>c.kind==='country'&&(c.name.toLowerCase().includes(term)||c.code.toLowerCase().includes(term)||metadataName(c.code).includes(term))).slice(0,9);$('#search-results').hidden=!term;$('#search-results').innerHTML=found.length?found.map(c=>`<button data-country="${c.code}">${esc(c.name)}</button>`).join(''):'<p>Страна не найдена</p>';$$('#search-results button').forEach(b=>b.onclick=()=>choose(b.dataset.country));mapOverlays();};
 $('#country-search').onkeydown=e=>{if(e.key==='Escape')$('#search-results').hidden=true;if(e.key==='Enter')$('#search-results button')?.click();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#detail-popup').hidden=true;closeMapMenus();mapOverlays();}if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();if($('.search').hidden)$('#search-toggle').click();else $('#country-search').focus();}});
 let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(()=>initMap(true),150);});
}
function metadataName(code){return (byCode[code]?.english||'').toLowerCase();}
main().catch(e=>{$('#error-message').hidden=false;$('#error-message').textContent='Карта не загрузилась: '+e.message;console.error(e);});
