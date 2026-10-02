"""Cached annual oil snapshot: EI 2026 (2025), supplemented by EIA crude + NGL."""
import argparse, json, math, os, urllib.request, urllib.parse, hashlib
from pathlib import Path
import openpyxl
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser();p.add_argument('--canary', action='store_true');p.add_argument('--offline', action='store_true');a=p.parse_args()
RAW=ROOT/'data/raw';RAW.mkdir(exist_ok=True)
YEAR=2025
CANARY={'USA','CHN','SAU','JPN','LUX'}
def durable(path,data):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');temp.replace(path)
def cached(name,url):
    path=RAW/name
    if path.exists():return json.loads(path.read_text())
    if a.offline:raise RuntimeError(f'Missing cached source: {name}')
    with urllib.request.urlopen(url,timeout=45) as r:data=json.load(r)
    durable(path,data);return data
def number(x):
    try:
        v=float(x);return v if math.isfinite(v) and v>=0 else None
    except (ValueError,TypeError):return None
metadata=cached('countries.json','https://raw.githubusercontent.com/mledoze/countries/master/countries.json')
meta={c['cca3']:c for c in metadata}
alias={}
for c in metadata:
    for name in [c['name']['common'],c['name']['official']]+c.get('altSpellings',[]):alias[name]=c['cca3']
alias.update({'US':'USA','Iran':'IRN','Russian Federation':'RUS','Republic of Congo':'COG','South Korea':'KOR','Türkiye':'TUR','Trinidad & Tobago':'TTO','China Hong Kong SAR':'HKG','Taiwan':'TWN','Czech Republic':'CZE','Vietnam':'VNM'})
def workbook(name,url,expected):
    file=RAW/name
    if not file.exists():
        if a.offline:raise RuntimeError(f'Missing cached workbook: {name}')
        temporary=file.with_suffix('.download')
        with urllib.request.urlopen(url,timeout=90) as r:temporary.write_bytes(r.read())
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=expected:raise RuntimeError('Source workbook changed; verify edition and data boundaries before updating')
        temporary.replace(file)
    assert hashlib.sha256(file.read_bytes()).hexdigest()==expected,'Unexpected workbook version'
workbook('EI-2026.xlsx','https://nextbarrel.io/files/EI-Stats-Review-ALL-data.xlsx','846e72c22d0a6cc14358d0faa0caafa99d6080c65218b19954dd62b11b72c448')
workbook('EI-2025-trade.xlsx','https://energyinst.net/all-data/EI-stats-review-all-data.xlsx','b50e7cb2964e3a73b0ea63838a99d1775cca18545dd702c26083a4488f205d63')

records={};world={}
def record(code,english=None):
    if code not in records:
        m=meta.get(code,{})
        records[code]=dict(iso=code,id=m.get('ccn3'),name={'USA':'США','RUS':'Россия','KOR':'Южная Корея','PRK':'Северная Корея','COG':'Республика Конго'}.get(code,m.get('translations',{}).get('rus',{}).get('common',english or code)),english=english or m.get('name',{}).get('common',code),region=m.get('region','Другие'),coordinates=list(reversed(m.get('latlng',[0,0]))),production=None,consumption=None,crude=None,ngl=None,reserves=None,reserveYear=None,productionSource=None,consumptionSource=None)
    return records[code]
wb=openpyxl.load_workbook(RAW/'EI-2026.xlsx',read_only=True,data_only=True)
for sheet,field in [('Oil Production - barrels','production'),('Oil Consumption - barrels','consumption')]:
    rows=list(wb[sheet].values);assert rows[2][0]=='Thousand barrels daily'
    column=list(rows[2]).index(YEAR) # first year, never the repeated growth/share column
    assert rows[2][column-1]==YEAR-1
    for row in rows[4:]:
        name=str(row[0] or '').strip();v=number(row[column]);code=alias.get(name)
        if name=='Total World':world[field]=v/1000
        if not code or (a.canary and code not in CANARY):continue
        c=record(code,name);assert c[field] is None
        c[field]=v/1000 if v is not None else None;c[field+'Source']='Energy Institute 2026'
params=[('api_key',os.environ.get('EIA_API_KEY','DEMO_KEY')),('frequency','annual'),('data[0]','value'),('start',str(YEAR)),('end',str(YEAR)),('length','5000'),('facets[unit][]','TBPD'),('facets[activityId][]','1')]
for v in ['57','58']:params.append(('facets[productId][]',v))
if a.canary:
    for v in sorted(CANARY):params.append(('facets[countryRegionId][]',v))
raw=cached('canary-eia-crude-ngl.json' if a.canary else 'eia-crude-ngl-2025.json','https://api.eia.gov/v2/international/data/?'+urllib.parse.urlencode(params))
response=raw['response'];assert len(response['data'])==int(response['total']),'Truncated API response; do not publish'
for row in response['data']:
    assert row['period']==str(YEAR) and row['unit']=='TBPD' and row['activityId']=='1'
    if row['countryRegionTypeId']!='c':continue
    c=record(row['countryRegionId'],row['countryRegionName']);field={'57':'crude','58':'ngl'}[row['productId']];v=number(row['value']);c[field]=v/1000 if v is not None else None
reserves=json.loads((RAW/'reserves-2024.json').read_text())
for c in records.values():
    if c['production'] is None and c['crude'] is not None and c['ngl'] is not None:
        c['production']=c['crude']+c['ngl'];c['productionSource']='EIA crude + NGPL'
    r=reserves.get(c['iso'])
    if r is not None:c.update(reserves=r,reserveYear=2024)
    c['balance']=c['production']-c['consumption'] if c['production'] is not None and c['consumption'] is not None else None
    c['yearsConsumption']=c['reserves']*1000/(c['consumption']*365) if c['reserves'] is not None and c['consumption'] and c['iso']!='CAN' else None
    c['yearsProduction']=c['reserves']*1000/(c['crude']*365) if c['reserves'] is not None and c['crude'] and c['iso']!='CAN' else None
    if c['iso']=='CAN':c['reserveNote']='OPEC исключает нефтяные пески из запасов Канады. Срок не рассчитан: добыча включает нефтяные пески.'
# Trade: preserve original matrix boundaries and million tonnes per year.
trade_wb=openpyxl.load_workbook(RAW/'EI-2025-trade.xlsx',read_only=True,data_only=True)
rows=list(trade_wb['Oil - Inter-area movements'].values)
assert '2024' in str(rows[0][0]);assert rows[2][0]=='Crude (million tonnes)'
names={'Canada':'Канада','Mexico':'Мексика','US':'США','S. & Cent. America':'Южная и Центральная Америка','Europe':'Европа','Russia':'Россия','Other CIS':'Другие страны СНГ','Middle East':'Ближний Восток','Africa':'Африка','Australasia':'Австралия и Океания','China':'Китай','India':'Индия','Japan':'Япония','Singapore':'Сингапур','Other Asia Pacific':'Другие страны АТР','Iraq':'Ирак','Kuwait':'Кувейт','Saudi Arabia':'Саудовская Аравия','UAE':'ОАЭ','Other Middle East':'Другой Ближний Восток','North Africa':'Северная Африка','West Africa':'Западная Африка','East & S. Africa':'Восточная и Южная Африка'}
flows=[]
for row in rows[4:]:
    origin=str(row[0] or '').strip()
    if origin.startswith('Total'):break
    if origin not in names:continue
    for j,destination in enumerate(rows[2][1:],1):
        if destination=='Total':break
        value=number(row[j])
        if a.canary and (origin,destination)!=('Saudi Arabia','China'):continue
        if value and destination in names:flows.append(dict(fromName=names[origin],toName=names[destination],fromCode=origin,toCode=destination,value=value))
assert flows
sources=[dict(name='Energy Institute 2026 · производство и спрос · 2025',url='https://www.energyinst.org/statistical-review/resources-and-data-downloads',year=YEAR),dict(name='EIA · добыча сырой нефти и газовых жидкостей · 2025',url='https://www.eia.gov/international/data/world/petroleum-and-other-liquids',year=YEAR),dict(name='OPEC ASB 2025 · запасы · таблица 3.1',url='https://www.opec.org/assets/assetdb/asb-2025.pdf',year=2024),dict(name='EIA · морские узлы · I пол. 2025',url='https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/',year='1H2025')]
result=dict(snapshot=str(YEAR),retrieved='2026-10-02',canary=a.canary,world=world,reservesWorld=1566.869,reservesYear=2024,countries=sorted(records.values(),key=lambda c:c['iso']),sources=sources)
# Gate the major-country canary: do not accept missing consumption or a wrong repeated-year column.
for code in CANARY:
    assert records[code]['balance'] is not None,f'Incomplete annual pair: {code}'
assert records['CHN']['balance']<0 and records['SAU']['balance']>0
assert records['LUX']['production']==0 and records['JPN']['reserves'] is None
assert 90<world['production']<120 and 90<world['consumption']<120
assert all(c['balance'] is None or math.isclose(c['balance'],c['production']-c['consumption']) for c in records.values())
durable(ROOT/'data/snapshot.json',result)
durable(ROOT/'data/trade.json',dict(year=2024,unit='million tonnes per year',canary=a.canary,flows=sorted(flows,key=lambda t:-t['value'])))
provenance=dict(eiWorkbook=dict(publisher='Energy Institute',edition=2026,downloadMirror='https://nextbarrel.io/files/EI-Stats-Review-ALL-data.xlsx',sha256=hashlib.sha256((RAW/'EI-2026.xlsx').read_bytes()).hexdigest(),sheets=['Oil Production - barrels','Oil Consumption - barrels']),trade=dict(publisher='Energy Institute',edition=2025,year=2024,downloadMirror='https://energyinst.net/all-data/EI-stats-review-all-data.xlsx',sha256=hashlib.sha256((RAW/'EI-2025-trade.xlsx').read_bytes()).hexdigest(),sheet='Oil - Inter-area movements'),reserves=dict(publisher='OPEC',edition=2025,year=2024,table='3.1',printedPage=22,url=sources[2]['url']),retrieved='2026-10-02')
durable(RAW/'provenance.json',provenance)
print(json.dumps(dict(countries=len(records),balances=sum(c['balance'] is not None for c in records.values()),flows=len(flows),world=world,canary=a.canary,sha256=hashlib.sha256((ROOT/'data/snapshot.json').read_bytes()).hexdigest())))
