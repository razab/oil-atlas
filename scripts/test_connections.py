"""Independent checks for units, reporting boundaries, graph containment and source anchors."""
import json, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
G=json.loads((ROOT/'data/connections.json').read_text())
class GraphChecks(unittest.TestCase):
 def flow(self,fr,to,product,source):
  return next(f for f in G['flows'] if (f['origin'],f['destination'],f['product'],f['source'])==(fr,to,product,source))
 def test_crude_annual_conversion(self):
  self.assertAlmostEqual(self.flow('CAN','USA','crude','eia-crude-imports')['value'],1427229/365)
  self.assertAlmostEqual(self.flow('VEN','USA','crude','eia-crude-imports')['value'],51033/365)
  self.assertAlmostEqual(self.flow('USA','CHN','crude','eia-crude-exports')['value'],8321/365)
 def test_france_origin_definition(self):
  rows=[f for f in G['flows'] if f['owner']=='FRA']
  self.assertEqual(len(rows),5 if G['canary'] else 7)
  self.assertEqual(self.flow('USA','FRA','crude','insee-france')['value'],10.1)
  self.assertTrue(all(f['unit']=='Mt' and f['year']==2025 and f['destination']=='FRA' for f in rows))
  if not G['canary']:self.assertAlmostEqual(sum(f['value'] for f in rows),36.5)
 def test_gas_direction_and_distinct_units(self):
  self.assertAlmostEqual(self.flow('CAN','USA','pipeline','ei-gas')['value'],87.242408154748)
  self.assertAlmostEqual(self.flow('USA','MEX','pipeline','ei-gas')['value'],66.03478128656063)
  self.assertLess(self.flow('MEX','USA','pipeline','ei-gas')['value'],.01)
  self.assertAlmostEqual(self.flow('USA','FRA','lng','ei-gas')['value'],14.278012644141281)
  self.assertFalse(any(f['product']=='pipeline' and 'FRA' in [f['origin'],f['destination']] for f in G['flows']))
 def test_domestic_fuel_and_subnational_boundaries(self):
  self.assertAlmostEqual(G['domestic']['USA']['gasoline']['consumption'],3261180/365)
  self.assertAlmostEqual(G['states']['Texas']['crude'],2102613/365)
  self.assertEqual(len([s for s in G['sites'] if s['country']!='EGY']),16)
  self.assertEqual(len([s for s in G['sites'] if s['country']=='EGY' and s['kind']=='refinery']),8)
  self.assertEqual(next(s['capacity'] for s in G['sites'] if s['id']=='midor'),160)
 def test_graph_integrity_and_years(self):
  self.assertEqual(len(G['flows']),732)
  self.assertEqual(len([f for f in G['flows'] if f['owner']=='DEU']),6)
  self.assertAlmostEqual(G['tradeCoverage']['DEU:crude:imports']['known'],39.843)
  self.assertEqual(G['domestic']['EGY']['diesel']['unit'],'MtPeriod')
  self.assertEqual(G['tradeCoverage']['EGY:diesel:imports']['total'],5.247)
  self.assertEqual(len({f['id'] for f in G['flows']}),len(G['flows']))
  for f in G['flows']:
   self.assertGreater(f['value'],0);self.assertIn(f['origin'],G['nodes']);self.assertIn(f['destination'],G['nodes'])
   self.assertIn(f['unit'],['kbpd','Mt','bcm']);self.assertIn(f['year'],[2024,2025])
   if f['year']==2024:self.assertEqual(f['source'],'ei-oil');self.assertNotIn('USA',[f['origin'],f['destination']])
if __name__=='__main__':unittest.main()
