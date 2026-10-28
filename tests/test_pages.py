"""Parity between the Python server and the Pages Functions port (pages/).

Both servers get the same requests in the same order and must answer with the same status and
the same JSON, once timings are dropped and steps sorted (parallel calls finish in any order).
The synthetic tests run everywhere on made-up Qloo data (pages_fixture.py). The cached tests
replay a local Qloo response cache, which is never committed: set TRUCE_CACHE_CHECK_DIR.
"""
import http.client
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server
from agent import Agent, DEFAULT_PEOPLE
from qloo import Qloo
from scenes import PRESETS, save_scene, scene_body
from sessions import Sessions
import pages_fixture

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which('node')
HARNESS = ROOT / 'pages' / 'test' / 'harness.ts'
SEED = ROOT / 'pages' / 'seed_kv.py'
CACHE = os.environ.get('TRUCE_CACHE_CHECK_DIR')
KEYLESS = {'QLOO_API_KEY': '', 'QLOO_BASE_URL': 'http://127.0.0.1:9', 'DEFAULT_SCENE': 'majority', 'DEFAULT_SCENE_TTL_SECONDS': '0', 'QLOO_CACHE_TTL_SECONDS': '0'}
NO_LLM = ('LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY')
HIPHOP = {'name': 'Hip-hop + sneakers', 'seeds': [{'query': 'Kendrick Lamar', 'type': 'artist'}, {'query': 'Nike', 'type': 'brand'}]}
JOE = {'name': 'Friend 4', 'seeds': [{'query': "Joe's Pizza", 'type': 'place'}]}


def body(**changes):
    return {**scene_body('majority'), 'choices': {}, 'veto': {'excluded': []}, 'veto_text': '', **changes}


def post(data, **headers):
    text = data if isinstance(data, str) else json.dumps(data)
    return {'method': 'POST', 'path': '/api/plan', 'headers': {'Content-Type': 'application/json', **headers}, 'body': text}


def get(path):
    return {'method': 'GET', 'path': path}


def flows(pick, joe):
    """(label, request) in the order both servers receive them. pick: a place id; joe: option ids."""
    people = scene_body('majority')['people']
    seongsu = {**body(), 'area': 'Seongsu'}
    return [
        ('home', get('/')), ('classic', get('/classic')), ('config', get('/api/config')), ('health', get('/health')),
        ('scene default', get('/scene/default')), ('scene williamsburg', get('/scene/williamsburg')),
        ('scene seongsu', get('/scene/seongsu')), ('scene unknown', get('/scene/nope')),
        ('plan default', post(body())), ('scene majority after a plan', get('/scene/majority')),
        ('no bars', post(body(veto_text='no bars please'))),
        ('quieter', post(body(veto_text='somewhere quieter'))),
        ('no bars and quieter', post(body(veto_text='no bars, somewhere quieter please'))),
        ('replace friend 2', post(body(people=[people[0], HIPHOP, people[2]]))),
        ('replace and no bars', post(body(people=[people[0], HIPHOP, people[2]], veto={'excluded': [], 'categories': ['bar', 'pub', 'nightclub']}))),
        ("add Joe's Pizza", post(body(people=people + [JOE]))),
        ("choose a Joe's Pizza", post(body(people=people + [JOE], choices={'3:0': joe[-1]}))),
        ("skip Joe's Pizza", post(body(people=people + [JOE], choices={'3:0': 'skip'}))),
        ('choice not offered', post(body(people=people + [JOE], choices={'3:0': 'not-an-option'}))),
        ('ambiguous taste', post(body(people=people + [{'name': 'Friend 4', 'seeds': [{'query': 'Nobody Exactly', 'type': 'artist'}]}]))),
        ('taste with no results', post(body(people=people + [{'name': 'Friend 4', 'seeds': [{'query': 'Nothing Here', 'type': 'book'}]}]))),
        ('add a vegetarian friend', post(body(veto_text='add a vegetarian friend'))),
        ('cheaper', post(body(veto_text='cheaper please'))),
        ('search farther', post(body(veto_text='search farther'))),
        ('suggested widen', post(body(veto_text='no bars please', suggested_action={'name': 'widen_radius', 'arguments': {'radius': 3500}}))),
        ('not that place', post(body(veto_text='not that place', current_pick=pick))),
        ('not that place without a pick', post(body(veto_text='not that place'))),
        ('move to Seongsu', post(body(veto_text='move to seongsu'))),
        ('Seongsu dinner', post(seongsu)),
        ('Seongsu cafe', post({**seongsu, 'occasion': 'Cafe'})),
        ('Korean veto', post({**seongsu, 'veto_text': '술집 빼고 조용한 곳'})),
        ('no condition matched', post(body(veto_text='hello there'))),
        ('veto_text null', post(body(veto_text=None))),
        ('price limit true', post(body(veto={'excluded': [], 'max_price_level': True}))),
        ('unknown area', post(body(area='Paris'))),
        ('unsupported radius', post(body(start_radius=123))),
        ('no friends', post(body(people=[]))),
        ('six friends', post(body(people=people * 2))),
        ('blank name', post(body(people=[{'name': ' ', 'seeds': people[0]['seeds']}]))),
        ('four seeds', post(body(people=[{'name': 'A', 'seeds': people[0]['seeds'] * 2}]))),
        ('seed type', post(body(people=[{'name': 'A', 'seeds': [{'query': 'X', 'type': 'song'}]}]))),
        ('seeds as text', post(body(people=[{'name': 'A', 'seeds': 'ab'}]))),
        ('area as list', post(body(area=['Seongsu']))),
        ('veto as text', post(body(veto='no bars'))),
        ('veto category', post(body(veto={'categories': ['spa']}))),
        ('veto tags as text', post(body(veto={'tags': 'Loud'}))),
        ('price limit 3', post(body(veto={'max_price_level': 3}))),
        ('too many exclusions', post(body(veto={'excluded': ['x'] * 101}))),
        ('exclusion not text', post(body(veto={'excluded': [5]}))),
        ('choices as list', post(body(choices=[]))),
        ('bad suggested action', post(body(suggested_action={'name': 'nope', 'arguments': {}}))),
        ('suggested action as text', post(body(suggested_action='widen'))),
        ('invalid JSON', post('{"people": ')),
        ('list body', post('[1, 2]')),
        ('over 20 KB', post(body(veto_text='x' * 20001))),
        ('empty body', post('')),
        ('other origin', post(body(), Origin='http://elsewhere.example')),
        ('unknown session', post(body(), Cookie='taste_session=forged')),
    ]


def normalize(response):
    """Status plus parsed content without timings; steps sorted, the cookie value dropped."""
    status, kind, text = response['status'], (response['type'] or '').split(';')[0], response['body']

    def clean(value):
        if isinstance(value, dict):
            out = {k: clean(v) for k, v in value.items() if k not in ('latency_ms', 'elapsed_ms', 'saved_utc')}
            if isinstance(out.get('steps'), list):
                out['steps'] = sorted(out['steps'], key=lambda s: json.dumps(s, sort_keys=True))
            return out
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value

    if kind == 'application/x-ndjson':
        events = [clean(json.loads(line)) for line in text.splitlines() if line.strip()]
        steps = sorted((e for e in events if e['event'] == 'step'), key=lambda e: json.dumps(e, sort_keys=True))
        if events and events[-1]['event'] == 'error':
            # When one parallel call fails, Python's thread pool cancels the calls that have not
            # started yet, so how many request steps precede an error varies from run to run.
            steps = [e for e in steps if 'cache' not in e['step']]
        return status, 'ndjson', steps + [e for e in events if e['event'] != 'step']
    if kind == 'application/json':
        return status, 'json', clean(json.loads(text))
    return status, 'page', response['cookie']


def run_ts(bulk, requests):
    out = subprocess.run([NODE, str(HARNESS)], input=json.dumps({'bulk': str(bulk), 'env': {'QLOO_BASE_URL': 'http://127.0.0.1:9'}, 'requests': requests}),
                         capture_output=True, text=True, cwd=ROOT / 'pages', timeout=300)
    if out.returncode:
        raise AssertionError('harness failed: ' + out.stderr[-2000:])
    return json.loads(out.stdout)


def run_python(cache, state, requests):
    env = {**KEYLESS, 'QLOO_CACHE_DIR': str(cache), 'QLOO_STATE_DIR': str(state)}
    with patch.dict(os.environ, env):
        for k in NO_LLM:
            os.environ.pop(k, None)
        app = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        q = Qloo()
        app.qloo, app.agent, app.sessions = q, Agent(q), Sessions(q)
        thread = threading.Thread(target=app.serve_forever, daemon=True)
        thread.start()
        cookie, out = '', []
        try:
            for r in requests:
                headers = dict(r.get('headers') or {})
                if 'Cookie' not in headers and cookie:
                    headers['Cookie'] = cookie
                c = http.client.HTTPConnection(*app.server_address, timeout=120)
                c.request(r['method'], r['path'], body=(r['body'] or '').encode() if r['method'] == 'POST' else None, headers=headers)
                res = c.getresponse()
                text = res.read().decode()
                c.close()
                if res.getheader('Set-Cookie'):
                    cookie = res.getheader('Set-Cookie').split(';')[0]
                out.append({'status': res.status, 'type': res.getheader('Content-Type'), 'cookie': bool(res.getheader('Set-Cookie')), 'body': text})
        finally:
            app.shutdown()
            app.server_close()
            thread.join()
    return out


def seed(cache, out):
    result = subprocess.run(['python3', '-I', str(SEED), '--cache-dir', str(cache), '--out', str(out)], capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def final(response):
    return json.loads(response['body'].strip().splitlines()[-1])


def known_ids(cache, state):
    """The default pick and the Joe's Pizza options, read from the Python server."""
    out = run_python(cache, state, [get('/'), post(body()), post(body(people=scene_body('majority')['people'] + [JOE]))])
    done, asked = final(out[1]), final(out[2])
    joe = [o['id'] for o in asked['result']['questions'][0]['options']] if asked['event'] == 'result' and asked['result']['status'] == 'clarification' else ['none']
    return (done['result']['picks'][0]['id'] if done['event'] == 'result' else 'none'), joe


class Parity:
    """Shared by the synthetic and cached cases: setUpClass sets cls.cache and cls.bulk."""

    @classmethod
    def compare(cls):
        state = Path(cls.temp.name) / 'state'
        # The Python server may save a missing scene, so each run gets its own copy of the cache.
        ids_cache = Path(cls.temp.name) / 'ids-cache'
        shutil.copytree(cls.cache, ids_cache)
        cls.pick, cls.joe = known_ids(ids_cache, state / 'ids')
        cls.labels, requests = zip(*flows(cls.pick, cls.joe))
        python_cache = Path(cls.temp.name) / 'python-cache'
        shutil.copytree(cls.cache, python_cache)
        cls.python = run_python(python_cache, state / 'python', list(requests))
        cls.ts = run_ts(cls.bulk, list(requests))

    def test_every_request_gets_the_same_answer(self):
        self.assertEqual(len(self.python), len(self.ts['responses']))
        for label, py, ts in zip(self.labels, self.python, self.ts['responses']):
            with self.subTest(label):
                self.assertEqual(normalize(py), normalize(ts))

    def test_pages_wrote_no_cached_response(self):
        # Keyless: every answer came from the seeded cache, and nothing new was fetched or stored.
        writes = sum(1 for label in self.labels if label == 'plan default')
        self.assertLessEqual(self.ts['kv_writes'], 2 * writes)


@unittest.skipUnless(NODE, 'node is needed to run the Pages code')
class SyntheticParityTests(Parity, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        base = Path(cls.temp.name)
        cls.cache = base / 'cache'
        env = {'QLOO_CACHE_DIR': str(cls.cache), 'QLOO_STATE_DIR': str(base / 'gen-state'), 'QLOO_API_KEY': 'synthetic', 'QLOO_BASE_URL': 'http://synthetic.invalid'}
        with patch.dict(os.environ, env), patch('qloo.urllib.request.urlopen', pages_fixture.fake_urlopen), patch.object(Qloo, 'reserve', lambda self, session: None):
            for k in NO_LLM:
                os.environ.pop(k, None)
            q = Qloo()
            agent = Agent(q)
            for _, request in flows('none', ['none']):
                if request['method'] == 'POST':
                    try:
                        data = json.loads(request['body'])
                        result = agent.run('gen', data, lambda _: None)
                        for question in result.get('questions', []):
                            for option in question['options']:
                                agent.run('gen', {**data, 'choices': {question['key']: option['id']}}, lambda _: None)
                    except Exception:
                        pass
            save_scene(q, 'williamsburg', agent.run('gen', scene_body('williamsburg'), lambda _: None))
        cls.summary = seed(cls.cache, base / 'bulk.json')
        cls.bulk = base / 'bulk.json'
        cls.compare()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_seed_kept_every_response(self):
        self.assertEqual(self.summary['skipped'], 0)
        self.assertEqual(self.summary['scenes'], ['williamsburg'])
        self.assertGreater(self.summary['responses'], 20)

    def test_flows_cover_the_agent_paths(self):
        results = [final(r) for r in self.python if r['type'] and 'ndjson' in r['type']]
        statuses = {e['result']['status'] for e in results if e['event'] == 'result'}
        self.assertEqual(statuses, {'done', 'clarification', 'friend_taste'})
        methods = {e['result'].get('method') for e in results if e['event'] == 'result'}
        self.assertIn('rank-sum', methods)
        self.assertIn('maximin-rank', methods)
        tools = {s['tool'] for e in results if e['event'] == 'result' for s in e['result'].get('steps', [])}
        self.assertIn('widen → retry', tools)
        self.assertTrue(any(e['event'] == 'error' for e in results))


@unittest.skipUnless(NODE and CACHE, 'Set TRUCE_CACHE_CHECK_DIR to a local Qloo cache')
class CachedParityTests(Parity, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        base = Path(cls.temp.name)
        cls.cache = base / 'cache'
        shutil.copytree(CACHE, cls.cache)
        cls.summary = seed(cls.cache, base / 'bulk.json')
        cls.bulk = base / 'bulk.json'
        cls.compare()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def result(self, label):
        return final(self.ts['responses'][self.labels.index(label)])['result']

    def test_demo_numbers(self):
        default = self.result('plan default')
        self.assertEqual((default['pool_size'], default['picks'][0]['name'], default['picks'][0]['ranks']), (44, 'Maison Premiere', [6, 3, 2]))
        vetoed = self.result('no bars')
        rows = {r['name']: r['ranks'] for r in vetoed['concession_table']}
        self.assertEqual((vetoed['pool_size'], rows['Lilia'], rows['Ume']), (17, [4, 5, 5], [10, 1, 1]))
        replaced = self.result('replace friend 2')
        self.assertEqual((replaced['picks'][0]['name'], replaced['pool_size']), ('Five Leaves', 47))
        asked = self.result("add Joe's Pizza")
        self.assertEqual((asked['status'], len(asked['questions'][0]['options'])), ('clarification', 5))


class SignatureTests(unittest.TestCase):
    """The KV key for a request is qloo.Qloo.signature, computed again in TypeScript."""

    @unittest.skipUnless(NODE, 'node is needed to run the Pages code')
    def test_typescript_signature_matches(self):
        cases = [('/search', {'query': "Joe's Pizza", 'types': 'urn:entity:place', 'take': 5, 'filter.location': '40.7081,-73.9571', 'filter.radius': 15}),
                 ('/search', {'query': '성수 카페 “quoted” \\ / \n tab\t', 'types': 'urn:entity:brand', 'take': 5}),
                 ('/search', {'query': 'emoji 🍕 and é', 'types': 'urn:entity:movie', 'take': 5}),
                 ('/v2/insights', {'filter.type': 'urn:entity:place', 'filter.location': 'POINT(-73.9571 40.7081)', 'filter.location.radius': 2000, 'take': 30, 'operator.filter.tags': 'intersection'}),
                 ('/scene/majority', {})]
        script = ('import(process.argv[1]).then(async P=>{const cases=JSON.parse(require("fs").readFileSync(0,"utf8"));'
                  'const out=[];for(const [p,q] of cases)out.push(await P.signature(p,q));process.stdout.write(JSON.stringify(out))})')
        out = subprocess.run([NODE, '-e', script, str(ROOT / 'pages' / 'src' / 'py.ts')], input=json.dumps(cases), capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout), [Qloo.signature(None, p, q) for p, q in cases])


class SeedTests(unittest.TestCase):
    def test_bulk_file_is_refused_inside_the_repository(self):
        out = subprocess.run(['python3', '-I', str(SEED), '--cache-dir', '/nonexistent', '--out', str(ROOT / 'pages' / 'bulk.json')], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn('outside the repository', out.stderr)
        self.assertFalse((ROOT / 'pages' / 'bulk.json').exists())


if __name__ == '__main__':
    unittest.main()
