"""Reproduce the pinned Egypt excerpt from the exact original annual CSV, offline."""
import argparse,csv,hashlib,io,json
from pathlib import Path
from source_extract import ROOT,RAW
def extract(path):
 lock=json.loads((ROOT/'scripts/source-lock.json').read_text());fn='jodi-EGY-products-2025.csv'
 if hashlib.sha256(path.read_bytes()).hexdigest()!=lock['metadata'][fn]['fullCsvSha256']:raise ValueError('JODI annual edition changed')
 rows=[]
 for i,row in enumerate(csv.DictReader(path.open()),2):
  if row['REF_AREA']=='EG' and row['UNIT_MEASURE']=='KTONS' and row['ENERGY_PRODUCT'] in {'GASOLINE','GASDIES','TOTPRODS'} and row['FLOW_BREAKDOWN'] in {'REFGROUT','TOTDEMO','TOTIMPSB','TOTEXPSB'}:rows.append(dict(sourceRow=i,**row))
 if len(rows)!=144:raise ValueError('Country/product/period subset changed')
 output=io.StringIO();writer=csv.DictWriter(output,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
 payload=output.getvalue().encode()
 if hashlib.sha256(payload).hexdigest()!=lock['files'][fn] or payload!=(RAW/fn).read_bytes():raise ValueError('Country excerpt differs from original annual rows')
 return len(rows)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('annual_csv',type=Path);args=p.parse_args();print('VERIFIED ORIGINAL CSV SUBSET',extract(args.annual_csv))
