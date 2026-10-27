"""Optional check against a local Qloo response cache, which is never committed.
Set TRUCE_CACHE_CHECK_DIR to a QLOO_CACHE_DIR from a Williamsburg dinner run to check the bar veto on real places."""
import json
import os
import unittest
from pathlib import Path

from agent import compact
from logic import eligible

CACHE = os.environ.get('TRUCE_CACHE_CHECK_DIR')
OUT = ['MISIPASTA', 'Carneval', 'Sugar Hill Restaurant & Supper Club', 'Ringolevio', 'Maison Premiere', 'The Four Horsemen', 'Five Leaves']
KEPT = ['Lilia', 'Aska', 'St. Anselm', 'Ume', 'Leuca', 'Traif', "K'Far", 'Greenpoint Fish & Lobster Co.', "Joe's Pizza"]


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


if __name__ == '__main__':
    unittest.main()
