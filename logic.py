"""Consensus on comparable per-person ranks, with auditable concessions."""
import math
import re

CATEGORY = 'urn:tag:category:place:'
DINNER = 'urn:tag:dining_options:place:dinner'
OCCASIONS = {'Dinner': [CATEGORY+'restaurant', DINNER], 'Cafe': [CATEGORY+'cafe'], 'Drinks': [CATEGORY+'bar']}

def tag_ids(e):
    return {t['id'] for t in e.get('tags', [])}

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
    if veto.get('no_bars') and (CATEGORY+'bar' in tags or re.search(r'\b(bar|pub|nightclub|gastropub)\b', genre)):
        return False
    categories=veto.get('categories',[])
    if any(CATEGORY+c in tags or re.search(r'\b'+re.escape(c)+r'\b',genre) for c in categories):return False
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
    add('Fair pick' if all(pick['observed']) else 'Group pick · rank-sum fallback',pick)
    return rows
