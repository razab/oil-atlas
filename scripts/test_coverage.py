import copy,json,unittest,tempfile,hashlib
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from normalize import ROOT,verify,validate
from coverage_extract import comtrade_rows
B=verify(ROOT/'data/validation-canary/manifest.json')
class CoverageTests(unittest.TestCase):
 def test_estimated_mass_and_import_direction(self):
  flows=[f for f in B['views']['connections']['flows'] if f['owner']=='EGY']
  self.assertEqual({f['origin'] for f in flows},{'SAU','USA','KWT'})
  self.assertTrue(all(f['destination']=='EGY' and f['estimated'] for f in flows))
 def test_stock_balance_and_derived_share(self):
  checks=[c for c in B['validation']['reconciliations'] if c['label'].startswith('ANRE')]
  self.assertEqual(len(checks),2)
  r=next(r for r in B['observations'] if r.get('origin')=='ROU' and r.get('destination')=='MDA')
  self.assertAlmostEqual(r['value'],211919.58*.977);self.assertTrue(r['estimated'])
 def test_incorrect_derived_number_rejected(self):
  b=copy.deepcopy(B);r=next(r for r in b['observations'] if r.get('derivation') and r['source']=='moldova-anre-2025.txt');r['rawValue']+=1;r['value']+=1
  with self.assertRaisesRegex(ValueError,'derived'):validate(b)
 def test_monthly_period_not_annual(self):
  r=next(r for r in B['observations'] if r['source']=='jodi-EGY-products-2025.csv' and r['measure']=='total_imports')
  self.assertEqual(r['months'],8);self.assertEqual(r['period'],'2025-01/2025-08');self.assertEqual(r['unit'],'tonne/period');self.assertEqual(r['value'],1932000)
  self.assertEqual(len(r['derivation']['inputs']),8);self.assertEqual(r['assessmentCode'],3)
 def test_capacity_not_production(self):
  s=next(s for s in B['views']['connections']['sites'] if s['id']=='midor')
  self.assertEqual(s['capacity'],160);self.assertNotIn('production',s)
 def test_truncated_error_wrong_product_or_year_rejected(self):
  fn='comtrade-EGY-270900-M-2025.json';raw=json.loads((ROOT/'data/raw'/fn).read_text());meta=json.loads((ROOT/'scripts/source-lock.json').read_text())['metadata'][fn]
  for mutation in [lambda r:r.update(count=500),lambda r:r.update(error='rate limit'),lambda r:r['data'][0].update(cmdCode='271012'),lambda r:r['data'][0].update(period=2024),lambda r:r['data'][0].update(isNetWgtEstimated=None)]:
   r=copy.deepcopy(raw);mutation(r)
   with self.assertRaises(ValueError):comtrade_rows(r,meta)
 def test_collector_stops_on_429(self):
  import collect_coverage as collector
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'scripts').mkdir();(root/'raw').mkdir();(root/'scripts/source-lock.json').write_text('{"files":{},"metadata":{}}');calls=[]
   def fetch(url):calls.append(url);raise HTTPError(url,429,'Too many requests',None,None)
   with patch.object(collector,'ROOT',root),patch.object(collector,'RAW',root/'raw'):
    with self.assertRaises(HTTPError):collector.collect(fetch=fetch,pause=lambda _:None)
    with self.assertRaisesRegex(ValueError,'remains stopped'):collector.collect(fetch=fetch,pause=lambda _:None)
   self.assertEqual(len(calls),1);self.assertEqual(json.loads((root/'raw/comtrade-collection-state.json').read_text())['status'],'stopped')
 def test_collector_resumes_without_network(self):
  import collect_coverage as collector
  fn='comtrade-EGY-270900-M-2025.json';payload=(ROOT/'data/raw'/fn).read_bytes()
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'scripts').mkdir();(root/'raw').mkdir();(root/'raw'/fn).write_bytes(payload)
   (root/'scripts/source-lock.json').write_text(json.dumps(dict(files={fn:hashlib.sha256(payload).hexdigest()},metadata={})))
   with patch.object(collector,'ROOT',root),patch.object(collector,'RAW',root/'raw'):
    collector.collect(plan=[('EGY',818,'270900','M')],fetch=lambda _:self.fail('Cached response requested again'),pause=lambda _:None)
if __name__=='__main__':unittest.main()
