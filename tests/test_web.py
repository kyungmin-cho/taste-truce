import http.client
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server
from qloo import Qloo
from sessions import Sessions
from test_copy import BANNED, SCREEN_BANNED
from test_steps import HIDDEN, UUID, ID, row

ROOT=Path(__file__).resolve().parent.parent
NODE=shutil.which('node')
# Screen code of the built front end; shadcn primitives in components/ui are library code.
WEB_FILES=sorted(p for p in (ROOT/'web'/'src').rglob('*.ts*') if 'components' not in p.parts)

class WebServingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();base=Path(self.temp.name)
        self.env=patch.dict(os.environ,{'QLOO_CACHE_DIR':str(base/'cache'),'QLOO_STATE_DIR':str(base/'state')});self.env.start()
        dist=base/'dist';(dist/'assets').mkdir(parents=True)
        (dist/'index.html').write_text('<!doctype html><title>built</title>')
        (dist/'assets'/'index-abc123.js').write_text('export{}')
        (dist/'assets'/'index-abc123.css').write_text('body{}')
        (dist/'assets'/'notes.txt').write_text('not an asset type')
        (base/'secret.js').write_text('outside')
        self.dist=dist
        self.app=ThreadingHTTPServer(('127.0.0.1',0),server.Handler);q=Qloo();self.app.qloo=q;self.app.sessions=Sessions(q)
        self.thread=threading.Thread(target=self.app.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.app.shutdown();self.app.server_close();self.thread.join();self.env.stop();self.temp.cleanup()
    def get(self,path,web=None):
        with patch.object(server,'WEB',web or self.dist):
            c=http.client.HTTPConnection(*self.app.server_address);c.request('GET',path);r=c.getresponse();body=r.read();c.close()
        return r.status,dict(r.getheaders()),body

    def test_home_serves_the_built_page_and_issues_the_session_cookie(self):
        status,headers,body=self.get('/')
        self.assertEqual(status,200);self.assertIn(b'built',body)
        self.assertIn('taste_session=',headers.get('Set-Cookie',''));self.assertEqual(headers['Cache-Control'],'no-store')

    def test_assets_have_explicit_types_and_a_long_cache(self):
        status,headers,_=self.get('/assets/index-abc123.js')
        self.assertEqual((status,headers['Content-Type']),(200,'text/javascript; charset=utf-8'))
        self.assertIn('immutable',headers['Cache-Control']);self.assertEqual(headers['X-Content-Type-Options'],'nosniff')
        self.assertEqual(self.get('/assets/index-abc123.css')[1]['Content-Type'],'text/css; charset=utf-8')

    def test_assets_outside_the_bundle_are_not_served(self):
        for path in ['/assets/../secret.js','/assets/%2e%2e/secret.js','/assets/..%2Fsecret.js','/assets/notes.txt','/assets/missing.js','/assets/','/assets/.hidden.js','/assets/sub/index-abc123.js']:
            with self.subTest(path=path):self.assertEqual(self.get(path)[0],404)

    def test_without_a_build_the_previous_page_is_served(self):
        status,headers,body=self.get('/',web=Path(self.temp.name)/'missing')
        self.assertEqual(status,200);self.assertIn(b'/app.js',body);self.assertIn('taste_session=',headers.get('Set-Cookie',''))
        status,_,body=self.get('/classic');self.assertEqual(status,200);self.assertIn(b'/app.js',body)

class WebImageTests(unittest.TestCase):
    def test_image_builds_the_front_end_and_ships_only_dist(self):
        text=(ROOT/'Dockerfile').read_text()
        self.assertIn('npm ci',text);self.assertIn('COPY --from=web /web/dist ./web/dist',text)
        ignored=(ROOT/'.dockerignore').read_text().split()
        for entry in ['**/node_modules','web/dist','.env']:
            with self.subTest(entry=entry):self.assertIn(entry,ignored)

class WebCopyTests(unittest.TestCase):
    def test_screen_code_has_no_hedges_or_working_labels(self):
        self.assertTrue(WEB_FILES)
        for path in WEB_FILES:
            text=path.read_text()
            for word in BANNED+SCREEN_BANNED:
                with self.subTest(file=path.name,word=word):self.assertNotIn(word,text)

def render_ts(rows):
    """Run web/src/shared/steps.ts in node (type stripping) and return the view for each row."""
    script='import(process.argv[1]).then(S=>{const rows=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(rows.map(S.viewStep)))})'
    out=subprocess.run([NODE,'-e',script,str(ROOT/'web'/'src'/'shared'/'steps.ts')],input=json.dumps(rows),capture_output=True,text=True)
    if out.returncode:raise unittest.SkipTest('node cannot run TypeScript here: '+out.stderr.strip()[:120])
    return json.loads(out.stdout)

@unittest.skipUnless(NODE,'node')
class WebStepLabelTests(unittest.TestCase):
    ROWS=[row('Direct plan · no condition',['plan · Plan this scene'],1),
          row('Local planner',['exclude_categories · Exclude bars'],1),
          row('choose category',['restaurant','dinner'],2),
          row('validate category + exclusions',['Williamsburg NYC','2000 m','take 30'],51),
          row('widen → retry',['2000 → 3500 m','take 30 → 40','Fewer than 5 eligible places'],3),
          row('candidate limit reached',['Return the actual remaining count'],4),
          row('bound candidate union',['Top 29 per person; at most 50 candidates'],49),
          row('rank-sum',['Rescoring incomplete; retrieve more candidates'],49),
          row('/v2/insights · fallback take 50',['Indie + jazz'],50),
          row('/v2/insights · rescore',['Indie + jazz']+['Place %d'%i for i in range(3)],3,entity_ids=ID[:3]),
          row('consensus · maximin-rank',['A','B',ID[0]],2,entity_ids=ID[:2]),
          row('observe → replan · Local planner',['29 places left · 17 excluded · 2 km','Try a different shared pick'],1),
          row('LLM planner',['exclude_place · '+ID[0],ID[1]],1),
          row('/search',['Moonrise Kingdom'],5)]

    def test_server_labels_map_to_the_same_plain_names(self):
        got=[(v['title'],v['lines'][:1],v['count']) for v in render_ts(self.ROWS)]
        self.assertEqual(got,[('Plan',[],None),
                              ('Local planner',['exclude_categories · Exclude bars'],None),
                              ('Choose category',['restaurant'],None),
                              ('Filter places',['Williamsburg NYC · within 2 km · 51 places'],None),
                              ('Search farther',['2 km → 3.5 km · fewer than 5 places'],None),
                              ('Widest search reached',['4 places left'],None),
                              ('Shared list',['Top 29 per friend · 49 places'],None),
                              ('Lowest rank sum',['Some ranks are missing; searching wider'],None),
                              ('/v2/insights · person',['Indie + jazz'],50),
                              ('/v2/insights · rescore',['Indie + jazz'],3),
                              ('Fair pick',[],None),
                              ('Observe → replan',['29 places left · 17 excluded · 2 km'],None),
                              ('LLM planner',[],None),
                              ('/search',['Moonrise Kingdom'],5)])

    def test_views_show_no_working_labels_or_entity_ids(self):
        for source,view in zip(self.ROWS,render_ts(self.ROWS)):
            text=json.dumps(view,ensure_ascii=False)
            with self.subTest(tool=source['tool']):
                for word in HIDDEN:self.assertNotIn(word,text)
                self.assertIsNone(UUID.search(text))
