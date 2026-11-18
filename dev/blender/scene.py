"""Procedural, render-ready Blender scene of Kaczorowskiego 1 (building 1 + context).
Usage:  python scene.py <out_dir> <frame_from> <frame_to> [--test]
Renders for every orbit frame:  beauty_XX.jpg  and  mask_XX.png (unit IDs encoded in RGB)."""
import bpy, bmesh, json, math, random, sys, os, time
from mathutils import Vector
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely.ops import unary_union

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
F0 = int(sys.argv[2]) if len(sys.argv) > 2 else 0
F1 = int(sys.argv[3]) if len(sys.argv) > 3 else 0
TEST = '--test' in sys.argv
NFRAMES = 16
os.makedirs(OUT, exist_ok=True)

S, CX, CY = 0.215, 246, 224
GF, FH, SL = 4.6, 3.1, 0.3
UH = FH - SL
base = lambda f: GF + (f - 1) * FH
W = lambda X, Y: ((X - CX) * S, -(Y - CY) * S)
U = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'units.json')))

bpy.ops.wm.read_factory_settings(use_empty=True)
import addon_utils; addon_utils.enable('cycles', default_set=True)
sc = bpy.context.scene
rnd = random.Random(11)

# ------------------------------------------------------------------ materials
def mat(name, color, rough=0.5, metal=0.0, **kw):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    for k, v in kw.items(): b.inputs[k].default_value = v
    return m
def noisy(m, scale, c2, fac=0.5, bump=0.0):
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.inputs['Factor'].default_value = fac
    mx.inputs[6].default_value = b.inputs['Base Color'].default_value; mx.inputs[7].default_value = (*c2, 1)
    nt.links.new(nz.outputs['Fac'], mx.inputs['Factor']); nt.links.new(mx.outputs[2], b.inputs['Base Color'])
    if bump:
        bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = bump; nt.links.new(nz.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m
srgb = lambda h: tuple(((int(h[i:i+2], 16) / 255) ** 2.2) for i in (0, 2, 4))
M = {
  'glass': mat('glass', srgb('1c252c'), 0.04, 0.0, **{'Specular IOR Level': 0.9}),
  'shop': mat('shop', srgb('26303a'), 0.03, 0.0, **{'Specular IOR Level': 1.0}),
  'panel': mat('panel', srgb('3b3f45'), 0.42, 0.35),
  'white': mat('white', srgb('e8e6e1'), 0.55),
  'slab': mat('slab', srgb('efede8'), 0.6),
  'frame': mat('frame', srgb('2a2d31'), 0.35, 0.7),
  'rail': mat('rail', srgb('cfd8d6'), 0.03, 0.0, **{'Transmission Weight': 1.0, 'IOR': 1.45}),
  'interior': mat('interior', srgb('5a5550'), 0.9),
  'roof': noisy(mat('roof', srgb('6f8d4c'), 0.95), 2.5, srgb('8aa260'), 0.6, 0.3),
  'roofgrey': mat('roofgrey', srgb('b9b6af'), 0.85),
  'hvac': mat('hvac', srgb('5d6167'), 0.5, 0.4),
  'asphalt': noisy(mat('asphalt', srgb('5c5f63'), 0.9), 18, srgb('4c4f53'), 0.5),
  'walk': noisy(mat('walk', srgb('c9c5bd'), 0.8), 6, srgb('b8b3aa'), 0.4),
  'grass': noisy(mat('grass', srgb('557a35'), 0.95), 3, srgb('76924a'), 0.5, 0.2),
  'grass2': noisy(mat('grass2', srgb('476530'), 0.95), 0.6, srgb('6b8743'), 0.5, 0.2),
  'path': mat('path', srgb('d8d3c9'), 0.85),
  'city': mat('city', srgb('d9d6cf'), 0.8),
  'city2': mat('city2', srgb('b4b8bd'), 0.6, 0.1),
  'trunk': mat('trunk', srgb('5a4636'), 0.9),
  'line': mat('line', srgb('f2f2ee'), 0.7),
}
# leaves: colour varies per instance (Object Info > Random)
lv = mat('leaves', srgb('4d7234'), 0.85); nt = lv.node_tree
oi = nt.nodes.new('ShaderNodeObjectInfo'); ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (*srgb('2f5222'), 1); ramp.color_ramp.elements[1].color = (*srgb('6a8a3a'), 1)
nt.links.new(oi.outputs['Random'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
M['leaves'] = lv
# mask materials
black = bpy.data.materials.new('mask_black'); black.use_nodes = True; nb = black.node_tree.nodes; nb.remove(nb['Principled BSDF'])
em = nb.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (0, 0, 0, 1); black.node_tree.links.new(em.outputs[0], nb['Material Output'].inputs[0])
idm = bpy.data.materials.new('mask_id'); idm.use_nodes = True; ni = idm.node_tree.nodes; ni.remove(ni['Principled BSDF'])
e2 = ni.new('ShaderNodeEmission'); o2 = ni.new('ShaderNodeObjectInfo'); idm.node_tree.links.new(o2.outputs['Color'], e2.inputs['Color']); idm.node_tree.links.new(e2.outputs[0], ni['Material Output'].inputs[0])

# ------------------------------------------------------------------ collections
def coll(name):
    c = bpy.data.collections.new(name); sc.collection.children.link(c); return c
C_BEAUTY, C_OCC, C_MASK = coll('beauty_only'), coll('occluders'), coll('mask_only')

def obj_from_bm(name, bm, col, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    o = bpy.data.objects.new(name, me); col.objects.link(o); return o

def add_prism(bm, poly2d, z0, z1, mi=0, cap=True):
    """poly2d: list of world (x,y); returns nothing – adds a closed prism to bm"""
    if len(poly2d) < 3: return
    if Polygon(poly2d).exterior.is_ccw is False: poly2d = poly2d[::-1]
    b = [bm.verts.new((x, y, z0)) for x, y in poly2d]; t = [bm.verts.new((x, y, z1)) for x, y in poly2d]
    n = len(poly2d)
    for i in range(n):
        f = bm.faces.new((b[i], b[(i + 1) % n], t[(i + 1) % n], t[i])); f.material_index = mi
    if cap:
        f = bm.faces.new(t); f.material_index = mi
        f = bm.faces.new(b[::-1]); f.material_index = mi

def world_poly(p):  # shapely polygon in plan px -> list of world xy (exterior only)
    return [W(x, y) for x, y in list(p.exterior.coords)[:-1]]
def prisms(bm, geom, z0, z1, mi=0):
    for q in parts(geom):
        if q.area > 1: add_prism(bm, world_poly(q), z0, z1, mi)
def parts(g):
    if g.is_empty: return []
    return list(g.geoms) if isinstance(g, MultiPolygon) else [g]

# ------------------------------------------------------------------ building 1 outlines per floor
def cen(u): return (sum(p[0] for p in u['g']) / len(u['g']), sum(p[1] for p in u['g']) / len(u['g']))
def grp(u):
    cx = cen(u)[0]
    if u['k'] == 2: return '2a' if cx < 82 else '2b'
    if u['k'] == 4: return '4a' if cx < 405 else '4b'
    return str(u['k'])
CONN = [('1', '2a', [(16, 262), (80, 262), (90, 280), (16, 280)]), ('2a', '2b', [(79, 133), (84, 123), (95, 158), (99, 177), (99, 202), (80, 210), (79, 168)]),
        ('2b', '3', [(176, 103), (185, 94), (185, 168), (176, 180)]), ('3', '4a', [(308, 64), (318, 55), (318, 134), (308, 146)]),
        ('4a', '4b', [(407, 36), (415, 25), (415, 124), (407, 124)]), ('4b', '5', [(413, 166), (477, 166), (477, 180), (413, 180)])]
floors = {}
for u in U: floors.setdefault(u['f'], {}).setdefault(grp(u), []).append(u)
def outline(f):
    if f not in floors: return Polygon()
    G = floors[f]; ps = []
    for g, lst in G.items():
        ps += [Polygon(u['g']).buffer(0) for u in lst]
        if len(lst) >= 3: ps.append(Polygon([cen(u) for u in lst]).convex_hull)
    for a, b, poly in CONN:
        if a in G and b in G: ps.append(Polygon(poly))
    return unary_union(ps).buffer(2.0, join_style=2).buffer(-2.0, join_style=2).buffer(0)
OUT_F = {f: outline(f) for f in range(1, 12)}
OUT_F[0] = OUT_F[1]

# facade strip along an outline: segments of glass / graphite / white + mullions
def facade(bm, poly, z0, z1, kind='flat'):
    for q in parts(poly): _facade(bm, q, z0, z1, kind)
def _facade(bm, poly, z0, z1, kind):
    ring = poly.exterior
    coords = list(ring.coords)
    if not ring.is_ccw: coords = coords[::-1]
    for i in range(len(coords) - 1):
        (x0, y0), (x1, y1) = coords[i], coords[i + 1]
        L = math.hypot(x1 - x0, y1 - y0) * S
        if L < 0.15: continue
        n = max(1, round(L / 1.35))
        for j in range(n):
            ax, ay = x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n
            bx, by = x0 + (x1 - x0) * (j + 1) / n, y0 + (y1 - y0) * (j + 1) / n
            mx, my = round((ax + bx) / 2 / 6), round((ay + by) / 2 / 6)
            h = (mx * 73856093 ^ my * 19349663) % 100
            mi = 0 if h < 58 else (1 if h < 88 else 2)  # glass / graphite / white (vertically coherent)
            if kind == 'shop': mi = 3
            pa, pb = W(ax, ay), W(bx, by)
            v = [bm.verts.new((pa[0], pa[1], z0)), bm.verts.new((pb[0], pb[1], z0)), bm.verts.new((pb[0], pb[1], z1)), bm.verts.new((pa[0], pa[1], z1))]
            f = bm.faces.new(v); f.material_index = mi
            # mullion (thin vertical post) at the segment start
            dx, dy = (pb[0] - pa[0]), (pb[1] - pa[1]); ln = math.hypot(dx, dy) or 1; ux, uy = dx / ln, dy / ln; nx, ny = uy, -ux
            w, d = 0.05, 0.12
            c = [(pa[0] - ux * w + nx * 0.0, pa[1] - uy * w + ny * 0.0), (pa[0] + ux * w, pa[1] + uy * w), (pa[0] + ux * w + nx * d, pa[1] + uy * w + ny * d), (pa[0] - ux * w + nx * d, pa[1] - uy * w + ny * d)]
            add_prism(bm, c, z0, z1, mi=4, cap=False)

def railing(bm, poly, z0, h=1.05, near=None):
    for q in parts(poly): _railing(bm, q, z0, h, near)
PARA = []
def _railing(bm, poly, z0, h, near=None):
    coords = list(poly.exterior.coords)
    for i in range(len(coords) - 1):
        (x0, y0), (x1, y1) = coords[i], coords[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        if L * S < 0.3: continue
        n = max(1, int(L * S / 2.0))
        for j in range(n):
            ax, ay = x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n; bx, by = x0 + (x1 - x0) * (j + 1) / n, y0 + (y1 - y0) * (j + 1) / n
            glass = near is None or near.distance(Point((ax + bx) / 2, (ay + by) / 2)) < 7
            pa, pb = W(ax, ay), W(bx, by)
            if glass:
                bm.faces.new([bm.verts.new((pa[0], pa[1], z0)), bm.verts.new((pb[0], pb[1], z0)), bm.verts.new((pb[0], pb[1], z0 + h)), bm.verts.new((pa[0], pa[1], z0 + h))])
            else:
                PARA.append((pa, pb, z0))

t0 = time.time()
bm_fac, bm_plate, bm_rail, bm_int, bm_roof, bm_hvac = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
# ground floor (shops / entrances) + white band
for p in parts(OUT_F[1]):
    facade(bm_fac, p.buffer(-1.2, join_style=2), 0, GF - 0.5, 'shop')
    prisms(bm_int, (p.buffer(-2.5, join_style=2)), 0, GF, 0)
for f in range(1, 12):
    here, below = OUT_F[f], OUT_F[f - 1]
    plate = unary_union([here, below]).buffer(3.4, join_style=2) if not here.is_empty else below.buffer(1.2, join_style=2)
    z = base(f) - SL
    for p in parts(plate):
        prisms(bm_plate, (p), z, z + SL, 0)
        railing(bm_rail, p.buffer(-0.3, join_style=2), z + SL, near=here if not here.is_empty else Polygon([(-9e3, -9e3), (-9e3 + 1, -9e3), (-9e3, -9e3 + 1)]))
    for p in parts(here):
        facade(bm_fac, p.buffer(-1.0, join_style=2), base(f), base(f) + UH)
        prisms(bm_int, (p.buffer(-2.6, join_style=2)), base(f), base(f) + UH, 0)
    # roofs over the parts of this floor that have nothing above
    above = OUT_F.get(f + 1, Polygon())
    roof = here.difference(above.buffer(1.0)) if not here.is_empty else Polygon()
    for p in parts(roof.buffer(-1.5, join_style=2)):
        if p.area < 60: continue
        zr = base(f) + UH + SL
        prisms(bm_plate, (p.buffer(1.5 + 3.4, join_style=2)), zr - SL, zr, 0)
        prisms(bm_roof, (p.buffer(-2.0, join_style=2)), zr, zr + 0.12, 0)
        if p.area > 600:
            c = p.representative_point()
            for k in range(3):
                bx, by = c.x + rnd.uniform(-10, 10), c.y + rnd.uniform(-8, 8)
                sq = Polygon([(bx - 4, by - 3), (bx + 4, by - 3), (bx + 4, by + 3), (bx - 4, by + 3)])
                if p.buffer(-3).contains(sq): prisms(bm_hvac, (sq), zr, zr + rnd.uniform(1.2, 2.2), 0)
bm_par = bmesh.new()
for pa, pb, z0 in PARA:
    dx, dy = pb[0] - pa[0], pb[1] - pa[1]; ln = math.hypot(dx, dy) or 1; nx, ny_ = dy / ln * 0.1, -dx / ln * 0.1
    add_prism(bm_par, [(pa[0] - nx, pa[1] - ny_), (pb[0] - nx, pb[1] - ny_), (pb[0] + nx, pb[1] + ny_), (pa[0] + nx, pa[1] + ny_)], z0, z0 + 0.95, 0)
obj_from_bm('B1_parapet', bm_par, C_OCC, [M['white']])
b1 = [obj_from_bm('B1_facade', bm_fac, C_BEAUTY, [M['glass'], M['panel'], M['white'], M['shop'], M['frame']]),
      obj_from_bm('B1_plates', bm_plate, C_OCC, [M['slab']]),
      obj_from_bm('B1_rails', bm_rail, C_BEAUTY, [M['rail']]),
      obj_from_bm('B1_interior', bm_int, C_BEAUTY, [M['interior']]),
      obj_from_bm('B1_roof', bm_roof, C_OCC, [M['roof']]),
      obj_from_bm('B1_hvac', bm_hvac, C_OCC, [M['hvac']])]
print('building 1', round(time.time() - t0, 1), 's')

# ------------------------------------------------------------------ building 2 (context, same architecture)
bm_fac, bm_plate, bm_rail, bm_int, bm_roof = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
B2 = [(Polygon([(110, 494), (477, 494), (477, 608), (110, 608)]), 10), (Polygon([(30, 500), (110, 500), (110, 602), (30, 602)]), 7)]
for p, nf in B2:
    facade(bm_fac, p.buffer(-1.0, join_style=2), 0, GF - 0.5, 'shop'); prisms(bm_int, (p.buffer(-2.5, join_style=2)), 0, GF, 0)
    for f in range(1, nf + 1):
        z = base(f) - SL; prisms(bm_plate, (p.buffer(3.4, join_style=2)), z, z + SL, 0); railing(bm_rail, p.buffer(3.1, join_style=2), z + SL)
        facade(bm_fac, p.buffer(-1.0, join_style=2), base(f), base(f) + UH); prisms(bm_int, (p.buffer(-2.6, join_style=2)), base(f), base(f) + UH, 0)
    zr = base(nf) + UH + SL; prisms(bm_plate, (p.buffer(3.4, join_style=2)), zr - SL, zr, 0); prisms(bm_roof, (p.buffer(-2.0, join_style=2)), zr, zr + 0.12, 0)
obj_from_bm('B2_facade', bm_fac, C_OCC, [M['glass'], M['panel'], M['white'], M['shop'], M['frame']])
obj_from_bm('B2_plates', bm_plate, C_OCC, [M['slab']]); obj_from_bm('B2_rails', bm_rail, C_BEAUTY, [M['rail']])
obj_from_bm('B2_interior', bm_int, C_OCC, [M['interior']]); obj_from_bm('B2_roof', bm_roof, C_OCC, [M['roof']])

# ------------------------------------------------------------------ ground, streets, courtyard
def flat(name, poly_px, mat_, z=0.0, col=C_OCC):
    bm = bmesh.new(); pts = [W(x, y) for x, y in poly_px]
    if not Polygon(pts).exterior.is_ccw: pts = pts[::-1]
    bm.faces.new([bm.verts.new((x, y, z)) for x, y in pts]); return obj_from_bm(name, bm, col, [mat_])
ny = lambda X: 74 - 0.242 * (X - 15)
bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=900, segments=64); obj_from_bm('ground', bm, C_OCC, [M['grass2']])
flat('walk_n', [(-900, ny(-900) - 66), (1400, ny(1400) - 66), (1400, ny(1400) + 10), (-900, ny(-900) + 10)], M['walk'], 0.03)
flat('road_n', [(-900, ny(-900) - 56), (1400, ny(1400) - 56), (1400, ny(1400) - 4), (-900, ny(-900) - 4)], M['asphalt'], 0.06)
flat('line_n', [(-900, ny(-900) - 30.6), (1400, ny(1400) - 30.6), (1400, ny(1400) - 29.4), (-900, ny(-900) - 29.4)], M['line'], 0.07)
flat('walk_w', [(-80, ny(-80)), (-8, ny(-8)), (-8, 1000), (-80, 1000)], M['walk'], 0.035)
flat('road_w', [(-68, ny(-68)), (-20, ny(-20)), (-20, 1000), (-68, 1000)], M['asphalt'], 0.07)
flat('walk_e', [(486, ny(486)), (562, ny(562)), (562, 1000), (486, 1000)], M['walk'], 0.035)
flat('road_e', [(500, ny(500)), (548, ny(548)), (548, 1000), (500, 1000)], M['asphalt'], 0.07)
flat('walk_s', [(-68, 610), (548, 610), (548, 668), (-68, 668)], M['walk'], 0.04)
flat('road_s', [(-68, 618), (548, 618), (548, 660), (-68, 660)], M['asphalt'], 0.08)
flat('court', [(90, 205), (180, 185), (311, 150), (403, 178), (403, 470), (90, 470)], M['grass'], 0.05)
flat('court_path', [(180, 430), (330, 430), (330, 470), (180, 470)], M['path'], 0.07)
flat('site_walk', [(-8, 440), (486, 440), (486, 494), (-8, 494)], M['walk'], 0.045)
flat('site_walk2', [(-8, 608), (486, 608), (486, 612), (-8, 612)], M['walk'], 0.045)
# courtyard paths (an "X" like on the site plan)
for a, b in [((110, 220), (390, 440)), ((390, 200), (110, 440))]:
    ls = LineString([a, b]).buffer(6, cap_style=2); flat('cpath', list(ls.exterior.coords)[:-1], M['path'], 0.065)
# surrounding city blocks (simple masses) to give context like on the aerial photo
cityc = coll('city')
bmc = bmesh.new()
for i in range(150):
    ang = rnd.uniform(0, 2 * math.pi); r = rnd.uniform(520, 2200)
    X, Y = CX + math.cos(ang) * r, CY + math.sin(ang) * r
    if -150 < X < 700 and 560 < Y < 1150: continue   # keep the park south of the site free
    w, d, h = rnd.uniform(60, 160), rnd.uniform(50, 120), rnd.choice([9, 12, 15, 18, 24, 30, 36])
    rot = rnd.uniform(0, math.pi)
    pts = [(X + math.cos(rot) * sx - math.sin(rot) * sy, Y + math.sin(rot) * sx + math.cos(rot) * sy) for sx, sy in [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]]
    add_prism(bmc, [W(x, y) for x, y in pts], 0, h, 0 if rnd.random() < 0.7 else 1)
def city_mat(name, wall, glass):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); br = nt.nodes.new('ShaderNodeTexBrick')
    br.offset = 0.0; br.squash = 1.0
    br.inputs['Scale'].default_value = 1.0; br.inputs['Brick Width'].default_value = 3.2; br.inputs['Row Height'].default_value = 3.0; br.inputs['Mortar Size'].default_value = 0.95
    br.inputs['Color1'].default_value = (*srgb(glass), 1); br.inputs['Color2'].default_value = (*srgb(glass), 1); br.inputs['Mortar'].default_value = (*srgb(wall), 1)
    nt.links.new(tc.outputs['Object'], br.inputs['Vector'])
    geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.5
    nt.links.new(geo.outputs['Normal'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], gt.inputs[0])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.inputs[7].default_value = (*srgb('a9a7a2'), 1)
    nt.links.new(gt.outputs[0], mx.inputs['Factor']); nt.links.new(br.outputs['Color'], mx.inputs[6]); nt.links.new(mx.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    return m
obj_from_bm('city', bmc, C_OCC, [city_mat('cityA', 'd8d4cc', '3d4652'), city_mat('cityB', 'b9bdc2', '33404c')])

# ------------------------------------------------------------------ trees (instanced)
tree_col = bpy.data.collections.new('tree_src')
def make_tree(i, r):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        v.co *= 1 + 0.22 * math.sin(v.co.x * 5.1 + i) * math.cos(v.co.y * 4.3 + i * 2) + 0.12 * math.sin(v.co.z * 7 + i)
    bmesh.ops.scale(bm, vec=(r, r, r * 1.15), verts=bm.verts); bmesh.ops.translate(bm, vec=(0, 0, 3.2 + r), verts=bm.verts)
    crown = obj_from_bm(f'tree{i}', bm, tree_col, [M['leaves']])
    for p in crown.data.polygons: p.use_smooth = True
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.25, radius2=0.15, depth=3.6); bmesh.ops.translate(bm, vec=(0, 0, 1.8), verts=bm.verts)
    trunk = obj_from_bm(f'trunk{i}', bm, tree_col, [M['trunk']])
    return crown, trunk
TREES = [make_tree(i, r) for i, r in enumerate([2.6, 3.2, 3.8, 4.4, 3.0])]
spots = []
for X in range(-860, 1360, 24): spots.append((X + rnd.uniform(-4, 4), ny(X) - 74 - rnd.uniform(0, 12)))
for X in range(-860, 1360, 30): spots.append((X + rnd.uniform(-4, 4), ny(X) + 22)) if not (-20 < X < 500) else None
for Y in range(int(ny(-90)) + 30, 980, 22): spots.append((-92 - rnd.uniform(0, 8), Y))
for Y in range(int(ny(570)) + 30, 980, 22): spots.append((572 + rnd.uniform(0, 8), Y))
for i in range(260): spots.append((rnd.uniform(-860, 1360), rnd.uniform(690, 1400)))
for i in range(70): spots.append((rnd.uniform(-560, -110), rnd.uniform(100, 690)))
for i in range(70): spots.append((rnd.uniform(590, 1060), rnd.uniform(-60, 690)))
for i in range(40): spots.append((rnd.uniform(-860, 1360), rnd.uniform(-600, ny(0) - 120)))
for p in [(150, 260), (210, 300), (340, 255), (365, 340), (140, 400), (360, 415), (255, 405), (200, 360)]: spots.append(p)
for (X, Y) in spots:
    t = rnd.choice(TREES); s = rnd.uniform(0.8, 1.25); rot = rnd.uniform(0, 6.28)
    x, y = W(X, Y)
    for src in t:
        o = src.copy(); o.location = (x, y, 0); o.scale = (s, s, s); o.rotation_euler = (0, 0, rot); C_OCC.objects.link(o)
print('scene objects', len(bpy.data.objects), round(time.time() - t0, 1), 's')

# ------------------------------------------------------------------ unit ID volumes (mask pass only)
for u in U:
    bm = bmesh.new(); p = Polygon(u['g']).buffer(0.6, join_style=2)
    prisms(bm, (p), base(u['f']) + 0.02, base(u['f']) + UH - 0.02, 0)
    o = obj_from_bm(f"U{u['n']}", bm, C_MASK, [idm]); n = u['n']
    o.color = ((n & 255) / 255.0, ((n >> 8) & 255) / 255.0, 128 / 255.0, 1.0)

# ------------------------------------------------------------------ world, sun, camera
w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True; nt = w.node_tree
sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_elevation = math.radians(38); sky.sun_rotation = math.radians(215); sky.air_density = 1.0; sky.dust_density = 1.6; sky.sun_disc = False
nt.links.new(sky.outputs[0], nt.nodes['Background'].inputs[0]); nt.nodes['Background'].inputs['Strength'].default_value = 0.32
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.6; sun.angle = math.radians(1.2); sun.color = (1.0, 0.95, 0.88)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
so.rotation_euler = (math.radians(90 - 38), 0, math.radians(215 + 90))
cam = bpy.data.cameras.new('cam'); cam.lens = 34; cam.sensor_width = 36; cam.clip_end = 6000
co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
EXPO, SKY, SUN = -0.9, 0.45, 4.2
TARGET = Vector((0, -4, 14)); DIST, ELEV = 225, math.radians(31)
def place_cam(i):
    a = math.radians(122) + 2 * math.pi * i / NFRAMES      # frame 0 ≈ view from the north-west street corner
    co.location = TARGET + Vector((math.cos(a) * math.cos(ELEV), math.sin(a) * math.cos(ELEV), math.sin(ELEV))) * DIST
    d = (TARGET - co.location); co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# ------------------------------------------------------------------ render settings
R = sc.render; R.engine = 'CYCLES'; sc.cycles.device = 'CPU'
R.resolution_x, R.resolution_y = (960, 540) if TEST else (1600, 900); R.resolution_percentage = 100
R.use_persistent_data = True
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'; sc.view_settings.exposure = 0.15
def beauty_mode():
    C_BEAUTY.hide_render = False; C_MASK.hide_render = True
    sc.cycles.samples = 24 if TEST else 32; sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.03
    sc.cycles.use_denoising = True; sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 2; sc.cycles.glossy_bounces = 2; sc.cycles.transmission_bounces = 4; sc.cycles.transparent_max_bounces = 4
    sc.cycles.caustics_reflective = False; sc.cycles.caustics_refractive = False; sc.cycles.filter_width = 1.5
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'; sc.view_settings.exposure = EXPO
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = SKY; sun.energy = SUN
    R.image_settings.file_format = 'JPEG'; R.image_settings.quality = 88; R.dither_intensity = 1.0
    for o, mats in saved.items():
        for i, m in enumerate(mats): o.material_slots[i].material = m
def mask_mode():
    C_BEAUTY.hide_render = True; C_MASK.hide_render = False
    sc.cycles.samples = 1; sc.cycles.use_adaptive_sampling = False; sc.cycles.use_denoising = False; sc.cycles.filter_width = 0.01; sc.cycles.max_bounces = 0
    sc.view_settings.view_transform = 'Raw'; sc.view_settings.look = 'None'; sc.view_settings.exposure = 0
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0; sun.energy = 0
    R.image_settings.file_format = 'PNG'; R.image_settings.color_mode = 'RGB'; R.image_settings.color_depth = '8'; R.dither_intensity = 0.0
    for o in saved:
        for i in range(len(o.material_slots)): o.material_slots[i].material = black
saved = {}
for o in C_OCC.all_objects:
    if o.type == 'MESH': saved[o] = [s.material for s in o.material_slots]

frames = range(F0, F1 + 1)
for i in frames:
    place_cam(i)
    beauty_mode(); R.filepath = os.path.join(OUT, f'beauty_{i:02d}.jpg'); t = time.time(); bpy.ops.render.render(write_still=True); print('beauty', i, round(time.time() - t, 1), 's', flush=True)
    if not TEST or '--mask' in sys.argv:
        mask_mode(); R.filepath = os.path.join(OUT, f'mask_{i:02d}.png'); t = time.time(); bpy.ops.render.render(write_still=True); print('mask', i, round(time.time() - t, 1), 's', flush=True)
if '--save' in sys.argv: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'kaczorowskiego.blend'))
