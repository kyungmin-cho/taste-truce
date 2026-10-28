"""Optional check against a local Qloo response cache, which is never committed.
Set TRUCE_CACHE_CHECK_DIR to a QLOO_CACHE_DIR from a Williamsburg dinner run to check the bar veto on real places."""
import itertools
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import agent
from agent import compact
from logic import OCCASIONS, VETO_TAGS, concession, eligible, venue_evidence

CACHE = os.environ.get('TRUCE_CACHE_CHECK_DIR')
OUT = ['MISIPASTA', 'Carneval', 'Sugar Hill Restaurant & Supper Club', 'Ringolevio', 'Maison Premiere', 'The Four Horsemen', 'Five Leaves']
KEPT = ['Lilia', 'Aska', 'St. Anselm', 'Ume', 'Leuca', 'Traif', "K'Far", 'Greenpoint Fish & Lobster Co.', "Joe's Pizza"]


def walk(x):
    if isinstance(x, dict):
        if 'entity_id' in x and 'name' in x:yield x
        for v in x.values():yield from walk(v)
    elif isinstance(x, list):
        for v in x:yield from walk(v)


def entities(folder):
    def walk(x):
        if isinstance(x, dict):
            if 'entity_id' in x and 'name' in x:yield x
            for v in x.values():yield from walk(v)
        elif isinstance(x, list):
            for v in x:yield from walk(v)
    found = {}
    for f in Path(folder).glob('*.json'):
        for e in walk(json.loads(f.read_text()).get('data', {})):
            c = compact(e)
            if c['name'] in OUT+KEPT and eligible(c, 'Dinner', {}):found.setdefault(c['name'], []).append(c)
    return found


@unittest.skipUnless(CACHE, 'Set TRUCE_CACHE_CHECK_DIR to a local Qloo cache')
class CachedPlaceTests(unittest.TestCase):
    def test_bar_veto_on_cached_williamsburg_places(self):
        found = entities(CACHE)
        for name in OUT+KEPT:
            self.assertIn(name, found)
            for e in found[name]:
                for veto in ({'categories': ['bar']}, {'no_bars': True}):
                    with self.subTest(place=name, veto=veto):
                        self.assertEqual(eligible(e, 'Dinner', veto), name in KEPT)

    def test_dropped_tags_change_no_decision(self):
        # compact keeps only the tags something reads; every rule must give the same answer on the full list.
        vetoes = [{}, {'no_bars': True}, {'vegetarian': True}] + [{'categories': [c]} for c in ('bar', 'pub', 'nightclub')] + [{'tags': [t]} for t in VETO_TAGS]
        person = {'name': 'p', 'seeds': [{'query': 'q'}]}
        places, seen = [], set()
        for f in sorted(Path(CACHE).glob('*.json')):
            for e in walk(json.loads(f.read_text()).get('data', {})):
                if e['entity_id'] not in seen:
                    seen.add(e['entity_id'])
                    with patch.object(agent, 'kept_tag', lambda t: True):full = compact(e)
                    places.append((full, compact(e)))
        self.assertGreater(len(places), 300)
        self.assertLess(sum(len(c['tags']) for _, c in places), sum(len(f['tags']) for f, _ in places) / 2)
        for full, kept in places:
            for occasion, veto in itertools.product(OCCASIONS, vetoes):
                self.assertEqual(eligible(full, occasion, veto), eligible(kept, occasion, veto), (full['name'], occasion, veto))
            for category in ('bar', 'pub', 'nightclub'):
                self.assertEqual(venue_evidence(full, category), venue_evidence(kept, category))
        rank = {'ranks': [2], 'observed': [True]}
        for (a, a2), (b, b2) in zip(places, places[1:]):
            self.assertEqual(concession(person, [a], {**b, **rank}, 0), concession(person, [a2], {**b2, **rank}, 0))


if __name__ == '__main__':
    unittest.main()
