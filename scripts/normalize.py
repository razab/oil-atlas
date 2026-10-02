"""Source facts -> normalized observations -> validated immutable publication.
Extraction needs openpyxl. Verification/publication gate uses only Python stdlib.
"""
import argparse, calendar, copy, hashlib, json, math, subprocess, sys, tempfile
from pathlib import Path
from source_extract import ROOT, RAW, sha
FOCUS={'USA','FRA','RUS','CAN','MEX','CHN','SAU','JPN','LUX','EGY','MDA','DEU'}
UNITS={'million_bbl/day':('bbl/day',1e6),'kbpd':('bbl/day',1000),'Mt':('tonne/year',1e6),'bcm':('m3/year',1e9),'million_barrels':('bbl',1e6)}
UNITS.update({'thousand_tonnes/month':('tonne/month',1000),'thousand_tonnes/period':('tonne/period',1000),'kg':('tonne/year',.001),'tonne/year':('tonne/year',1),'percent':('percent',1),'bbl/day':('bbl/day',1),'tonne':('tonne',1)})
SOURCE_KEYS={'EI-2026.xlsx':'ei-gas','EI-2025-trade.xlsx':'ei-oil','france-crude-imports-2025.html':'insee-france'}
for product in ['crude','gasoline','diesel']:
 for direction in ['imports','exports']:SOURCE_KEYS[f'us-{product}-{direction}-2025.html']=f'eia-{product}-{direction}'
for file,meta in json.loads((ROOT/'scripts/source-lock.json').read_text())['metadata'].items():
 if file.startswith('comtrade-') or meta.get('publisher') in {'ANRE Moldova','MIDOR','BAFA','Destatis','EIA Egypt','IEF JODI'}:SOURCE_KEYS[file]='national-'+Path(file).stem
WARNINGS=[
 'Две серии EIA по добыче сырой нефти США за 2025 различаются примерно на 0,56%. Для карточки сырой нефти используется национальная годовая таблица; обе исходные серии сохранены. Причина расхождения требует отдельной сверки редакций.',
 'Проверена точность извлечения, единицы и согласованность с исходными итогами. Это не независимое подтверждение всей мировой статистики.',
 'Текущий срез — годовые данные 2025; запасы и межрегиональная торговля сырой нефтью — 2024. Поставок в реальном времени нет.',
 'Тонны не переводятся в баррели без данных о плотности. Объёмы с разными единицами, годами и определениями не складываются.',
 'У Франции названы 7 поставщиков: 36,5 из 45,9 млн тонн, 79,5%. Остаток 9,4 млн тонн не распределён по странам; опубликованный ноль России сохранён отдельно.',
 'Матрица трубопроводного газа исключает торговлю внутри укрупнённых регионов. Для Франции есть группа ЕС, отдельного национального ряда нет.',
 'EI 2026 получен через публичное зеркало: версия файла зафиксирована, подлинность независимо по файлу издателя не подтверждена.',
 'Запасы OPEC: 41 явно названная страна; 2,1% мирового итога приходится на группы без разбиения. Запасы сырой нефти / спрос на все нефтяные жидкости — условное отношение, не прогноз.',
 'Терминалы и районы добычи показаны приближённо. Потоки не распределены по терминалам; линии не восстанавливают реальные маршруты.'
]
def limitations(records):
 files={r['source'] for r in records};extra=[]
 if 'jodi-EGY-products-2025.csv' in files:extra.append('JODI Египет: заполнены только январь–август 2025. Сентябрь–декабрь сохранены как пропуски; суммы за 8 месяцев не считаются годовыми и не сравниваются с годовыми стрелками. Код оценки 3 означает, что сопоставимость данных не оценена. Бензин включает автомобильный и авиационный; спрос на все нефтепродукты включает прямое использование нефти/NGL.')
 if 'moldova-anre-2025.txt' in files:extra.append('Молдова ANRE 2025: массы поставщиков рассчитаны из годового импорта и долей, округлённых до 0,1%; это приблизительные объёмы. Для дизеля 0,1% импорта не распределено по странам. Внутреннее потребление взято из баланса складов, без сложения оптовых и розничных продаж.')
 if 'germany-destatis-2025.html' in files:extra.append('Германия Destatis: только шесть названных поставщиков, 39,843 из 75,7 млн тонн (52,6%), редакция 9 марта 2026. Более поздний общий итог не смешивается с этими поставщиками. BAFA и таможенная статистика имеют разные границы и редакции; их итоги не заменяют друг друга. Полное потребление бензина в таблице BAFA скрыто по правилам конфиденциальности.')
 if 'egypt-eia-2024.txt' in files:extra.append('Египет: восемь НПЗ и общий итог 763 тыс. барр./сутки относятся к отчёту EIA августа 2024. Мощность MIDOR обновлена по отчёту 2025 до 160 тыс.; эти редакции не складываются в текущий национальный итог. Точки НПЗ приблизительны; мощность не означает фактическую переработку.')
 if any(fn.startswith('comtrade-') for fn in files):extra.append('Египет UN Comtrade 2025: масса сырой нефти оценена источником; доллары не преобразовывались в тонны или баррели. Расширенный сбор остановлен при HTTP 429. Полный список поставщиков нефтепродуктов Египта остаётся пробелом, импорт не считается нулём.')
 return WARNINGS+extra

def encoded(obj):return (json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def write(path,obj,pretty=False):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_bytes((json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode() if pretty else encoded(obj));tmp.replace(path)
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
   note='Страна добычи по INSEE/SDES. Данные предварительные; не страна последней отгрузки. Включены конденсаты и другое сырьё НПЗ.' if key=='insee-france' else 'Масса оценена UN Comtrade; не переводится в баррели.' if src.startswith('comtrade-') and r.get('estimated') else 'Приблизительная масса: годовой импорт × доля страны, округлённая ANRE до 0,1%. Для дизеля: только дизельное топливо, без отопительного.' if src=='moldova-anre-2025.txt' else 'Destatis: масса округлена; CN 27090090, редакция 9 марта 2026.' if src=='germany-destatis-2025.html' else None
   graph['flows'].append(dict(id=f'{key}:{prod}:{r["origin"]}:{r["destination"]}',origin=r['origin'],destination=r['destination'],product=prod,value=v/divisor,unit=unit,year=r['year'],source=key,owner=r.get('reporter'),note=note,observation=r['id']))
   if r.get('estimated'):graph['flows'][-1]['estimated']=True
   if r.get('rounded'):graph['flows'][-1]['rounded']=True
  elif measure.startswith('total_'):
   if v is not None:graph['totals'][f'{country}:{prod}:{measure[6:]}']=v/(1000 if r['unit']=='bbl/day' else 1e6)
  elif src=='us-basins-2025.html':
   site=next(s for s in graph['sites'] if s['id']==r['subdivision'])
   site.update(production=v/1000,observation=r['id'],year=r['year'])
   descriptions={'permian':'Западный Техас и юго-восток Нью-Мексико','eagle-ford':'Южный Техас','bakken':'Северная Дакота и Монтана','gulf':'Федеральный шельф Мексиканского залива'}
   site['detail']=descriptions[site['id']]+'. Точка обозначает район, не границу месторождения. Округлённая оценка EIA STEO за март 2026; объёмы бассейнов пересекаются со статистикой штатов, их нельзя складывать.'
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
 if any(r['source'].startswith('comtrade-') for r in records):national_views(records,graph)
 return dict(snapshot=snapshot,connections=graph)

def national_views(records,graph):
 lock=json.loads((ROOT/'scripts/source-lock.json').read_text())['metadata']
 graph['tradeCoverage']={};graph['totalYears']={}
 graph['nodes']['MDA']['name']='Молдова'
 graph['sites']=[s for s in graph['sites'] if not(s['country']=='EGY' and s['kind']=='refinery')]
 graph['refining']={}
 for r in records:
  src=r['source'];v=r['value'];prod=r['product'];country=r.get('country');measure=r['measure']
  if not(src.startswith('comtrade-') or src in {'moldova-anre-2025.txt','midor-sustainability-2025.txt','germany-bafa-2025.txt','germany-destatis-2025.html','egypt-eia-2024.txt','jodi-EGY-products-2025.csv'}):continue
  graph['sources'][SOURCE_KEYS[src]]=dict(label=lock[src]['label'],url=lock[src]['url'],year=r['year'],sha256=r['sourceSha256'])
  if measure.startswith('total_') and v is not None:
   key=f'{country}:{prod}:{measure[6:]}';unit={'tonne/year':'Mt','tonne/period':'MtPeriod','bbl/day':'kbpd'}[r['unit']];divisor=1e6 if unit in {'Mt','MtPeriod'} else 1000
   graph['totalUnits'][key]=unit;graph['totalYears'][key]=r['year']
   flows=[f for f in graph['flows'] if f['product']==prod and f['owner']==country and f['year']==r['year'] and f['unit']==unit and (f['destination']==country if measure=='total_imports' else f['origin']==country)]
   known=sum(f['value'] for f in flows)
   graph['tradeCoverage'][key]=dict(total=v/divisor,known=known,unit=unit,year=r['year'],estimated=r.get('estimated',False) or any(f.get('estimated') for f in flows),rounded=r.get('rounded',False),period=r.get('period'),source=SOURCE_KEYS[src],note='JODI: только январь–август; сентябрь–декабрь отсутствуют. Поставщики за этот период не раскрыты; годовые стрелки 2025 не складываются с этим итогом. Сопоставимость данных JODI не оценена (код 3).' if src=='jodi-EGY-products-2025.csv' else 'Destatis: шесть названных поставщиков, округлённые значения одной редакции от 9 марта 2026; остаток не распределён.' if src=='germany-destatis-2025.html' else 'Отчёт ANRE: объёмы стран рассчитаны из округлённых долей; нераспределённый остаток показан отдельно.' if src=='moldova-anre-2025.txt' else 'BAFA: национальные итоги, поставщики по этому продукту ещё не распределены.' if src=='germany-bafa-2025.txt' else 'UN Comtrade, HS 270900: таможенная торговля сырой нефтью.')
  elif measure in {'production','consumption'}:
   d=graph['domestic'].setdefault(country,{}).setdefault(prod,dict(unit='MtPeriod' if r.get('period') else 'Mt',production=None,consumption=None,year=r['year'],productionLabel='Добыча сырой нефти' if prod=='crude' else 'Выпуск НПЗ' if src=='jodi-EGY-products-2025.csv' else 'Выпуск топлива',consumptionLabel='Переработка сырой нефти' if prod=='crude' else 'Потребление топлива',note='JODI: январь–август 2025 (8 месяцев), без пересчёта на год. Бензин включает автомобильный и авиационный; дизель — gas/diesel oil. Для всех нефтепродуктов спрос включает прямое использование нефти/NGL. Код 3: сопоставимость не оценена.' if src=='jodi-EGY-products-2025.csv' else 'BAFA: добыча сырой нефти за 2025 в тоннах; национальная нефтяная отчётность. Объём переработки не подставляется из общего спроса.' if prod=='crude' else 'ANRE 2025: внутреннее потребление бензина / дизельного топлива; данные добычи/выпуска не опубликованы в этой таблице.' if country=='MDA' else 'BAFA 2025, предварительно: бензин / дизель без отопительного топлива. Потребление — внутренние поставки; полный итог бензина скрыт по правилам конфиденциальности BAFA.'))
   d[measure]=None if v is None else v/1e6
  elif measure=='refining_capacity' and src=='midor-sustainability-2025.txt':
   graph['sites'].append(dict(id='midor',name='НПЗ MIDOR · Александрия',country='EGY',kind='refinery',coordinates=[29.85,31.02],capacity=v/1000,year=r['year'],observation=r['id'],url=lock[src]['url'],detail='Проектная мощность 160 тыс. баррелей в сутки, отчёт MIDOR 2025. Это не добыча и не фактический объём переработки. Точка приблизительно обозначает район НПЗ у Александрии.'))
   graph['refining'].setdefault('EGY',{})['midor']=dict(capacity=v/1000,year=r['year'],label='НПЗ MIDOR',source=SOURCE_KEYS[src])
  elif measure=='national_refining_capacity':
   graph['refining'].setdefault('EGY',{}).update(capacity=v/1000,year=r['year'],count=8,source=SOURCE_KEYS[src])
  elif measure=='refining_capacity' and r['subdivision']!='midor':
   locations={'el-nasr':([32.54,29.98],'El-Nasr · Суэц'),'suez':([32.55,29.96],'Suez · Суэц'),'mostorod':([31.29,30.14],'Mostorod · Каир'),'el-mex':([29.85,31.15],'El-Mex · Александрия'),'amreya':([29.83,31.0],'Amreya · Америя'),'assiut':([31.17,27.18],'Assiut · Асьют'),'tanta':([31,30.79],'Tanta · Танта')}
   xy,label=locations[r['subdivision']]
   graph['sites'].append(dict(id='egypt-'+r['subdivision'],country='EGY',kind='refinery',name=label,coordinates=xy,capacity=v/1000,year=r['year'],observation=r['id'],url=lock[src]['url'],detail='Проектная мощность из отчёта EIA августа 2024. Не фактический объём переработки; актуальность на 2025/2026 не подтверждена. Точка приблизительно обозначает город/район расположения, не точный адрес.'))

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
  if r['year']!=lock['metadata'].get(r['source'],{}).get('year',2024 if r['source'] in {'EI-2025-trade.xlsx','opec-reserves-table-3.1-2024.txt'} else 2025):raise ValueError('Unexpected source year')
  unit,factor=conversion(r['rawUnit'],r['year'])
  v=r['rawValue'];expected=None if v is None else v*factor
  if v is not None and (not isinstance(v,(float,int)) or not math.isfinite(v) or v<0):raise ValueError('Negative/nonfinite source value')
  if r['unit']!=unit or not close(r['value'],expected):raise ValueError('Incorrect unit conversion')
  if r['status']!=('missing' if v is None else 'reported_zero' if v==0 else 'observed'):raise ValueError('Missing/zero confused')
  if not r.get('locator') or not r.get('basis'):raise ValueError('Observation lacks source boundary')
 byid={r['id']:r for r in records}
 for r in records:
  d=r.get('derivation')
  if not d:continue
  inputs=[byid[i] for i in d['inputs']]
  if d['operation'] not in {'sum','share'}:raise ValueError('Unknown derivation')
  if r.get('period') and (r['months']!=8 or len(inputs)!=8 or {x.get('month') for x in inputs}!=set(range(1,9)) or r['rawUnit']!='thousand_tonnes/period' or any(x['rawUnit']!='thousand_tonnes/month' for x in inputs)):raise ValueError('Incomplete or falsely annual period')
  if any(x['year']!=r['year'] or x['product']!=r['product'] for x in inputs):raise ValueError('Derived product/year mismatch')
  values=[x['rawValue'] for x in inputs]
  expected=None if any(x is None for x in values) else sum(values) if d['operation']=='sum' else values[0]*values[1]/100 if d['operation']=='share' else None
  if not close(r['rawValue'],expected):raise ValueError('Incorrect derived trade amount')
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
 if v.get('comparisons')!=comparisons(records):raise ValueError('Cross-source comparisons are stale')
 if v['summary']!=actual or v['status']!='passed_with_limitations':raise ValueError('Report is stale or falsely complete')
 if v['limitations']!=limitations(records):raise ValueError('Coverage caveats missing')
 return actual

def comparisons(records):
 result=[]
 us=[r for r in records if r.get('country')=='USA' and r['product']=='crude' and r['measure']=='production' and not r.get('subdivision')]
 if len(us)==2:
  a=next(r for r in us if r['source']=='eia-crude-ngl-2025.json');b=next(r for r in us if r['source']=='us-fuel-supply-2025.html')
  result.append(dict(label='Добыча сырой нефти США: две серии EIA, 2025',status='review_difference',observations=[a['id'],b['id']],values=[a['value'],b['value']],unit='bbl/day',difference=b['value']-a['value'],differencePercent=(b['value']/a['value']-1)*100,note='Расхождение около 0,56%. Обе серии сохранены; для карточки сырой нефти используется национальная годовая таблица. Разницу редакций необходимо исследовать отдельно.'))
 same=[r for r in records if r.get('origin')=='USA' and r.get('destination')=='FRA' and r['product']=='crude' and r['year']==2025]
 if len(same)==2:result.append(dict(label='США → Франция: EIA и INSEE, 2025',status='not_comparable',observations=[r['id'] for r in same],note='EIA учитывает экспорт в баррелях по назначению; INSEE — страну добычи в тоннах, включая другое сырьё НПЗ. Плотность и соответствие товарных границ отсутствуют; численное расхождение не рассчитывается.'))
 return result

def summary(bundle):
 r=bundle['observations'];v=bundle['views'];cs=v['snapshot']['countries'];g=v['connections']
 return dict(observations=len(r),reportedZeros=sum(x['status']=='reported_zero' for x in r),missing=sum(x['status']=='missing' for x in r),countries=len(cs),comparableOilBalances=sum(c['balance'] is not None for c in cs),reserveCountries=sum(c['reserves'] is not None for c in cs),directedFlows=len(g['flows']),sourceFiles=len(bundle['sources']),reconciliations=len(bundle['validation']['reconciliations']),unmappedPositiveFlows=0)

def verify(manifest_path):
 manifest=json.loads(manifest_path.read_text());file=manifest_path.parent/manifest['bundle']
 if sha(file)!=manifest['sha256']:raise ValueError('Bundle checksum mismatch')
 bundle=json.loads(file.read_text());validate(bundle)
 evidence_path=manifest_path.parent/manifest['evidence']
 if sha(evidence_path)!=manifest['evidenceSha256'] or bundle['evidenceSha256']!=manifest['evidenceSha256']:raise ValueError('Source evidence checksum mismatch')
 evidence=json.loads(evidence_path.read_text())
 if encoded(normalize(evidence['facts'],evidence['sources']))!=encoded(bundle['observations']):raise ValueError('Normalized observations differ from extracted source facts')
 if evidence['reconciliations']!=bundle['validation']['reconciliations'] or evidence['sources']!=bundle['sources']:raise ValueError('Source audit differs from publication report')
 if bundle['scope']=='full' and manifest_path.resolve()==(ROOT/'data/validated/manifest.json').resolve():
  for key in ['snapshot','connections']:
   if encoded(json.loads((ROOT/f'data/{key}.json').read_text()))!=encoded(bundle['views'][key]):raise ValueError('Compatibility download differs from verified release: '+key)
 if manifest['scope']!=bundle['scope']:raise ValueError('Manifest scope mismatch')
 return bundle

def build(scope,resume=False):
 dest=ROOT/'data'/('validation-canary' if scope=='canary' else 'validated');manifest_path=dest/'manifest.json'
 codehash=hashlib.sha256(b''.join((ROOT/'scripts'/name).read_bytes() for name in ['normalize.py','source_extract.py','coverage_extract.py','source-lock.json'])).hexdigest()
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
 for file,source in evidence['sources'].items():
  if file in SOURCE_KEYS:
   desc=template['connections']['sources'].get(SOURCE_KEYS[file],{})
   for key in ['url','label']:
    if key in desc and key not in source:source[key]=desc[key]
  if file=='eia-crude-ngl-2025.json':source['url']='https://www.eia.gov/international/data/world/petroleum-and-other-liquids'
 records=normalize(evidence['facts'],evidence['sources']);result=views(records,template,scope)
 evidence_digest=hashlib.sha256(encoded(evidence)).hexdigest();evidence_name='source-'+evidence_digest+'.json';write(dest/evidence_name,evidence)
 bundle=dict(schemaVersion=1,scope=scope,retrieved='2026-10-02',pipelineSha256=codehash,evidenceSha256=evidence_digest,sources=evidence['sources'],observations=records,views=result,validation=dict(status='passed_with_limitations',limitations=limitations(records),reconciliations=evidence['reconciliations'],excluded=evidence['excluded']))
 bundle['validation']['comparisons']=comparisons(records);bundle['validation']['summary']=summary(bundle);validate(bundle)
 digest=hashlib.sha256(encoded(bundle)).hexdigest();filename=digest+'.json';write(dest/filename,bundle)
 if scope=='full':
  write(ROOT/'data/snapshot.json',result['snapshot'],pretty=True);write(ROOT/'data/connections.json',result['connections'],pretty=True)
 # The small publication pointer is committed last, after all durable artifacts are validated.
 write(manifest_path,dict(schemaVersion=1,scope=scope,bundle=filename,sha256=digest,evidence=evidence_name,evidenceSha256=evidence_digest))
 verify(manifest_path)
 print('BUILT',manifest_path,summary(bundle))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--scope',choices=['canary','full'],default='canary');p.add_argument('--resume',action='store_true');p.add_argument('--verify',type=Path);args=p.parse_args()
 if args.verify:print('VERIFIED',summary(verify(args.verify)))
 else:build(args.scope,args.resume)
