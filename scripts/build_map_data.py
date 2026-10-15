"""
LAST BEACON: build the offline map extract and routing graph from an OpenStreetMap file.

Input : an .osm.pbf extract that covers Monaco (default: scripts/monaco.osm.pbf,
        the OSRM project's Monaco test extract, a 2016 OpenStreetMap snapshot).
Output: public/map/basemap.json  -> vector base map rendered by Leaflet when offline
        src/data/graph.json      -> routing graph (real street network, contracted)

Map data (c) OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright

Usage:  pip install osmium networkx shapely
        python3 scripts/build_map_data.py [path/to/file.osm.pbf]
Deterministic: same input file produces byte-identical output.
"""
import json, math, sys, hashlib, os
import osmium, networkx as nx
from shapely.geometry import LineString, Polygon, box, mapping
from shapely.ops import linemerge, split, unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PBF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'scripts', 'monaco.osm.pbf')
# Demonstration area (lat/lng). Everything outside is dropped.
S, W, N, E = 43.7245, 7.4085, 43.7475, 7.4385
R = 5  # coordinate decimals (~1 m)

WALK_EXCLUDE = {'motorway', 'motorway_link', 'construction', 'proposed', 'raceway', 'bus_guideway', 'corridor', 'elevator', 'platform'}

def inside(lat, lon): return S <= lat <= N and W <= lon <= E
def rnd(x): return round(x, R)
def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 6371000*2*math.asin(math.sqrt(h))

class H(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.ways = []; s.pois = []
    def node(s, n):
        t = dict(n.tags)
        if t and inside(n.location.lat, n.location.lon):
            s.pois.append({'id': n.id, 'lat': n.location.lat, 'lon': n.location.lon, 'tags': t})
    def way(s, w):
        t = dict(w.tags)
        try: coords = [(nd.lat, nd.lon, nd.ref) for nd in w.nodes]
        except Exception: return
        if not any(inside(a, b) for a, b, _ in coords): return
        s.ways.append({'id': w.id, 'tags': t, 'coords': coords})

h = H(); h.apply_file(PBF, locations=True)
ways = sorted(h.ways, key=lambda w: w['id']); pois = sorted(h.pois, key=lambda p: p['id'])
bbox_poly = box(W, S, E, N)

# ---------------------------------------------------------------- base map
def clip_line(coords):
    ls = LineString([(c[1], c[0]) for c in coords]).intersection(bbox_poly)
    parts = [ls] if ls.geom_type == 'LineString' else list(getattr(ls, 'geoms', []))
    return [[[rnd(y), rnd(x)] for x, y in p.coords] for p in parts if p.geom_type == 'LineString' and len(p.coords) > 1]

def poly(coords, tol=0.000012):
    if len(coords) < 4 or coords[0][2] != coords[-1][2]: return None
    p = Polygon([(c[1], c[0]) for c in coords])
    if not p.is_valid: p = p.buffer(0)
    p = p.intersection(bbox_poly).simplify(tol)
    if p.is_empty: return None
    geoms = [p] if p.geom_type == 'Polygon' else [g for g in getattr(p, 'geoms', []) if g.geom_type == 'Polygon']
    return [[[rnd(y), rnd(x)] for x, y in g.exterior.coords] for g in geoms if g.area > 2e-10]

buildings, parks, water, roads, piers = [], [], [], [], []
coast = []
for w in ways:
    t = w['tags']
    if 'building' in t:
        p = poly(w['coords']); buildings += p or []
    elif t.get('leisure') in ('park', 'garden', 'pitch', 'stadium') or t.get('landuse') in ('grass', 'park', 'recreation_ground') or t.get('natural') in ('wood', 'scrub'):
        p = poly(w['coords']); parks += p or []
    elif t.get('natural') == 'water':
        p = poly(w['coords']); water += p or []
    elif t.get('natural') == 'coastline':
        coast.append(LineString([(c[1], c[0]) for c in w['coords']]))
    elif t.get('man_made') in ('pier', 'breakwater'):
        for g in clip_line(w['coords']): piers.append(g)
    elif 'highway' in t and t['highway'] not in ('proposed', 'construction'):
        hw = t['highway']
        cls = 'major' if hw in ('primary', 'secondary', 'trunk', 'primary_link', 'secondary_link', 'motorway', 'motorway_link') else \
              'minor' if hw in ('tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'tertiary_link') else \
              'steps' if hw == 'steps' else 'path'
        for g in clip_line(w['coords']):
            roads.append({'c': cls, 't': 1 if t.get('tunnel') in ('yes', 'building_passage') else 0, 'g': g})

# Land polygon from the coastline (OSM convention: land is on the LEFT of the coastline direction).
land = None
try:
    merged = linemerge(coast)
    pieces = split(bbox_poly, merged)
    best = None
    for pc in pieces.geoms:
        # sample: take a coastline segment touching this piece and test side
        score = 0
        for line in (merged.geoms if hasattr(merged, 'geoms') else [merged]):
            cs = list(line.coords)
            for i in range(0, len(cs)-1, max(1, len(cs)//20)):
                (x1, y1), (x2, y2) = cs[i], cs[i+1]
                mx, my = (x1+x2)/2, (y1+y2)/2
                nx_, ny_ = -(y2-y1), (x2-x1)  # left normal
                l = math.hypot(nx_, ny_) or 1
                from shapely.geometry import Point
                pt = Point(mx + nx_/l*0.00004, my + ny_/l*0.00004)
                if pc.contains(pt): score += 1
                pt2 = Point(mx - nx_/l*0.00004, my - ny_/l*0.00004)
                if pc.contains(pt2): score -= 1
        if score > 0:
            best = pc if best is None else best.union(pc)
    if best is not None:
        best = best.simplify(0.00001)
        gs = [best] if best.geom_type == 'Polygon' else list(best.geoms)
        land = [[[rnd(y), rnd(x)] for x, y in g.exterior.coords] for g in gs]
except Exception as ex:
    print('land polygon failed:', ex)

# Street labels: longest clipped part of each named major/minor street
label_src = {}
for w in ways:
    t = w['tags']; nm = t.get('name')
    if not nm or 'highway' not in t or t.get('tunnel') == 'yes': continue
    if t['highway'] not in ('primary', 'secondary', 'tertiary', 'residential', 'pedestrian', 'unclassified', 'living_street'): continue
    for g in clip_line(w['coords']):
        L = sum(hav(g[i], g[i+1]) for i in range(len(g)-1))
        if L > label_src.get(nm, (0,))[0]: label_src[nm] = (L, g, t['highway'])
labels = []
for nm, (L, g, hw) in sorted(label_src.items()):
    if L < 90: continue
    # midpoint along the line
    acc, half = 0, L/2
    for i in range(len(g)-1):
        d = hav(g[i], g[i+1])
        if acc + d >= half:
            f = (half-acc)/d if d else 0
            lat = g[i][0] + (g[i+1][0]-g[i][0])*f; lng = g[i][1] + (g[i+1][1]-g[i][1])*f
            dx = (g[i+1][1]-g[i][1])*math.cos(math.radians(lat)); dy = g[i+1][0]-g[i][0]
            ang = -math.degrees(math.atan2(dy, dx))
            if ang > 90: ang -= 180
            if ang < -90: ang += 180
            labels.append({'t': nm, 'lat': rnd(lat), 'lng': rnd(lng), 'a': round(ang), 'z': 16 if hw in ('primary', 'secondary') else 17})
            break
        acc += d
places = [{'t': p['tags']['name'], 'lat': rnd(p['lat']), 'lng': rnd(p['lon'])} for p in pois
          if p['tags'].get('place') in ('suburb', 'neighbourhood', 'quarter') and p['tags'].get('name')]
places += [{'t': 'Port Hercule', 'lat': 43.73526, 'lng': 7.42516}]

basemap = {
    'meta': {'source': 'OpenStreetMap contributors (ODbL 1.0)', 'snapshot': '2016-03 extract (OSRM Monaco test file)',
             'area': 'Monaco: Fontvieille to Larvotto', 'bbox': [S, W, N, E]},
    'land': land, 'buildings': buildings, 'parks': parks, 'water': water, 'piers': piers, 'roads': roads,
    'labels': labels, 'places': places,
}

# ---------------------------------------------------------------- routing graph
G = nx.Graph()
for w in ways:
    t = w['tags']; hw = t.get('highway')
    if not hw or hw in WALK_EXCLUDE: continue
    if t.get('foot') == 'no' or (t.get('access') in ('private', 'no') and t.get('foot') not in ('yes', 'designated')): continue
    if t.get('area') == 'yes': continue
    cs = w['coords']
    for i in range(len(cs)-1):
        a, b = cs[i], cs[i+1]
        if not (inside(a[0], a[1]) and inside(b[0], b[1])): continue
        if a[2] == b[2]: continue
        G.add_node(a[2], lat=a[0], lng=a[1]); G.add_node(b[2], lat=b[0], lng=b[1])
        G.add_edge(a[2], b[2], len=hav(a, b), hw=hw, name=t.get('name', ''), tunnel=t.get('tunnel') == 'yes', way=w['id'])
G = G.subgraph(max(nx.connected_components(G), key=len)).copy()

# Contract degree-2 chains into single edges with geometry
keep = {n for n in G.nodes if G.degree(n) != 2}
if not keep: keep = {next(iter(G.nodes))}
visited = set(); chains = []
for s in sorted(keep):
    for nb in sorted(G.neighbors(s)):
        if (s, nb) in visited: continue
        path = [s, nb]; visited.add((s, nb)); visited.add((nb, s))
        while path[-1] not in keep:
            cur = path[-1]; nxt = [x for x in G.neighbors(cur) if x != path[-2]]
            if not nxt: break
            path.append(nxt[0]); visited.add((cur, nxt[0])); visited.add((nxt[0], cur))
        chains.append(path)

node_ids = {}
def nid(osm):
    if osm not in node_ids: node_ids[osm] = 'n%d' % len(node_ids)
    return node_ids[osm]
for k in sorted(keep): nid(k)

def det(seed, lo, hi):
    v = int(hashlib.sha1(seed.encode()).hexdigest()[:8], 16) / 0xffffffff
    return lo + (hi-lo)*v

edges = []; seen_pairs = set()
for path in chains:
    a, b = path[0], path[-1]
    if a == b: continue
    segs = [(path[i], path[i+1]) for i in range(len(path)-1)]
    L = sum(G.edges[u, v]['len'] for u, v in segs)
    if L < 0.5: continue
    by_hw = {}; by_name = {}
    steps = sum(G.edges[u, v]['len'] for u, v in segs if G.edges[u, v]['hw'] == 'steps')
    tun = sum(G.edges[u, v]['len'] for u, v in segs if G.edges[u, v]['tunnel'])
    for u, v in segs:
        e = G.edges[u, v]; by_hw[e['hw']] = by_hw.get(e['hw'], 0) + e['len']
        if e['name']: by_name[e['name']] = by_name.get(e['name'], 0) + e['len']
    hw = max(sorted(by_hw), key=lambda k: by_hw[k]); name = max(sorted(by_name), key=lambda k: by_name[k]) if by_name else ''
    key = tuple(sorted((a, b))) + (round(L),)
    if key in seen_pairs: continue
    seen_pairs.add(key)
    eid = 'e%d' % len(edges)
    edges.append({'id': eid, 'a': nid(a), 'b': nid(b), 'len': round(L, 1), 'hw': hw, 'name': name,
                  'steps': round(steps / L, 2), 'tunnel': round(tun / L, 2),
                  'g': [[rnd(G.nodes[p]['lat']), rnd(G.nodes[p]['lng'])] for p in path]})

nodes = [{'id': i, 'lat': rnd(G.nodes[o]['lat']), 'lng': rnd(G.nodes[o]['lng'])} for o, i in sorted(node_ids.items(), key=lambda x: int(x[1][1:]))]
node_by_id = {n['id']: n for n in nodes}

def nearest_node(lat, lng, pred=lambda n: True):
    best = None
    for n in nodes:
        if not pred(n): continue
        d = hav((lat, lng), (n['lat'], n['lng']))
        if best is None or d < best[0]: best = (d, n)
    return best

# Edge knowledge: deterministic, documented. See src/routing/uncertainty.ts for how it is used.
for e in edges:
    major = e['hw'] in ('primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link')
    street = e['hw'] in ('residential', 'unclassified', 'living_street', 'pedestrian')
    if major: e['know'] = 'known'; e['age'] = round(det(e['id'] + 'a', 25, 140))
    elif street: e['know'] = 'known'; e['age'] = round(det(e['id'] + 'a', 60, 360))
    else: e['know'] = 'unexplored'; e['age'] = None
    e['statusKnown'] = major or (street and det(e['id'] + 's', 0, 1) > 0.25)

# --- Scenario landmarks (real places; scenario roles are fictional) ---
SHELTER = (43.72800, 7.41760, 'Fontvieille Shelter', 'Caserne de Fontvieille block')
SETTLEMENT = (43.74350, 7.43200, 'Larvotto Settlement', 'Grimaldi Forum, fortified evacuation point')
MARKET = (43.73253, 7.41905, "Place d'Armes Market Crossing", 'Marché de la Condamine')

def add_virtual(prefix, lat, lng, name, attach, lbl):
    vid = prefix
    nodes.append({'id': vid, 'lat': rnd(lat), 'lng': rnd(lng), 'name': name})
    out = []
    for i, n in enumerate(attach):
        L = hav((lat, lng), (n['lat'], n['lng']))
        eid = '%s-%d' % (prefix, i)
        edges.append({'id': eid, 'a': vid, 'b': n['id'], 'len': round(max(L, 20), 1), 'hw': 'footway', 'name': lbl,
                      'steps': 0, 'tunnel': 0, 'g': [[rnd(lat), rnd(lng)], [n['lat'], n['lng']]],
                      'know': 'verified', 'age': 15, 'statusKnown': True})
        out.append(eid)
    return out

major_ids = set()
for e in edges:
    if e['hw'] in ('primary', 'secondary', 'tertiary', 'residential', 'pedestrian', 'unclassified'):
        major_ids.add(e['a']); major_ids.add(e['b'])
_, exit_node = nearest_node(SHELTER[0], SHELTER[1], lambda n: n['id'] in major_ids)
exit_node['name'] = 'Shelter Exit Point'
add_virtual('shelter', SHELTER[0], SHELTER[1], SHELTER[2], [exit_node], 'Shelter exit corridor')

cands = sorted(((hav((SETTLEMENT[0], SETTLEMENT[1]), (n['lat'], n['lng'])), n['id']) for n in nodes if n['id'] in major_ids))
gates = [node_by_id[cands[0][1]]]
for d, i in cands[1:]:
    if hav((gates[0]['lat'], gates[0]['lng']), (node_by_id[i]['lat'], node_by_id[i]['lng'])) > 70:
        gates.append(node_by_id[i]); break
for gi, g in enumerate(gates): g['name'] = 'Settlement Gate ' + 'AB'[gi]
add_virtual('settlement', SETTLEMENT[0], SETTLEMENT[1], SETTLEMENT[2], gates, 'Settlement checkpoint lane')
_, market_node = nearest_node(MARKET[0], MARKET[1], lambda n: n['id'] in major_ids)
market_node['name'] = MARKET[2]

# Edges near the shelter were scouted this morning -> verified
for e in edges:
    a = node_by_id.get(e['a']) or next(n for n in nodes if n['id'] == e['a'])
    if hav((a['lat'], a['lng']), (SHELTER[0], SHELTER[1])) < 280 and e['know'] != 'verified':
        e['know'] = 'verified'; e['age'] = round(det(e['id'] + 'v', 10, 40)); e['statusKnown'] = True

# Amenities from real OSM POIs, attached to nearest graph node (scenario quantities are fictional, deterministic)
amen = []
def attach(lat, lng):
    r = nearest_node(lat, lng, lambda n: not n['id'] in ('shelter', 'settlement'))
    return r if r and r[0] <= 90 else None
for p in pois:
    t = p['tags']; a = t.get('amenity'); sh = t.get('shop')
    typ = 'water' if a in ('drinking_water', 'fountain') else 'medical' if a in ('pharmacy', 'hospital', 'clinic') else \
          'food' if sh in ('supermarket', 'convenience', 'bakery') or a == 'marketplace' else None
    if not typ: continue
    r = attach(p['lat'], p['lon'])
    if not r: continue
    seed = 'poi%d' % p['id']
    sup = {'water': {'water': round(det(seed, 2, 6))}, 'food': {'food': round(det(seed, 1, 4))},
           'medical': {'medkits': round(det(seed, 1, 3))}}[typ]
    nm = t.get('name') or {'water': 'Public fountain', 'food': 'Food store', 'medical': 'Pharmacy'}[typ]
    amen.append({'id': 'am-%d' % p['id'], 'type': typ, 'name': nm, 'lat': rnd(p['lat']), 'lng': rnd(p['lon']),
                 'node': r[1]['id'], 'supplies': sup, 'ageMin': round(det(seed + 't', 40, 600)),
                 'notes': 'OSM: ' + (a or sh)})
# Two scenario safehouses at real buildings
for sid, lat, lng, nm, note in [('safe-moneghetti', 43.73810, 7.41758, 'Moneghetti Safehouse', 'Place des Moneghetti, rest stop, 1 sealed water drum'),
                                ('safe-port', 43.73480, 7.42350, 'Port Hercule Safehouse', 'Harbour office, rest stop, ration crate')]:
    r = attach(lat, lng)
    amen.append({'id': sid, 'type': 'safehouse', 'name': nm, 'lat': lat, 'lng': lng, 'node': r[1]['id'],
                 'supplies': {'water': 2, 'food': 2}, 'ageMin': 90, 'notes': note})

graph = {
    'meta': {'source': 'OpenStreetMap contributors (ODbL 1.0)', 'snapshot': '2016-03 extract (OSRM Monaco test file)',
             'bbox': [S, W, N, E], 'version': hashlib.sha1(json.dumps([len(nodes), len(edges)]).encode()).hexdigest()[:8]},
    'nodes': nodes, 'edges': edges, 'amenities': amen,
    'landmarks': {'shelter': 'shelter', 'exit': exit_node['id'], 'settlement': 'settlement',
                  'gates': [g['id'] for g in gates], 'market': market_node['id']},
}
graph['meta']['version'] = hashlib.sha1(json.dumps(graph, sort_keys=True).encode()).hexdigest()[:8]

os.makedirs(os.path.join(ROOT, 'public', 'map'), exist_ok=True); os.makedirs(os.path.join(ROOT, 'src', 'data'), exist_ok=True)
json.dump(basemap, open(os.path.join(ROOT, 'public', 'map', 'basemap.json'), 'w'), separators=(',', ':'))
json.dump(graph, open(os.path.join(ROOT, 'src', 'data', 'graph.json'), 'w'), separators=(',', ':'))
print('nodes', len(nodes), 'edges', len(edges), 'amenities', len(amen), 'buildings', len(buildings), 'roads', len(roads),
      'labels', len(labels), 'land', bool(land), 'gates', [g['id'] for g in gates], 'exit', exit_node['id'], 'market', market_node['id'])
