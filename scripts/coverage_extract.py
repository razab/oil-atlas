"""National additions. Keep commodity boundaries and estimation/derivation evidence."""
import json, math, re
from source_extract import RAW

COMMODITIES={'270900':'crude','271012':'refined','271019':'refined','271020':'refined'}
def comtrade_rows(response,meta):
 rows=response.get('data')
 if response.get('error') or not isinstance(rows,list) or response.get('count')!=len(rows) or len(rows)>=500:
  raise ValueError('Comtrade error/truncation; stop collection')
 for r in rows:
  if (str(r['period'])!='2025' or r['reporterCode']!=meta['reporterCode'] or r['cmdCode']!=meta['commodity'] or r['flowCode'] not in meta['flows'] or r['partner2Code']!=0 or r['customsCode']!='C00' or r['motCode']!=0 or r['classificationCode']!='H6'):
   raise ValueError('Comtrade commodity/year/reporting boundary changed')
  if r['netWgt'] is not None and (not math.isfinite(r['netWgt']) or r['netWgt']<0):raise ValueError('Invalid net mass')
  if not isinstance(r['isNetWgtEstimated'],bool):raise ValueError('Missing mass estimation flag')
 return rows

def extract(scope,registry,use,fact,check,excluded):
 components={}
 for fn,meta in registry['metadata'].items():
  if not fn.startswith('comtrade-') or (scope=='canary' and not meta.get('canary')):continue
  use(fn);rows=comtrade_rows(json.loads((RAW/fn).read_text()),meta)
  for i,r in enumerate(rows):
   prod=COMMODITIES[meta['commodity']];reporter=meta['reporter'];partner=r['partnerISO'];direction='imports' if r['flowCode']=='M' else 'exports'
   kw=dict(product=prod,reporter=reporter,estimated=r['isNetWgtEstimated'],commodity=r['cmdCode'],basis='HS '+r['cmdCode']+'; annual net mass; UN Comtrade '+('estimated mass' if r['isNetWgtEstimated'] else 'reported mass'),tradeDirection=direction)
   if r['partnerCode']==0:kw.update(country=reporter,measure='total_'+direction)
   elif partner in {'W00','_X','X00'} or len(partner)!=3:
    excluded.append(dict(source=fn,label=r['partnerDesc'],reason='Unspecified partner, not a country'));continue
   else:kw.update(origin=partner if direction=='imports' else reporter,destination=reporter if direction=='imports' else partner,measure='trade')
   # Refined fuels are the SUM of three mutually exclusive subheadings, never gasoline/diesel alone.
   measure=kw['measure'];kw['measure']='trade_component' if prod=='refined' else measure
   f=fact(fn,f'data[{i}]/HS={r["cmdCode"]}/flow={r["flowCode"]}/partner={r["partnerCode"]}',r['netWgt'],'kg',2025,**kw)
   if prod=='refined':components.setdefault((reporter,direction,partner),[]).append((f,measure))
 for (reporter,direction,partner),items in components.items():
  fs=[f for f,_ in items];values=[f['value'] for f in fs]
  kw={k:v for k,v in fs[0].items() if k in {'country','origin','destination','reporter','tradeDirection'}}
  known=all(v is not None for v in values)
  fact(fs[0]['source'],f'aggregate/refined/{reporter}/{direction}/{partner}',sum(values) if known else None,'kg',2025,product='refined',measure=items[0][1],estimated=any(f['estimated'] for f in fs),derivation=dict(operation='sum',inputs=[f['id'] for f in fs]),basis='HS 271012 + 271019 + 271020 (reported components); light/other petroleum preparations incl. biodiesel mixtures; excludes waste oils; not motor gasoline or diesel alone',**kw)
 fn='moldova-anre-2025.txt';use(fn);text=(RAW/fn).read_text();pages=text.split('\f')
 if len(pages)<8 or 'Raport 2025' not in pages[3] or 'Tabel 6.1.' not in pages[7] or '(tone)' not in pages[7]:raise ValueError('ANRE year/table/unit changed')
 for product,label,shares in [('gasoline','Benzină',{'ROU':('ROMÂNIA',97.7),'BGR':('BULGARIA',2.3)}),('diesel','Motorină',{'ROU':('ROMÂNIA',76.4),'TUR':('TURCIA',10.4),'BGR':('BULGARIA',4.6),'ARE':('EMIRATELE ARABE UNITE',3.6),'SAU':('SAUDITĂ',1.6),'IND':('INDIA',1.4),'AZE':('AZERBAIDJAN',.8),'KWT':('KUWEIT',.5),'ISR':('ISRAEL',.3),'EGY':('EGIPT',.2),'GRC':('GRECIA',.1)})]:
  if scope=='canary' and product!='gasoline':continue
  line=next(l for l in pages[7].split('Tabel 6.1.')[1].splitlines() if l.strip().startswith(label+' '))
  nums=re.findall(r'\d[\d ]*,\d{2}',line)
  if len(nums)!=4:raise ValueError('ANRE stock table columns changed')
  values=[float(s.replace(' ','').replace(',','.')) for s in nums]
  check('ANRE '+product+' opening + imports - consumption = closing',values[0]+values[1]-values[2],values[3],.011,'tonne/year')
  facts={}
  for measure,v in zip(['opening_stock','total_imports','consumption','closing_stock'],values):
   facts[measure]=fact(fn,f'page=8/table=6.1/row={label}/column={measure}',v,'tonne' if measure in {'opening_stock','closing_stock'} else 'tonne/year',2025,country='MDA',product=product,measure=measure,basis='ANRE customs import mass / internal consumption; excludes LPG; tonnes')
  chart=pages[3].split('IMPORTUL DE BENZINĂ' if product=='gasoline' else 'IMPORTUL DE MOTORINĂ')[1]
  if product=='gasoline':chart=chart.split('Similar anilor')[0]
  for origin,(name,expected) in shares.items():
   matches=re.findall(re.escape(name)+r':\s*([\d,]+)%',chart)
   if len(matches)!=1 or float(matches[0].replace(',','.'))!=expected:raise ValueError('ANRE origin share changed: '+name)
   share=fact(fn,f'page=4/chart={product}/origin={origin}',expected,'percent',2025,country='MDA',product=product,measure='origin_share',basis='Published share rounded to 0.1 percentage point')
   fact(fn,f'derived/{product}/{origin}->MDA',values[1]*expected/100,'tonne/year',2025,origin=origin,destination='MDA',product=product,measure='trade',reporter='MDA',tradeDirection='imports',estimated=True,derivation=dict(operation='share',inputs=[facts['total_imports']['id'],share['id']]),basis='ANRE total import mass multiplied by rounded origin share; approximate bilateral tonnes, not individually reported customs mass')
  check('ANRE '+product+' named shares + residual',sum(v for _,v in shares.values())+(0 if product=='gasoline' else .1),100,.00001,'percent')
 fn='midor-sustainability-2025.txt';use(fn);text=(RAW/fn).read_text()
 if '2025' not in text or 'Refining Capacity: 160,000 barrels/day' not in text:raise ValueError('MIDOR capacity boundary changed')
 fact(fn,'printed-pages=15-16/Refining Capacity',160000,'bbl/day',2025,country='EGY',product='crude',measure='refining_capacity',subdivision='midor',basis='Design refining capacity, not annual crude throughput or oil production')
 if scope=='full':
  fn='germany-bafa-2025.txt';use(fn);text=(RAW/fn).read_text();pages=text.split('\f')
  if 'Monat: Dezember 2025' not in pages[0] or '24.04.2026' not in text:raise ValueError('BAFA edition changed')
  def annual(page,label):
   if 'Mengenangaben in Tonnen' not in pages[page-1] or 'Kumulation' not in pages[page-1]:raise ValueError('BAFA annual/unit boundary')
   line=next(l for l in pages[page-1].splitlines() if l.strip().startswith(label))
   numbers=re.findall(r'[+\-\u00ad]?\d[\d.]*(?:,\d+)?',line[len(line)-len(line.lstrip()):][len(label):])
   if not numbers:return None # Confidential blank, never zero.
   if len(numbers)!=6:raise ValueError('BAFA columns changed: '+label)
   return float(numbers[3].replace('.','').replace(',','.'))
  for product,label in [('gasoline','Ottokraftstoff'),('diesel','Dieselkraftstoff')]:
   for measure,page in [('production',5),('total_imports',6),('total_exports',7),('consumption',8)]:
    v=annual(page,label)
    if product=='gasoline' and measure=='consumption':
     # The unspecified grade on page 9 is confidential. Three named grades do NOT establish a complete national total.
     grades=[annual(9,s) for s in ['Super Plus (unverbleit, 98 Oktan)','Super 95 (Eurosuper, unverbleit, 95 Oktan)','Super E10']]
     v=None
    fact(fn,f'page={page if not(product=="gasoline" and measure=="consumption") else 9}/row={label}/column=cumulative-2025',v,'tonne/year',2025,country='DEU',product=product,measure=measure,basis='BAFA provisional 2025; motor gasoline / diesel only (excludes heating oil); domestic deliveries for consumption; confidential blanks unknown')
  fact(fn,'page=3/row=Zugang von deutschem Rohöl/cumulative-2025',annual(3,'+ Zugang von deutschem Rohöl'),'tonne/year',2025,country='DEU',product='crude',measure='production',basis='BAFA domestic crude; national petroleum reporting, differs from customs coverage')
