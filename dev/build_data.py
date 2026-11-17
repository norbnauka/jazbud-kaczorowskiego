"""Builds src/data.js from the scraped snapshot (data/units.txt + data/hulls.txt)."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))

def klatka(n):
    if n <= 69: return 1
    if n <= 161: return 2
    if n <= 230: return 3
    if n <= 341: return 4
    return 5

units = []
for line in open(os.path.join(HERE, 'data/units.txt')):
    p = line.strip().split('/')
    if len(p) < 5:
        continue
    n = int(p[0])
    u = dict(n=n, a=float(p[1]), f=int(p[2]), r=int(p[3]), s=p[4], k=klatka(n))
    if u['s'] != 'S':
        u['p'] = int(p[5]); u['m'] = int(p[6]); u['t'] = p[7]
        hist = []
        if len(p) > 8 and p[8]:
            for h in p[8].split(','):
                d, v = h.split(':')
                yy, mm, dd = int(d[:2]), int(d[2:4]), int(d[4:6])
                if not (1 <= mm <= 12 and 1 <= dd <= 31 and 24 <= yy <= 26):
                    continue
                hist.append([f'20{yy:02d}-{mm:02d}-{dd:02d}', int(v)])
        hist.sort()
        u['h'] = hist
    units.append(u)

hulls = {}
for line in open(os.path.join(HERE, 'data/hulls.txt')):
    n, h = line.strip().split(':')
    hulls[int(n)] = [list(map(int, q.split(','))) for q in h.split(';')]

def convex(points):
    pts = sorted(set(map(tuple, points)))
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for q in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    return [list(q) for q in lo[:-1] + up[:-1]]

# Floor 11 penthouses have no catalogue card; place them above the matching stack (approximation).
hulls[160] = hulls[153]
hulls[161] = hulls[154]
hulls[341] = convex(hulls[335] + hulls[336])

for u in units:
    u['g'] = hulls.get(u['n'])
    if u['n'] in (160, 161, 341):
        u['approx'] = 1

th = {}
for t in open(os.path.join(HERE, 'data/thumbs_raw.txt')).read().split():
    n, v = t.split(':'); th[int(n)] = v[2:]
for u in units:
    if u['n'] in th: u['th'] = th[u['n']]

missing = [u['n'] for u in units if not u['g']]
assert not missing, missing

stats = dict(total=len(units),
             D=sum(u['s'] == 'D' for u in units),
             R=sum(u['s'] == 'R' for u in units),
             S=sum(u['s'] == 'S' for u in units))
print(stats)
os.makedirs(os.path.join(HERE, 'src'), exist_ok=True)
with open(os.path.join(HERE, 'src/data.js'), 'w') as f:
    f.write('// Snapshot of jaz-bud.pl, ul. Kaczorowskiego 1 budynek 1 (17.11.2026)\n')
    f.write('window.UNITS=' + json.dumps(units, separators=(',', ':'), ensure_ascii=False) + ';\n')
print(os.path.getsize(os.path.join(HERE, 'src/data.js')))
