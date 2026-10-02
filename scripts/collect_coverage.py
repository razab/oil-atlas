"""Bounded serial Comtrade collection, durable cache, fail closed on rate limit/schema/truncation."""
import argparse,hashlib,json,time,urllib.request
from urllib.parse import urlencode
from source_extract import ROOT,RAW
from coverage_extract import comtrade_rows

PLAN=[('EGY',818,'270900','X'),('DEU',276,'270900','M,X'),('EGY',818,'271012','M,X'),('EGY',818,'271019','M,X'),('EGY',818,'271020','M,X')]
def collect(plan=PLAN,fetch=None,pause=time.sleep):
 state=RAW/'comtrade-collection-state.json'
 if state.exists() and json.loads(state.read_text()).get('status')=='stopped':raise ValueError('Collection remains stopped after source restriction; no automatic restart')
 registry=json.loads((ROOT/'scripts/source-lock.json').read_text())
 for country,code,commodity,flow in plan:
  filename=f'comtrade-{country}-{commodity}-{flow.replace(",","+")}-2025.json'
  query=dict(period=2025,reporterCode=code,cmdCode=commodity,flowCode=flow,partnerCode='',partner2Code=0,customsCode='C00',motCode=0,maxRecords=500,includeDesc='true')
  url='https://comtradeapi.un.org/public/v1/preview/C/A/HS?'+urlencode(query)
  meta=dict(publisher='UN Comtrade',year=2025,url=url,label=f'{country}: HS {commodity}, {flow} · UN Comtrade 2025',reporter=country,reporterCode=code,commodity=commodity,flows=flow.split(','),canary=False)
  path=RAW/filename
  if path.exists():
   if registry['files'].get(filename)!=hashlib.sha256(path.read_bytes()).hexdigest():raise ValueError('Unreviewed cached response; stop')
   comtrade_rows(json.loads(path.read_text()),meta);print('CACHED',filename,flush=True);continue
  # No retries, no alternative host/proxy. Any HTTP error stops the entire plan.
  try:payload=fetch(url) if fetch else urllib.request.urlopen(url,timeout=45).read()
  except Exception as error:
   state.write_text(json.dumps(dict(status='stopped',reason=str(error),failedRequest=url,policy='No automatic retry or restart'),indent=2)+'\n')
   raise
  response=json.loads(payload);comtrade_rows(response,meta)
  tmp=path.with_suffix('.tmp');tmp.write_bytes(payload);tmp.replace(path)
  registry['files'][filename]=hashlib.sha256(payload).hexdigest();registry['metadata'][filename]=meta
  lock=ROOT/'scripts/source-lock.json';tmp=lock.with_suffix('.tmp');tmp.write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n');tmp.replace(lock)
  print('SAVED',filename,len(response['data']),flush=True);pause(2)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--publication-canary-passed',action='store_true');args=parser.parse_args()
 if not args.publication_canary_passed:parser.error('Complete the published end-to-end canary before collecting the full plan')
 collect()
