"""A synthetic Qloo for the Pages parity tests: made-up places, never provider data.

fake_urlopen answers /search and /v2/insights the way the agent reads them, deterministically,
so the Python agent can fill a response cache that seed_kv.py then turns into KV entries.
"""
import hashlib
import io
import json
import math
import random
import uuid
from urllib.parse import parse_qs, urlsplit

NS = uuid.UUID('6f1c1c52-8d7e-4c3a-9a43-0d2f3b8a1e55')
CENTERS = {'williamsburg': (40.7081, -73.9571), 'seongsu': (37.5445, 127.0557)}
CATEGORY = 'urn:tag:category:place:'


def ident(text):
    return str(uuid.uuid5(NS, text)).upper()


def tag(tid, name):
    return {'id': tid, 'name': name, 'type': 'urn:tag'}


def unit(text):
    return int(hashlib.sha256(text.encode()).hexdigest()[:12], 16) / 16**12


# name, genre, kind tags, extra tags, description, price, address suffix
KINDS = [
    ('Trattoria', 'Italian restaurant', ['restaurant', 'italian_restaurant'], [], 'A family trattoria with a full bar.', 2),
    ('Wine Room', 'Wine bar', ['bar', 'wine_bar'], ['Lively'], 'An intimate wine bar.', 3),
    ('Pizza Co.', 'Pizza restaurant', ['restaurant'], ['Busy'], 'Slices and a raw bar on weekends.', 1),
    ('Gastro Arms', 'Gastropub', ['restaurant', 'gastropub'], ['Loud'], 'A neighborhood gastropub.', 2),
    ('Omakase Ten', 'Sushi restaurant', ['restaurant', 'japanese_restaurant'], [], 'Counter seating at the sushi bar.', 4),
    ('Noodle Lab', 'Ramen restaurant', ['restaurant'], ['Expensive'], 'Ramen and an aperitivo bar upstairs.', 2),
    ('Green Plate', 'Vegetarian restaurant', ['restaurant', 'vegetarian_restaurant'], ['Moderately expensive'], 'Plants only.', 2),
    ('Café Lumière', 'Cafe', ['cafe', 'coffee_shop'], [], 'A café’s espresso bar.', 1),
    ('Bar Ñandú', 'Latin American restaurant', ['restaurant'], [], 'Cocktails and small plates.', 3),
    ('Supper Club Nine', 'New American restaurant', ['restaurant'], [], 'A supper club with dinner shows.', 4),
    ('Steak & Co', 'Steakhouse', ['restaurant', 'steak_house'], [], 'Dry-aged steaks.', None),
    ('The Lounge', 'Cocktail lounge', ['lounge'], ['Loud'], 'A hookah lounge.', 3),
]


def places(area):
    lat0, lon0 = CENTERS[area]
    rng = random.Random(area)
    out = []
    for i in range(60 if area == 'williamsburg' else 30):
        base, genre, kinds, extra, text, price = KINDS[i % len(KINDS)]
        name = f'{base} {i}' if i >= len(KINDS) else base
        distance = rng.uniform(150, 5200)
        angle = rng.uniform(0, 2 * math.pi)
        lat = lat0 + distance * math.sin(angle) / 111000
        lon = lon0 + distance * math.cos(angle) / (111000 * math.cos(math.radians(lat0)))
        brooklyn = area != 'williamsburg' or i % 7 != 3
        tags = [tag(CATEGORY + k, k.replace('_', ' ').title()) for k in kinds]
        tags += [tag('urn:tag:genre:place:restaurant:' + genre.split()[0].lower(), genre)]
        if i % 9 != 5:
            tags.append(tag('urn:tag:dining_options:place:dinner', 'Dinner'))
        tags += [tag('urn:tag:ambience:qloo:' + x.lower().replace(' ', '_'), x) for x in extra]
        tags += [tag(f'urn:tag:offerings:place:dish_{(i * 3 + j) % 11}', f'Dish {(i * 3 + j) % 11}') for j in range(3)]
        if i % 5 == 0:
            tags.append(tag('urn:tag:offerings:place:vegetarian_options', 'Vegetarian options'))
        if i % 11 == 4:
            tags.append(tag('urn:tag:ambience:qloo:club_like', 'Club-like'))
        out.append({
            'entity_id': ident(f'{area}:{i}'), 'name': name, 'types': ['urn:entity:place'], 'subtype': 'urn:entity:place',
            'location': {'lat': round(lat, 6), 'lon': round(lon, 6)}, '_distance': distance,
            'properties': {'address': f'{i + 1} Example St, {"Brooklyn, NY 11211" if brooklyn else "New York, NY 10002"}',
                           'primary_genre': {'name': genre}, 'price_level': price, 'is_closed': i % 13 == 12,
                           'description': text, 'short_description': None},
            'popularity': round(unit(f'pop:{area}:{i}'), 6), 'tags': tags,
        })
    return out


PLACES = {area: places(area) for area in CENTERS}
BY_ID = {e['entity_id']: e for es in PLACES.values() for e in es}
# Rescoring leaves this place out, so a pool that holds it falls back to rank sums.
FLAKY = next(e['entity_id'] for e in sorted(PLACES['seongsu'], key=lambda e: e['_distance'])
             if 'restaurant' in e['properties']['primary_genre']['name'].lower() and not e['properties']['is_closed']
             and 'urn:tag:dining_options:place:dinner' in {t['id'] for t in e['tags']})


def search(query, kind, place):
    if kind == 'place' and query == "Joe's Pizza":
        # The last one repeats the third one's branch under another id, as Qloo does for one Joe's Pizza.
        return [{'entity_id': ident(f'joe:{k}'), 'name': "Joe's Pizza", 'types': ['urn:entity:place'],
                 'properties': {'address': f'{min(k, 2) + 10} Pizza Ave, Brooklyn, NY 1121{min(k, 2)}' if k != 3 else '13 Pizza Ave, Brooklyn, NY 11213'}} for k in range(5)]
    if query.startswith('Nobody'):
        return [{'entity_id': ident(f'{query}:{k}'), 'name': f'{query} {k}', 'types': ['urn:entity:' + kind]} for k in range(3)]
    if query.startswith('Nothing'):
        return []
    found = [{'entity_id': ident(f'{kind}:{query}'), 'name': query, 'types': ['urn:entity:' + kind], 'properties': {'short_description': 'A seed.'}}]
    found += [{'entity_id': ident(f'{kind}:{query}:{k}'), 'name': f'{query} ({k})', 'types': ['urn:entity:' + kind]} for k in range(2)]
    return found


def scored(entity, signal):
    out = {k: v for k, v in entity.items() if k != '_distance'}
    if signal:
        seeds = signal.split(',')
        out['query'] = {'affinity': round(unit(signal + entity['entity_id']), 6),
                        'explainability': {'signal.interests.entities': [{'entity_id': s, 'score': round(unit(s + entity['entity_id']), 4)} for s in seeds]}}
    return out


def insights(q):
    signal = q.get('signal.interests.entities', '')
    if 'filter.results.entities' in q:
        ids = [i for i in q['filter.results.entities'].split(',') if i != FLAKY]
        return [scored(BY_ID[i], signal) for i in ids if i in BY_ID]
    lon, lat = map(float, q['filter.location'][len('POINT('):-1].split())
    area = 'seongsu' if lon > 0 else 'williamsburg'
    wanted = set(q['filter.tags'].split(','))
    rows = [e for e in PLACES[area] if e['_distance'] <= int(q['filter.location.radius']) and wanted <= {t['id'] for t in e['tags']}]
    key = (lambda e: -unit(signal + e['entity_id'])) if signal else (lambda e: -e['popularity'])
    return [scored(e, signal) for e in sorted(rows, key=key)[:int(q['take'])]]


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def fake_urlopen(request, timeout=None):
    url = urlsplit(request.full_url)
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    if url.path == '/search':
        data = {'success': True, 'results': search(q['query'], q['types'].split(':')[-1], 'filter.location' in q)[:int(q['take'])]}
    else:
        data = {'success': True, 'results': {'entities': insights(q)}}
    return Response(json.dumps(data).encode())
