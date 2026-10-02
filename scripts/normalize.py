"""Source facts -> normalized observations -> validated immutable publication.
Extraction needs openpyxl. Verification/publication gate uses only Python stdlib.
"""
import argparse, calendar, copy, hashlib, json, math, subprocess, sys, tempfile
from pathlib import Path
from source_extract import ROOT, RAW, sha
FOCUS={'USA','FRA','RUS','CAN','MEX','CHN','SAU','JPN','LUX'}
UNITS={'kbpd':('bbl/day',1000),'Mt':('tonne/year',1e6),'bcm':('m3/year',1e9),'million_barrels':('bbl',1e6)}
SOURCE_KEYS={'EI-2026.xlsx':'ei-gas','EI-2025-trade.xlsx':'ei-oil','france-crude-imports-2025.html':'insee-france'}
for product in ['crude','gasoline','diesel']:
 for direction in ['imports','exports']:SOURCE_KEYS[f'us-{product}-{direction}-2025.html']=f'eia-{product}-{direction}'
WARNINGS=[
 'Проверена точность извлечения, единицы и согласованность с исходными итогами. Это не независимое подтверждение всей мировой статистики.',
 'Текущий срез — годовые данные 2025; запасы и межрегиональная торговля сырой нефтью — 2024. Поставок в реальном времени нет.',
 'Тонны не переводятся в баррели без данных о плотности. Объёмы с разными единицами, годами и определениями не складываются.',
 'У Франции названы 7 поставщиков: 36,5 из 45,9 млн тонн, 79,5%. Остаток 9,4 млн тонн не распределён по странам; опубликованный ноль России сохранён отдельно.',
 'Матрица трубопроводного газа исключает торговлю внутри укрупнённых регионов. Для Франции есть группа ЕС, отдельного национального ряда нет.',
 'EI 2026 получен через публичное зеркало: версия файла зафиксирована, подлинность независимо по файлу издателя не подтверждена.',
 'Запасы OPEC: 41 явно названная страна; 1,9% мирового итога приходится на группы без разбиения. Запасы сырой нефти / спрос на все нефтяные жидкости — условное отношение, не прогноз.',
 'Терминалы и районы добычи показаны приближённо. Потоки не распределены по терминалам; линии не восстанавливают реальные маршруты.'
]

def encoded(obj):return (json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def write(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_bytes(encoded(obj));tmp.replace(path)
def conversion(unit,year):return ('bbl/day',1000/(366 if calendar.isleap(year) else 365)) if unit=='thousand_barrels/year' else UNITS[unit]
def close(a,b):
 if a is None or b is None:return a is b
 return math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-9)
def normalize(facts,sources):
 out=[]
 for f in facts:
  r=copy.deepcopy(f);unit,factor=conversion(f['unit'],f['year'])
  r.update(rawValue=r.pop('value'),rawUnit=r.pop('unit'),unit=unit,sourceSha256=sources[f['source']]['sha256'])
  r['value']=None if r['rawValue'] is None else r['rawValue']*factor
  r['status']='missing' if r['value'] is None else 'reported_zero' if r['value']==0 else 'observed'
  out.append(r)
 return sorted(out,key=lambda r:r['id'])

def views(records,template,scope):
 snapshot=copy.deepcopy(template['snapshot']);graph=copy.deepcopy(template['connections']);snapshot['canary']=graph['canary']=scope=='canary'
 countries={c['iso']:c for c in snapshot['countries'] if scope=='full' or c['iso'] in FOCUS}
 for c in countries.values():
  for field in ['production','consumption','crude','ngl','reserves','balance','yearsConsumption','yearsProduction','reserveYear','productionSource','consumptionSource']:c[field]=None
 graph.update(flows=[],gas={},states={},domestic={'USA':{}},totals={})
 for r in records:
  v=r['value'];country=r.get('country');prod=r['product'];measure=r['measure'];src=r['source'];raw=r['rawValue']
  if measure=='trade':
   if v is None or v<=0 or r['origin']==r['destination']:continue
   if src=='EI-2025-trade.xlsx' and 'USA' in [r['origin'],r['destination']]:continue
   key=SOURCE_KEYS[src];unit={'bbl/day':'kbpd','tonne/year':'Mt','m3/year':'bcm'}[r['unit']];divisor={'kbpd':1000,'Mt':1e6,'bcm':1e9}[unit]
   note='Страна добычи по INSEE/SDES. Данные предварительные; не страна последней отгрузки. Включены конденсаты и другое сырьё НПЗ.' if key=='insee-france' else None
   graph['flows'].append(dict(id=f'{key}:{prod}:{r["origin"]}:{r["destination"]}',origin=r['origin'],destination=r['destination'],product=prod,value=v/divisor,unit=unit,year=r['year'],source=key,owner=r.get('reporter'),note=note,observation=r['id']))
  elif measure.startswith('total_'):
   graph['totals'][f'{country}:{prod}:{measure[6:]}']=v/(1000 if r['unit']=='bbl/day' else 1e6)
  elif src=='us-state-crude-2025.html':
   if not r['subdivision'].startswith('Federal Offshore'):graph['states'][r['subdivision']]=dict(crude=None if v is None else v/1000,year=r['year'])
  elif src=='us-fuel-supply-2025.html':
   field='production' if measure=='production' else 'consumption';graph['domestic']['USA'].setdefault(prod,{})[field]=v/1000
  elif prod=='natural_gas':graph['gas'].setdefault(country,{})[measure]=raw
  elif prod=='oil_liquids':
   if country=='WORLD':snapshot['world'][measure]=v/1e6 if v is not None else None
   elif country in countries:
    c=countries[country];c[measure]=v/1e6 if v is not None else None;c[measure+'Source']='Energy Institute 2026'
  elif measure=='reserves':
   if country=='WORLD':snapshot['reservesWorld']=v/1e9;snapshot['reservesYear']=r['year']
   elif country in countries:countries[country].update(reserves=v/1e9,reserveYear=r['year'])
  elif src=='eia-crude-ngl-2025.json' and country in countries:
   countries[country]['crude' if prod=='crude' else 'ngl']=None if v is None else v/1e6
 for c in countries.values():
  if c['production'] is None and c['crude'] is not None and c['ngl'] is not None:c['production']=c['crude']+c['ngl'];c['productionSource']='EIA crude + NGPL'
  if c['production'] is not None and c['consumption'] is not None:c['balance']=c['production']-c['consumption']
  if c['iso']!='CAN' and c['reserves'] is not None:
   for denominator,target in [('consumption','yearsConsumption'),('crude','yearsProduction')]:
    if c[denominator]:c[target]=c['reserves']*1000/(c[denominator]*(366 if calendar.isleap(int(snapshot['snapshot'])) else 365))
 snapshot['countries']=sorted(countries.values(),key=lambda c:c['iso'])
 graph['flows'].sort(key=lambda f:f['id'])
 for prod,d in graph['domestic']['USA'].items():
  for field in ['productionLabel','consumptionLabel','note']:d[field]=template['connections']['domestic']['USA'][prod][field]
 graph['totalObservations']={f'{r["country"]}:{r["product"]}:{r["measure"][6:]}':r['id'] for r in records if r['measure'].startswith('total_')}
 graph['totalUnits']={key:'Mt' if key.startswith('FRA:') else 'kbpd' for key in graph['totals']}
 for source in ['ei-oil','ei-gas']:
  file='EI-2025-trade.xlsx' if source=='ei-oil' else 'EI-2026.xlsx'
  observed=next((r for r in records if r['source']==file),None)
  if observed and source in graph['sources']:graph['sources'][source]['sha256']=observed['sourceSha256']
 return dict(snapshot=snapshot,connections=graph)

def validate(bundle):
 if bundle.get('schemaVersion')!=1 or bundle.get('scope') not in {'canary','full'}:raise ValueError('Unknown bundle schema/scope')
 records=bundle['observations'];sources=bundle['sources'];ids=set()
 lock=json.loads((ROOT/'scripts/source-lock.json').read_text())
 for file,s in sources.items():
  if lock['files'].get(file)!=s['sha256']:raise ValueError(f'Source not pinned: {file}')
 for r in records:
  if r['id'] in ids:raise ValueError('Duplicate observation')
  ids.add(r['id'])
  if r['source'] not in sources or r['sourceSha256']!=sources[r['source']]['sha256']:raise ValueError('Missing provenance')
  if r['year']!= (2024 if r['source'] in {'EI-2025-trade.xlsx','opec-reserves-table-3.1-2024.txt'} else 2025):raise ValueError('Unexpected source year')
  unit,factor=conversion(r['rawUnit'],r['year'])
  v=r['rawValue'];expected=None if v is None else v*factor
  if v is not None and (not isinstance(v,(float,int)) or not math.isfinite(v) or v<0):raise ValueError('Negative/nonfinite source value')
  if r['unit']!=unit or not close(r['value'],expected):raise ValueError('Incorrect unit conversion')
  if r['status']!=('missing' if v is None else 'reported_zero' if v==0 else 'observed'):raise ValueError('Missing/zero confused')
  if not r.get('locator') or not r.get('basis'):raise ValueError('Observation lacks source boundary')
 for check in bundle['validation']['reconciliations']:
  if not math.isclose(check['actual'],check['expected'],abs_tol=check['tolerance'],rel_tol=0):raise ValueError('Failed source reconciliation: '+check['label'])
 expected=views(records,bundle['views'],bundle['scope'])
 for key in ['snapshot','connections']:
  if encoded(expected[key])!=encoded(bundle['views'][key]):raise ValueError(f'View differs from normalized source observations: {key}')
 g=bundle['views']['connections'];flowids=set()
 for f in g['flows']:
  if f['id'] in flowids:raise ValueError('Duplicate directed flow')
  flowids.add(f['id'])
  for endpoint in [f['origin'],f['destination']]:
   if endpoint not in g['nodes']:raise ValueError('Unmapped map endpoint: '+endpoint)
  if f['observation'] not in ids or f['value']<=0:raise ValueError('Untraceable flow')
 for s in g['sites']:
  if len(s['coordinates'])!=2 or not (-180<=s['coordinates'][0]<=180 and -90<=s['coordinates'][1]<=90) or not s['url'].startswith('https://'):raise ValueError('Invalid site metadata')
 v=bundle['validation'];actual=summary(bundle)
 if v['summary']!=actual or v['status']!='passed_with_limitations':raise ValueError('Report is stale or falsely complete')
 if v['limitations']!=WARNINGS:raise ValueError('Coverage caveats missing')
 return actual

def summary(bundle):
 r=bundle['observations'];v=bundle['views'];cs=v['snapshot']['countries'];g=v['connections']
 return dict(observations=len(r),reportedZeros=sum(x['status']=='reported_zero' for x in r),missing=sum(x['status']=='missing' for x in r),countries=len(cs),comparableOilBalances=sum(c['balance'] is not None for c in cs),reserveCountries=sum(c['reserves'] is not None for c in cs),directedFlows=len(g['flows']),sourceFiles=len(bundle['sources']),reconciliations=len(bundle['validation']['reconciliations']),unmappedPositiveFlows=0)

def verify(manifest_path):
 manifest=json.loads(manifest_path.read_text());file=manifest_path.parent/manifest['bundle']
 if sha(file)!=manifest['sha256']:raise ValueError('Bundle checksum mismatch')
 bundle=json.loads(file.read_text());validate(bundle)
 if manifest['scope']!=bundle['scope']:raise ValueError('Manifest scope mismatch')
 return bundle

def build(scope,resume=False):
 dest=ROOT/'data'/('validation-canary' if scope=='canary' else 'validated');manifest_path=dest/'manifest.json'
 codehash=hashlib.sha256(b''.join((ROOT/'scripts'/name).read_bytes() for name in ['normalize.py','source_extract.py','source-lock.json'])).hexdigest()
 if resume and manifest_path.exists():
  b=verify(manifest_path)
  if b['pipelineSha256']!=codehash:raise ValueError('Pipeline changed; rebuild instead of resuming stale data')
  for file,s in b['sources'].items():
   if sha(RAW/file)!=s['sha256']:raise ValueError('Source changed while resuming')
  print('RESUMED',manifest_path,summary(b));return
 from source_extract import extract
 evidence=extract(scope)
 template={key:json.loads((ROOT/f'data/{file}.json').read_text()) for key,file in [('snapshot','snapshot'),('connections','connections')]}
 if scope=='full':
  # Raw builders write only to temporary staging; published paths are changed by the final manifest commit.
  with tempfile.TemporaryDirectory(prefix='oil-atlas-stage-') as tmp:
   for name,extra in [('build_data.py',['--offline']),('build_connections.py',[])]:
    subprocess.run([sys.executable,str(ROOT/'scripts'/name),'--output-dir',tmp,*extra],check=True)
   template={key:json.loads((Path(tmp)/f'{key}.json').read_text()) for key in ['snapshot','connections']}
 # Canary uses the same source-to-view code, but no full rebuild or replacement of production data.
 records=normalize(evidence['facts'],evidence['sources']);result=views(records,template,scope)
 bundle=dict(schemaVersion=1,scope=scope,retrieved='2026-10-02',pipelineSha256=codehash,sources=evidence['sources'],observations=records,views=result,validation=dict(status='passed_with_limitations',limitations=WARNINGS,reconciliations=evidence['reconciliations'],excluded=evidence['excluded']))
 bundle['validation']['summary']=summary(bundle);validate(bundle)
 digest=hashlib.sha256(encoded(bundle)).hexdigest();filename=digest+'.json';write(dest/filename,bundle)
 write(manifest_path,dict(schemaVersion=1,scope=scope,bundle=filename,sha256=digest))
 verify(manifest_path)
 if scope=='full':
  # Compatibility downloads are projections of this exact verified release, never inputs to the UI.
  write(ROOT/'data/snapshot.json',result['snapshot']);write(ROOT/'data/connections.json',result['connections'])
 print('BUILT',manifest_path,summary(bundle))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--scope',choices=['canary','full'],default='canary');p.add_argument('--resume',action='store_true');p.add_argument('--verify',type=Path);args=p.parse_args()
 if args.verify:print('VERIFIED',summary(verify(args.verify)))
 else:build(args.scope,args.resume)
