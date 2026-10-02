"""Failure-path checks: corrupt inputs must not reach a published view."""
import copy,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from normalize import ROOT,verify,validate,conversion
from source_extract import france_rows,eia_rows,numeric
MANIFEST=ROOT/('data/validated/manifest.json' if (ROOT/'data/validated/manifest.json').exists() else 'data/validation-canary/manifest.json')
B=verify(MANIFEST)
class ValidationTests(unittest.TestCase):
 def rejects(self,change):
  b=copy.deepcopy(B);change(b)
  with self.assertRaises(ValueError):validate(b)
 def test_russia_lng_full_column_and_direction(self):
  rows=[r for r in B['observations'] if r.get('origin')=='RUS' and r['product']=='lng' and r['value']]
  self.assertEqual(len(rows),10);self.assertAlmostEqual(sum(r['value'] for r in rows)/1e9,42.56305480406593)
  self.assertAlmostEqual(next(r['value'] for r in rows if r['destination']=='FRA')/1e9,8.563071155706238)
 def test_missing_zero_and_france_residual(self):
  r=next(r for r in B['observations'] if r.get('origin')=='RUS' and r.get('destination')=='FRA' and r['product']=='crude')
  self.assertEqual(r['status'],'reported_zero');self.assertEqual(r['value'],0)
  rows=[r for r in B['observations'] if r['source']=='france-crude-imports-2025.html' and r['measure']=='trade']
  self.assertAlmostEqual(sum(r['value'] for r in rows)/1e6,36.5)
  self.assertEqual(numeric('--'),None);self.assertEqual(numeric('0'),0)
 def test_incompatible_units_not_converted(self):
  self.assertEqual(conversion('Mt',2025),('tonne/year',1e6));self.assertEqual(conversion('thousand_barrels/year',2024),('bbl/day',1000/366))
 def test_bad_conversion(self):self.rejects(lambda b:b['observations'][0].update(value=12345))
 def test_missing_as_zero(self):
  self.rejects(lambda b:next(r for r in b['observations'] if r['status']=='missing').update(value=0,status='reported_zero'))
 def test_negative_value(self):self.rejects(lambda b:b['observations'][0].update(rawValue=-1,value=-1000))
 def test_wrong_year(self):self.rejects(lambda b:b['observations'][0].update(year=2023))
 def test_wrong_source_hash(self):self.rejects(lambda b:b['observations'][0].update(sourceSha256='0'*64))
 def test_duplicate(self):self.rejects(lambda b:b['observations'].append(copy.deepcopy(b['observations'][0])))
 def test_false_report(self):self.rejects(lambda b:b['validation'].update(status='passed'))
 def test_bad_margin(self):self.rejects(lambda b:b['validation']['reconciliations'][0].update(actual=1e15))
 def test_transposed_view(self):
  def change(b):
   f=b['views']['connections']['flows'][0];f['origin'],f['destination']=f['destination'],f['origin']
  self.rejects(change)
 def test_partial_bundle_bytes(self):
  with tempfile.TemporaryDirectory() as tmp:
   m=json.loads(MANIFEST.read_text());p=Path(tmp);(p/'manifest.json').write_text(json.dumps(m));(p/m['bundle']).write_text('{}')
   with self.assertRaisesRegex(ValueError,'checksum'):verify(p/'manifest.json')
 def test_wrong_source_column(self):
  for name,parser in [('france-crude-imports-2025.html',france_rows),('us-crude-imports-2025.html',eia_rows)]:
   with tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp)/name;p.write_text((ROOT/'data/raw'/name).read_text().replace('2025','2026'))
    with self.assertRaises(ValueError):parser(p)
 def test_repaired_country_aliases(self):
  rows=B['views']['connections']['flows']
  for product,dest in [('gasoline','LCA'),('gasoline','VCT'),('diesel','LCA'),('diesel','VGB')]:self.assertTrue(any(f['origin']=='USA' and f['destination']==dest and f['product']==product for f in rows))
if __name__=='__main__':unittest.main()
