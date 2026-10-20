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
        text += f"The shared pick is #{rank} for this group signal: a {rank-1}-place drop from #1. "
    else:
        text += 'The shared pick was absent from this signal’s returned list; its rank is unknown. '
    if removed or added:
        text += 'Tag difference: '+(', '.join(removed) or 'no unique tags')+' → '+(', '.join(added) or 'no unique tags')+'.'
    else:
        text += 'No tag difference is recorded.'
    return {'person': person['name'], 'top': first['name'], 'rank': rank if observed else None, 'rank_drop': rank-1 if observed else None, 'removed_tags': removed, 'added_tags': added, 'text': text}

def complete_scores(pool, rows):
    expected = {e['id'] for e in pool}
    return len(rows) == len(expected) and {e['id'] for e in rows} == expected and all(isinstance(e.get('affinity'), (int,float)) and math.isfinite(e['affinity']) for e in rows)

def ambiguity(results, query):
    exact = [e for e in results if e['name'].casefold().strip() == query.casefold().strip()]
    return len(exact) != 1
