import email
import re
from pathlib import Path
import psycopg2

EML_DIR = Path('data/eml')
results = {'ok': 0, 'mismatch': []}

conn = psycopg2.connect(
    host='localhost', port=5432,
    dbname='tnbike_db', user='postgres', password='1'
)

for eml_file in sorted(EML_DIR.glob('*.eml')):
    with open(eml_file, 'rb') as f:
        msg = email.message_from_bytes(f.read())

    body = ''
    for part in msg.walk():
        if part.get_content_type() == 'text/plain':
            body = part.get_payload(decode=True).decode('utf-8', errors='replace')
            break

    so_m     = re.search(r'BH\d{2}\.\d{4}', body)
    mst_m    = re.search(r'MST\s*:\s*(\d{9,13})', body)
    total_m  = re.search(r'tr[ịi]\s*gi[áa]\s*([\d.,]+)\s*[đd]', body, re.IGNORECASE)

    so_email    = so_m.group(0) if so_m else None
    mst_email   = mst_m.group(1) if mst_m else None
    total_email = int(re.sub(r'[.,]', '', total_m.group(1))) if total_m else None

    if not so_email:
        continue

    cur = conn.cursor()
    cur.execute("""
        SELECT so.total_amount, c.tax_code
        FROM tnbike.sales_order so
        JOIN tnbike.customer c ON c.customer_code = so.customer_code
        WHERE so.so_number = %s
    """, (so_email,))
    row = cur.fetchone()
    cur.close()

    if row:
        total_db, mst_db = row
        issues = []
        if mst_email and mst_db and mst_email != mst_db:
            issues.append('MST: email={} db={}'.format(mst_email, mst_db))
        if total_email and abs(total_email - int(total_db)) > 200:
            issues.append('Total: email={} db={}'.format(total_email, int(total_db)))
        if issues:
            results['mismatch'].append({'so': so_email, 'issues': issues})
        else:
            results['ok'] += 1

conn.close()

print('OK      :', results['ok'])
print('Mismatch:', len(results['mismatch']))
for m in results['mismatch'][:20]:
    print(' ', m)
