"""Turn rendered frames into web assets: WebP images + per-unit SVG polygons (from ID masks)."""
import cv2, json, numpy as np, os, sys
from PIL import Image
SRC, DST = sys.argv[1], sys.argv[2]
os.makedirs(DST, exist_ok=True)
frames = []
i = 0
while os.path.exists(os.path.join(SRC, f'beauty_{i:02d}.jpg')) and os.path.exists(os.path.join(SRC, f'mask_{i:02d}.png')):
    im = Image.open(os.path.join(SRC, f'beauty_{i:02d}.jpg')).convert('RGB')
    im.save(os.path.join(DST, f'f{i:02d}.webp'), 'WEBP', quality=80, method=6)
    im.resize((im.width // 4, im.height // 4), Image.LANCZOS).save(os.path.join(DST, f't{i:02d}.webp'), 'WEBP', quality=60)
    m = cv2.imread(os.path.join(SRC, f'mask_{i:02d}.png'))[:, :, ::-1].astype(np.int32)
    ids = m[:, :, 0] + 256 * m[:, :, 1]; ids[m[:, :, 2] != 128] = 0
    polys = {}
    for n in np.unique(ids):
        if n == 0: continue
        mk = (ids == n).astype(np.uint8)
        cs, _ = cv2.findContours(mk, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        d = []
        for c in cs:
            if cv2.contourArea(c) < 14: continue
            a = cv2.approxPolyDP(c, 0.9, True).reshape(-1, 2)
            if len(a) < 3: continue
            d.append('M' + ' '.join(f'{x},{y}' for x, y in a) + 'Z')
        if d: polys[int(n)] = ''.join(d)
    frames.append(polys)
    print('frame', i, len(polys), 'units')
    i += 1
W, H = Image.open(os.path.join(SRC, 'beauty_00.jpg')).size
json.dump({'w': W, 'h': H, 'n': len(frames), 'start': 122, 'step': 360 / 16, 'frames': frames}, open(os.path.join(DST, 'r360.json'), 'w'), separators=(',', ':'))
print('json kB', os.path.getsize(os.path.join(DST, 'r360.json')) // 1024)
