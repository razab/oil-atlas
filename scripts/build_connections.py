"""Deterministic graph. Canary first; cached primary inputs, no live API dependency."""
import argparse, hashlib, json, re
from html import unescape
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT/'data/raw'
p = argparse.ArgumentParser(); p.add_argument('--canary', action='store_true'); args = p.parse_args()
def write(path, obj):
    tmp=path.with_suffix('.tmp'); tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n'); tmp.replace(path)
metadata=json.loads((RAW/'countries.json').read_text())
nodes={c['cca3']:dict(code=c['cca3'],name={'USA':'США','RUS':'Россия','KOR':'Южная Корея'}.get(c['cca3'],c.get('translations',{}).get('rus',{}).get('common',c['name']['common'])),coordinates=list(reversed(c['latlng'])),kind='country') for c in metadata if c.get('latlng')}
aliases={}
for c in metadata:
    for name in [c['name']['common'],c['name']['official']]+c.get('altSpellings',[]): aliases[name]=c['cca3']
aliases.update({'US':'USA','Russian Federation':'RUS','Iran':'IRN','Türkiye':'TUR','Turkey':'TUR','South Korea':'KOR','Korea, South':'KOR','Korea, North':'PRK','Trinidad & Tobago':'TTO','Taiwan':'TWN','Congo (Brazzaville)':'COG','Congo (Kinshasa)':'COD','Bahama Islands':'BHS','Ivory Coast':'CIV','Virgin Islands (U.S.)':'VIR','United Arab Emirates':'ARE'})
regions={
 'Europe':('Европа',[16,53]),'EU':('ЕС',[15,51]),'Non-EU Europe':('Европа вне ЕС',[23,61]),
 'Other Europe':('Другие страны Европы',[22,55]),'Other EU':('Другие страны ЕС',[17,50]),'Rest of Europe':('Остальная Европа',[24,61]),
 'Other Americas*':('Другие страны Америки',[-75,0]),'Other Europe*':('Другие страны Европы',[22,55]),'Other Asia Pacific*':('Другие страны АТР',[130,8]),
 'Other S. & Cent. America':('Другие страны Южной и Центральной Америки',[-65,-12]),'S. & Cent. America':('Южная и Центральная Америка',[-65,-12]),
 'Other CIS':('Другие страны СНГ',[60,43]),'Middle East':('Ближний Восток',[45,27]),'Other Middle East':('Другой Ближний Восток',[48,26]),
 'Africa':('Африка',[15,0]),'Other Africa':('Другие страны Африки',[16,2]),'Other Middle East & Africa':('Другие страны Ближнего Востока и Африки',[32,15]),
 'Australasia':('Австралия и Океания',[140,-25]),'Other Asia Pacific':('Другие страны АТР',[130,8]),'North Africa':('Северная Африка',[10,28]),'West Africa':('Западная Африка',[-8,9]),'East & S. Africa':('Восточная и Южная Африка',[32,-15])}
for name,(label,xy) in regions.items():
    code='region:'+name; aliases[name]=code; nodes[code]=dict(code=code,name=label+' · регион',coordinates=xy,kind='region')
aliases['UAE']='ARE'
flows=[]; totals={}; sources={}
def add(fr,to,product,value,unit,year,source,owner=None,note=None):
    if not fr or not to or fr==to or value is None or value<=0:return
    if args.canary and not ({fr,to} & {'USA','FRA'}):return
    if args.canary and (fr not in {'USA','FRA','CAN','MEX','VEN','CHN','DZA','NOR','KAZ','NGA','TTO','RUS'} or to not in {'USA','FRA','CAN','MEX','VEN','CHN','DZA','NOR','KAZ','NGA','TTO','RUS'}):return
    flows.append(dict(id=f'{source}:{product}:{fr}:{to}',origin=fr,destination=to,product=product,value=value,unit=unit,year=year,source=source,owner=owner,note=note))
def text(s):return ' '.join(unescape(re.sub('<[^>]+>',' ',s)).split())
def eia_rows(file):
    html=(RAW/file).read_text(); assert re.search(r'class="Series5">2025',html), 'EIA annual boundary changed'
    result=[]
    for part in re.split(r'<tr class="DataRow">',html)[1:]:
        name=re.search(r'<td class="DataStub1">(.*?)</td>',part,re.S)
        current=re.search(r'<td[^>]*class="Current2">(.*?)</td>',part,re.S)
        if not name or not current:continue
        label=text(name[1]); raw=text(current[1]).replace(',','')
        v=float(raw) if re.fullmatch(r'\d+(\.\d+)?',raw) else None
        result.append((label,v))
    assert result,'No source rows'; return result
for product,code in [('crude','EPC0'),('gasoline','EPM0F'),('diesel','EPD0')]:
    for direction in ['imports','exports']:
        source=f'eia-{product}-{direction}'
        filename=f'us-{product}-{direction}-2025.html'
        url='https://www.eia.gov/dnav/pet/'+(f'pet_move_impcus_a2_nus_{code}_im0_mbbl_a.htm' if direction=='imports' else f'pet_move_expc_a_{code}_EEX_mbbl_a.htm')
        sources[source]=dict(label=f'EIA · {direction} · 2025',url=url,sha256=hashlib.sha256((RAW/filename).read_bytes()).hexdigest(),boundary='Thousand barrels per year; annual 2025; blank ≠ zero')
        for name,value in eia_rows(filename):
            if name in ['All Countries','Total All Countries']:totals[f'USA:{product}:{direction}']=value/365 if value is not None else None
            partner=aliases.get(name)
            if partner and not partner.startswith('region:'):
                fr,to=(partner,'USA') if direction=='imports' else ('USA',partner)
                add(fr,to,product,value/365 if value is not None else None,'kbpd',2025,source,'USA')
sources['insee-france']=dict(label='INSEE / SDES · 2025 provisoire',url='https://www.insee.fr/fr/statistiques/2119697',sha256=hashlib.sha256((RAW/'france-crude-imports-2025.html').read_bytes()).hexdigest(),boundary='Million tonnes; country of extraction; includes condensates and refinery feedstocks; provisional 2025')
assert '2025' in (RAW/'france-crude-imports-2025.html').read_text()
totals['FRA:crude:imports']=45.9
for partner,value in [('DZA',4.3),('LBY',4.3),('NGA',5.5),('USA',10.1),('KAZ',6.8),('NOR',4.4),('SAU',1.1)]:
    add(partner,'FRA','crude',value,'Mt',2025,'insee-france','FRA','Страна добычи по INSEE/SDES. Данные предварительные; не страна последней отгрузки. Включены конденсаты и другое сырьё НПЗ.')
assert sum([4.3,4.3,5.5,10.1,6.8,4.4,1.1])==36.5
sources['ei-gas']=dict(label='Energy Institute 2026 · газ · 2025',url='https://www.energyinst.org/statistical-review/resources-and-data-downloads',boundary='Billion cubic metres; rows are destinations, columns origins; re-exports included for LNG',sha256=hashlib.sha256((RAW/'EI-2026.xlsx').read_bytes()).hexdigest())
w=openpyxl.load_workbook(RAW/'EI-2026.xlsx',read_only=True,data_only=True)
for sheet,product,header,start in [('Gas trade 2025 - LNG','lng',3,4),('Gas trade 2025 - pipeline','pipeline',2,3)]:
    rows=list(w[sheet].values);assert '2025' in rows[0][0];assert rows[2 if product=='lng' else 1][0]=='Billion cubic metres'
    labels=[str(v or '').strip() for v in rows[header]]
    if product=='lng':
        labels=[' '.join([str(rows[2][i] or '').strip(),str(rows[3][i] or '').strip()]).strip() for i in range(len(labels))]
    for row in rows[start:]:
        dest=aliases.get(str(row[0] or '').strip())
        if not dest:continue
        # Exclude subtotal rows, never allocate a group to its member countries.
        if str(row[0]).strip() in ['Europe','North America','S. & Cent. America','Middle East & Africa','CIS','Middle East','Africa','Asia Pacific']:continue
        for i,label in enumerate(labels[1:],1):
            origin=aliases.get(label)
            v=row[i]
            if isinstance(v,(int,float)):add(origin,dest,product,v,'bcm',2025,'ei-gas')
gas={}
for sheet,field in [('Gas Production - Bcm','production'),('Gas Consumption - Bcm','consumption')]:
    rows=list(w[sheet].values);col=list(rows[2]).index(2025);assert rows[2][col-1]==2024
    for row in rows[4:]:
        code=aliases.get(str(row[0] or '').strip());v=row[col]
        if code and not code.startswith('region:') and isinstance(v,(int,float)) and (not args.canary or code in {'USA','FRA','CAN','MEX'}):gas.setdefault(code,{})[field]=v
if not args.canary:
    sources['ei-oil']=dict(label='Energy Institute 2025 · сырая нефть · 2024',url='https://www.energyinst.org/statistical-review/resources-and-data-downloads',boundary='Million tonnes; country and regional groups kept separate; 2024')
    old=json.loads((ROOT/'data/trade.json').read_text())
    for f in old['flows']:
        origin=aliases.get(f['fromCode']);dest=aliases.get(f['toCode'])
        if origin=='USA' or dest=='USA':continue # US national 2025 replaces regional 2024 series.
        add(origin,dest,'crude',f['value'],'Mt',2024,'ei-oil')
basins=[('permian','Permian',[-102.4,31.8],6.6,'Западный Техас и юго-восток Нью-Мексико · 48% добычи США'),('eagle-ford','Eagle Ford',[-98.5,28.7],1.2,'Южный Техас · 9% добычи США'),('bakken','Bakken',[-103.3,48],1.2,'Северная Дакота и Монтана · 9% добычи США'),('gulf','Мексиканский залив',[-90,27],1.9,'Федеральный шельф · offshore')]
sites=[dict(id=i,country='USA',name=n,coordinates=xy,kind='basin',detail=f'{v} млн барр./сутки сырой нефти · 2025. {detail}. Точка обозначает район, не границу месторождения.',url='https://www.eia.gov/todayinenergy/detail.php?id=67404',year=2025) for i,n,xy,v,detail in basins]
for i,n,xy in [('sabine','Sabine Pass · Луизиана',[-93.87,29.74]),('corpus','Corpus Christi · Техас',[-97.28,27.88]),('freeport','Freeport · Техас',[-95.31,28.93]),('cameron','Cameron · Луизиана',[-93.31,29.77]),('calcasieu','Calcasieu Pass · Луизиана',[-93.33,29.75]),('plaquemines','Plaquemines · Луизиана',[-89.96,29.66]),('cove','Cove Point · Мэриленд',[-76.38,38.39]),('elba','Elba Island · Джорджия',[-80.96,32.08])]:
    sites.append(dict(id=i,country='USA',name=n,coordinates=xy,kind='terminal',detail='Экспортный терминал СПГ, работавший в 2025 году. Положение приблизительное. Межстрановые потоки не распределены по терминалам: эта карта не отслеживает отдельные грузы.',url='https://www.eia.gov/dnav/ng/ng_move_poe2_a_epg0_eng_mmcf_a.htm',year=2025))
sites.append(dict(id='dunkerque',country='FRA',name='Dunkerque · приём газа',coordinates=[2.2,51.03],kind='pipeline-terminal',detail='Franpipe: газопровод от платформы Draupner E в Северном море к Дюнкерку, 840 км. Это инфраструктурная связь, без оценки фактического потока за 2025 год.',url='https://gassco.eu/rorledningsnettverk/franpipe/',year=2025))
infra=[dict(id='franpipe',country='FRA',origin='NOR',destination='FRA',product='pipeline',coordinates=[[2.47,58.19],[2.2,51.03]],name='Franpipe',url='https://gassco.eu/rorledningsnettverk/franpipe/')]
if args.canary:sites=[s for s in sites if s['id'] in ['permian','eagle-ford','sabine','corpus','dunkerque']]
output=dict(version=2,canary=args.canary,flows=flows,nodes=nodes,sources=sources,totals=totals,gas=gas,sites=sites,infrastructure=infra)
state_values={}
for name,value in eia_rows('us-state-crude-2025.html'):
    if args.canary and name not in ['Texas','New Mexico']:continue
    if name.startswith('PADD') or name.startswith('Federal') or name=='U.S.':continue
    state_values[name]=dict(crude=value/365 if value is not None else None,year=2025)
output['states']=state_values
sources['eia-states']=dict(label='EIA · добыча по штатам · 2025',url='https://www.eia.gov/dnav/pet/pet_crd_crpdn_adc_mbbl_a.htm',sha256=hashlib.sha256((RAW/'us-state-crude-2025.html').read_bytes()).hexdigest(),boundary='Thousand barrels per year; crude including lease condensate; annual 2025')
assert abs(state_values['Texas']['crude']-2102613/365)<1e-9
assert len(set(f['id'] for f in flows))==len(flows),'Duplicate directed edge'
assert all(f['value']>0 and f['origin'] in nodes and f['destination'] in nodes for f in flows)
lookup={(f['origin'],f['destination'],f['product'],f['source']):f for f in flows}
assert abs(lookup['CAN','USA','crude','eia-crude-imports']['value']-1427229/365)<1e-8
assert lookup['USA','CHN','crude','eia-crude-exports']['value']==8321/365
assert lookup['USA','FRA','crude','insee-france']['value']==10.1
assert lookup['MEX','USA','pipeline','ei-gas']['value']<0.01
assert abs(lookup['USA','FRA','lng','ei-gas']['value']-14.278012644141281)<1e-9
write(ROOT/'data/connections.json',output)
print(f'{"CANARY" if args.canary else "FULL"}: {len(flows)} directed flows; {len(sites)} sites; 2025 national + 2024 regional crude')
