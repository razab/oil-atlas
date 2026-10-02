"""Independent source-boundary and arithmetic checks for the published snapshot."""
import json, math, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'data/snapshot.json').read_text());by={c['iso']:c for c in data['countries']}
class SnapshotTests(unittest.TestCase):
 def test_published_source_values(self):
  # Independent known cells: EI 2026 Oil Production/Consumption barrels, 2025.
  self.assertAlmostEqual(by['USA']['production'],21.06536712328767)
  self.assertAlmostEqual(by['CHN']['consumption'],17.36041634503618)
  self.assertAlmostEqual(by['SAU']['production'],11.407904031412023)
  self.assertAlmostEqual(data['world']['production'],100.58955408398654)
  self.assertAlmostEqual(data['world']['consumption'],103.03872689873116)
 def test_missing_is_not_zero(self):
  self.assertEqual(by['LUX']['production'],0)
  self.assertIsNone(by['JPN']['reserves']);self.assertIsNone(by['JPN']['yearsConsumption'])
  self.assertTrue(by['CHN']['balance']<0);self.assertTrue(by['SAU']['balance']>0)
 def test_unique_countries_and_exact_year(self):
  self.assertEqual(len(by),len(data['countries']));self.assertEqual(data['snapshot'],'2025')
  self.assertFalse(any(c['name'].startswith('Total') for c in data['countries']))
  self.assertFalse(any(c['iso'] in ['WORLD','WOR','OPEC','OECD'] for c in data['countries']))
 def test_balance_and_reserve_denominators(self):
  for c in data['countries']:
   for field in ['production','consumption','crude','ngl','reserves']:
    self.assertTrue(c[field] is None or (math.isfinite(c[field]) and c[field]>=0),(c['iso'],field))
   if c['production'] is None or c['consumption'] is None:self.assertIsNone(c['balance'])
   else:self.assertAlmostEqual(c['balance'],c['production']-c['consumption'])
   if c['reserves'] is not None:self.assertEqual(c['reserveYear'],2024)
   if c['yearsConsumption'] is not None:self.assertAlmostEqual(c['yearsConsumption'],c['reserves']*1000/(c['consumption']*365))
   if c['yearsProduction'] is not None:self.assertAlmostEqual(c['yearsProduction'],c['reserves']*1000/(c['crude']*365))
  if 'CAN' in by:
   self.assertEqual(by['CAN']['reserves'],4.344);self.assertIsNone(by['CAN']['yearsProduction']);self.assertIsNone(by['CAN']['yearsConsumption'])
 def test_actual_trade_direction_and_units(self):
  trade=json.loads((ROOT/'data/trade.json').read_text())
  self.assertEqual(trade['year'],2024);self.assertEqual(trade['unit'],'million tonnes per year')
  sample=next(t for t in trade['flows'] if t['fromCode']=='Saudi Arabia' and t['toCode']=='China')
  self.assertAlmostEqual(sample['value'],78.638772617)
  self.assertTrue(all(t['fromCode']!='Total' and t['toCode']!='Total' for t in trade['flows']))
  self.assertEqual(trade['flows'],sorted(trade['flows'],key=lambda t:-t['value']))
if __name__=='__main__':unittest.main()
