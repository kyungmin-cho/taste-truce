"""Turn a local Qloo response cache into a bulk file for `wrangler kv bulk put`.

The bulk file holds Qloo data, so it must stay out of the repository: --out is refused inside it.
Layout (read by src/qloo.ts and src/scenes.ts):
  q:<signature>       {"saved", "rows"}: per-response scores, each row pointing at a place record
  p:<hash>            one compacted entity without its scores, stored once
  scene:<name>        the saved scene exactly as /scene/<name> returns it
  scene-meta:<name>   {"version", "saved"}
Entities are compacted with agent.compact, so both servers read the same fields.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agent import compact  # noqa: E402
from qloo import Qloo  # noqa: E402
from scenes import PRESETS, VERSION, public, read_scene, scene_key  # noqa: E402

SCORES = ('affinity', 'explainability', 'popularity')


class Cache:
    """What read_scene needs from Qloo: the cache folder and its signature."""
    signature = Qloo.signature

    def __init__(self, folder):
        self.cache = folder


def text(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def entries(folder):
    snapshots = {Qloo.signature(None, scene_key(name), {}) for name in PRESETS}
    places, out, skipped = {}, [], 0
    for file in sorted(folder.glob('*.json')):
        if file.stem in snapshots:
            continue
        try:
            item = json.loads(file.read_text())
            data = item['data']
            found = data.get('results', [])
            if isinstance(found, dict):
                found = found.get('entities', [])
            rows = []
            for entity in found:
                row = compact(entity)
                record = {k: v for k, v in row.items() if k not in SCORES}
                body = text(record)
                digest = hashlib.sha256(body.encode()).hexdigest()[:32]
                places[digest] = body
                rows.append({'p': digest, **{k: row[k] for k in SCORES}})
        except (ValueError, KeyError, TypeError, AttributeError):
            skipped += 1
            continue
        out.append({'key': 'q:' + file.stem, 'value': text({'saved': item['saved'], 'rows': rows})})
    out += [{'key': 'p:' + k, 'value': v} for k, v in places.items()]
    cache, scenes = Cache(folder), []
    os.environ['DEFAULT_SCENE_TTL_SECONDS'] = '0'
    for name in PRESETS:
        result = read_scene(cache, name)
        if result is None:
            continue
        saved = json.loads((folder / (Qloo.signature(None, scene_key(name), {}) + '.json')).read_text())['saved']
        out.append({'key': 'scene:' + name, 'value': json.dumps(public(result))})
        out.append({'key': 'scene-meta:' + name, 'value': text({'version': VERSION, 'saved': saved})})
        scenes.append(name)
    return out, {'responses': sum(e['key'].startswith('q:') for e in out), 'places': len(places), 'scenes': scenes, 'skipped': skipped}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--cache-dir', type=Path, default=Path(os.getenv('QLOO_CACHE_DIR') or Path.home() / '.cache' / 'taste-truce' / 'responses'))
    parser.add_argument('--out', type=Path, required=True, help='bulk JSON file, outside the repository')
    args = parser.parse_args()
    out = args.out.resolve()
    if out.is_relative_to(ROOT):
        raise SystemExit('Write the bulk file outside the repository: it contains Qloo data.')
    items, summary = entries(args.cache_dir)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(items))
    os.chmod(out, 0o600)
    summary.update(keys=len(items), bytes=out.stat().st_size, largest=max(len(e['value']) for e in items))
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
