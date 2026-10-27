"""Consensus on comparable per-person ranks, with auditable concessions."""
import math
import re

CATEGORY = 'urn:tag:category:place:'
DINNER = 'urn:tag:dining_options:place:dinner'
OCCASIONS = {'Dinner': [CATEGORY+'restaurant', DINNER], 'Cafe': [CATEGORY+'cafe'], 'Drinks': [CATEGORY+'bar']}

def tag_ids(e):
    return {t['id'] for t in e.get('tags', [])}

# A bar veto also covers Qloo's bar subtypes (wine_bar, cocktail_bar, irish_pub, brewpub ...), not only the plain tag.
# Places that only serve drinks (amenity tags such as full_bar) and non-drinking "bars" stay.
NOT_DRINKING = {'espresso_bar', 'coffee_bar', 'juice_bar', 'sushi_bar', 'salad_bar', 'snack_bar'}
FOOD_BARS = re.compile(r"\b(?:sushi|raw|juice|salad|snack|espresso|coffee|noodle|poke|omakase|yogurt) bars?\b|\bbar-?b-?q\b", re.I)

# Qloo's category tags miss some drinking places, so a veto also reads the place's name, Qloo's description of it
# and a few night-out tags. Each list names what the place is, never what it serves: "full bar" or "cocktails" alone keep a restaurant.
PUB_WORDS = r"(?:gastro)?pubs?|taverns?|saloons?|taprooms?|tap rooms?|beer halls?|beer gardens?|biergartens?|brewpubs?"
CLUB_WORDS = r"night ?clubs?|supper clubs?|dance halls?"
VENUE_NAMES = {
    'bar': re.compile(rf"\b(?:bars?|lounges?|speakeasy|{PUB_WORDS}|{CLUB_WORDS})\b", re.I),
    'pub': re.compile(rf"\b(?:{PUB_WORDS})\b", re.I),
    'nightclub': re.compile(rf"\b(?:{CLUB_WORDS})\b", re.I),
}
VENUE_TERMS = {
    'bar': re.compile(rf"\b(?:(?:aperitivo|cocktail|wine|beer|whiske?y|sake|mezcal|tequila|dive|sports|piano|tiki|karaoke|hookah|neighborhood) (?:bar|lounge)s?|bar (?:&|and) grill|speakeasy|hookah|{PUB_WORDS}|{CLUB_WORDS})\b", re.I),
    'pub': re.compile(rf"\b(?:{PUB_WORDS})\b", re.I),
    'nightclub': re.compile(rf"\b(?:{CLUB_WORDS})\b", re.I),
}
CLUB_TAGS = {'urn:tag:ambience:qloo:club_like', 'urn:tag:ambience:qloo:nightclub_energy', 'urn:tag:setting:qloo:supper_club', 'urn:tag:setting:qloo:dance_hall'}
VENUE_TAGS = {'bar': CLUB_TAGS | {'urn:tag:amenity:qloo:hookah', 'urn:tag:activity_type:qloo:hookah_smoking', 'urn:tag:activity_type:qloo:smoking_hookah'},
              'pub': set(), 'nightclub': CLUB_TAGS}

def venue_terms(text):
    """Drinking-venue phrases in Qloo's description of a place, e.g. 'aperitivo bar' or 'supper club'."""
    text = FOOD_BARS.sub(' ', text or '')
    return sorted({m.group(0).lower() for m in VENUE_TERMS['bar'].finditer(text)})

def place_kinds(e):
    kinds = set()
    for t in tag_ids(e):
        for prefix in (CATEGORY, 'urn:tag:genre:place:restaurant:', 'urn:tag:genre:place:'):
            if t.startswith(prefix):
                kinds.add(t[len(prefix):])
    return kinds - NOT_DRINKING

def is_kind(e, category):
    """bar: bar, any *_bar or bar_* kind, lounges, pubs, beer halls and nightclubs; pub: pubs and beer halls; nightclub: nightclub."""
    def match(k):
        if category == 'bar':return k in ('bar', 'lounge', 'nightclub', 'taproom', 'beer_hall', 'beer_garden') or k.endswith('_bar') or k.startswith('bar_') or k.endswith('pub')
        if category == 'pub':return k.endswith('pub') or k in ('taproom', 'beer_hall', 'beer_garden')
        return k == category or k.endswith('_'+category)
    return any(match(k) for k in place_kinds(e))

def venue_evidence(e, category):
    """Why a place counts as a bar, pub or nightclub: Qloo kind, genre, name, description or tag. Empty when it does not."""
    found = [k for k in sorted(place_kinds(e)) if is_kind({'tags':[{'id':CATEGORY+k}]}, category)]
    genre = FOOD_BARS.sub(' ', e.get('genre', ''))
    if VENUE_NAMES[category].search(genre):found.append('genre: '+e['genre'])
    name = FOOD_BARS.sub(' ', e.get('name', ''))
    if VENUE_NAMES[category].search(name):found.append('name: '+e['name'])
    found += ['described as '+t for t in e.get('venue_terms', []) if VENUE_TERMS[category].fullmatch(t)]
    found += ['tag '+t.rsplit(':', 1)[-1] for t in sorted(tag_ids(e) & VENUE_TAGS[category])]
    return found

def eligible(e, occasion, veto):
    tags = tag_ids(e)
    if not set(OCCASIONS[occasion]).issubset(tags):
        return False
    genre = e.get('genre', '').lower()
    if occasion == 'Dinner' and not any(x in genre for x in ('restaurant', 'ramen', 'noodle', 'sushi', 'barbecue', 'steak', 'pizza', 'diner', 'bistro')):
        return False
    if occasion == 'Cafe' and not any(x in genre for x in ('cafe', 'coffee')):
        return False
    if occasion == 'Drinks' and (not any(x in genre for x in ('bar', 'pub', 'nightclub', 'lounge', 'brewery')) or 'store' in genre):
        return False
    categories = set(veto.get('categories', [])) | ({'bar'} if veto.get('no_bars') else set())
    if any(venue_evidence(e, c) for c in categories):return False
    if {t['name'].casefold() for t in e.get('tags',[])} & {t.casefold() for t in veto.get('tags',[])}:return False
    if veto.get('vegetarian') and not tags & {'urn:tag:offerings:place:vegetarian_options','urn:tag:category:place:vegetarian_restaurant','urn:tag:genre:place:restaurant:vegetarian','urn:tag:amenity:qloo:vegetarian_options','urn:tag:dietary_option:qloo:vegetarian'}:return False
    if veto.get('max_price_level') and (not isinstance(e.get('price_level'),(int,float)) or not 0<e['price_level']<=veto['max_price_level']):return False
    return not e.get('closed') and e['id'] not in veto.get('excluded', [])

def ranked(rows):
    # Affinity only determines order within a single person's pool request.
    return sorted(rows, key=lambda e: (-e['affinity'], e['id']))

def consensus(pool, lists, method='maximin-rank', limit=10):
    ranks = [{e['id']: i+1 for i, e in enumerate(rows)} for rows in lists]
    n = max(len(pool), *(len(x) for x in lists)) + 1
    candidates = []
    for e in pool:
        rs = [r.get(e['id'], n) for r in ranks]
        if method == 'maximin-rank' and any(e['id'] not in r for r in ranks):
            continue
        candidates.append({**e, 'ranks': rs, 'worst_rank': max(rs), 'rank_sum': sum(rs), 'observed': [e['id'] in r for r in ranks]})
    key = (lambda e: (e['worst_rank'], e['rank_sum'], e['id'])) if method == 'maximin-rank' else (lambda e: (e['rank_sum'], e['worst_rank'], e['id']))
    return sorted(candidates, key=key)[:limit]

def concession(person, rows, pick, index):
    first = rows[0]
    rank = pick['ranks'][index]
    observed = pick['observed'][index]
    prefixes = ('urn:tag:genre:', 'urn:tag:category:', 'urn:tag:offerings:', 'urn:tag:dining_options:', 'urn:tag:ambience:', 'urn:tag:culinary_style:', 'urn:tag:service_type:', 'urn:tag:beverage_offering:')
    def descriptive(e):
        return {t['id']:t['name'] for t in e.get('tags', []) if not t['id'].startswith('urn:') or t['id'].startswith(prefixes)}
    first_tags = descriptive(first)
    pick_tags = descriptive(pick)
    removed = sorted({first_tags[k] for k in first_tags.keys()-pick_tags.keys()})[:3]
    added = sorted({pick_tags[k] for k in pick_tags.keys()-first_tags.keys()})[:3]
    seeds = ' and '.join(s['query'] for s in person['seeds'])
    text = f"People who like {seeds} tend toward {first['name']} in this pool. "
    if observed:
        text += ("The shared pick is also #1 for this taste signal. " if rank==1 else f"The shared pick is #{rank} for this taste signal: a {rank-1}-place drop from #1. ")
    else:
        text += 'The shared pick was absent from this signal’s returned list; its rank is unknown. '
    if removed or added:
        text += 'Tag difference: '+(', '.join(removed) or 'no unique tags')+' → '+(', '.join(added) or 'no unique tags')+'.'
    else:
        text += 'No tag difference is recorded.'
    scored=next((e for e in rows if e['id']==pick['id']),{})
    contributions=scored.get('contributions',[])
    return {'contributions':contributions, 'top_contributions':first.get('contributions',[]), 'person': person['name'], 'top': first['name'], 'rank': rank if observed else None, 'rank_drop': rank-1 if observed else None, 'removed_tags': removed, 'added_tags': added, 'text': text}

def complete_scores(pool, rows):
    expected = {e['id'] for e in pool}
    return len(rows) == len(expected) and {e['id'] for e in rows} == expected and all(isinstance(e.get('affinity'), (int,float)) and math.isfinite(e['affinity']) for e in rows)

def ambiguity(results, query):
    exact = [e for e in results if e['name'].casefold().strip() == query.casefold().strip()]
    return len(exact) != 1

def taste_contrast(picks, all_picks, popularity):
    """Ranks refer only to the returned eligible sample, never the whole neighborhood."""
    sample = sorted(popularity, key=lambda e: (-(e.get('popularity') or 0), e['id']))
    baseline = sample[:10]
    taste_ranks = {e['id']: i+1 for i,e in enumerate(all_picks)}
    pop_ranks = {e['id']: i+1 for i,e in enumerate(sample)}
    taste_ids = {e['id'] for e in picks}
    baseline_ids = {e['id'] for e in baseline}
    rows = []
    for e in {e['id']:e for e in picks+baseline}.values():
        rows.append({**e, 'taste_rank':taste_ranks.get(e['id']), 'popularity_rank':pop_ranks.get(e['id']),
                     'change':'shared' if e['id'] in taste_ids & baseline_ids else ('added' if e['id'] in taste_ids else 'removed')})
    pick = picks[0]
    return baseline, {'overlap':len(taste_ids & baseline_ids),
        'top3_overlap':len({e['id'] for e in picks[:3]} & {e['id'] for e in baseline[:3]}),
        'taste_count':len(picks), 'baseline_count':len(baseline), 'sample_count':len(sample),
        'pick_popularity_rank':pop_ranks.get(pick['id']), 'rows':rows}


def concession_table(people, lists, baseline, pick):
    """Every cell uses the same observed per-person candidate ranking."""
    ranks=[{e['id']:i+1 for i,e in enumerate(rows)} for rows in lists]
    rows=[]
    def add(label, entity):
        values=[r.get(entity['id']) for r in ranks]
        known=[v for v in values if v is not None]
        rows.append({'label':label,'id':entity['id'],'name':entity['name'],'ranks':values,
                     'worst_rank':max(known) if len(known)==len(values) else None})
    if baseline:add('Popularity #1',baseline[0])
    for i,p in enumerate(people):
        if lists[i]:add(p['name']+' #1',lists[i][0])
    favorites=[rows[0]['id'] for rows in lists if rows]
    for entity_id in dict.fromkeys(favorites):
        count=favorites.count(entity_id)
        if count>len(people)/2 and count>=2:
            add('Majority #1 ('+str(count)+'/'+str(len(people))+')',next(e for es in lists for e in es if e['id']==entity_id))
    add('Fair pick' if all(pick['observed']) else 'Fair pick · lowest rank sum',pick)
    return merge_rows(rows)


def merge_rows(rows):
    """One row per place: a place that is several things at once lists every label, fair pick first."""
    merged={}
    for row in rows:
        same=merged.get(row['id'])
        if not same:merged[row['id']]=dict(row)
        elif row['label'].startswith('Fair pick'):same['label']=row['label']+' · '+same['label']
        else:same['label']+=' · '+row['label']
    return list(merged.values())
