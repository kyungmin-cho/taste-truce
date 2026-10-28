"""Small local HTTP app; all provider credentials stay in this process."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent
# Built front end (web/, `npm run build`). Without a build, / serves the previous page in static/.
WEB=ROOT/'web'/'dist'
ASSET=re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]*')
# Explicit types: responses carry nosniff, and module scripts are refused under text/plain.
ASSET_TYPES={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.png':'image/png'}

def load_env(path):
    if not path.exists():return
    for line in path.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            k,v=line.split('=',1)
            os.environ.setdefault(k.strip(),v.strip().strip('"').strip("'"))

load_env(Path(os.getenv('ENV_FILE',ROOT/'.env')))
from agent import Agent, DEFAULT_PEOPLE
from qloo import Qloo, QlooError, BudgetError
from sessions import Sessions
from scenes import PRESETS, default_scene, scene_body, save_scene, read_scene, health

# Provider scores the agent ranks with; neither page shows them, so responses leave them out.
RAW_FIELDS=('affinity','explainability','popularity')

def public(value):
    """A copy of a result without the provider's raw scores; saved scenes keep them."""
    if isinstance(value,dict):return {k:public(v) for k,v in value.items() if not ('id' in value and k in RAW_FIELDS)}
    if isinstance(value,list):return [public(v) for v in value]
    return value

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self, *_):pass
    def headers_for(self, status, content_type, length=None, cache='no-store'):
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.send_header('Cache-Control',cache)
        self.send_header('Connection','close')
        self.close_connection=True
        if length is not None:self.send_header('Content-Length',str(length))
    def json_response(self,status,data):
        payload=json.dumps(data).encode();self.headers_for(status,'application/json',len(payload));self.end_headers();self.wfile.write(payload)
    def do_GET(self):
        route=urlsplit(self.path).path
        if route=='/api/config':
            return self.json_response(200,{'people':DEFAULT_PEOPLE,'default_scene':default_scene(),'presets':{k:{'label':v['label'],**scene_body(k)} for k,v in PRESETS.items()}})
        if route=='/health':
            state=health(self.server.qloo)
            return self.json_response(200 if state['ready'] else 503,state)
        if route.startswith('/scene/'):
            name=route.split('/')[-1]
            result=read_scene(self.server.qloo,default_scene() if name=='default' else name)
            return self.json_response(200 if result else 503,{'result':public(result) if result else None,'error':None if result else 'The saved scene is still being prepared. Please reload in a minute.'})
        if route.startswith('/assets/'):
            name=route[len('/assets/'):]
            file=WEB/'assets'/name
            if not ASSET.fullmatch(name) or file.suffix not in ASSET_TYPES or not file.is_file():return self.json_response(404,{'error':'Not found'})
            data=file.read_bytes()
            # Vite puts a content hash in every asset name, so a cached copy never goes stale.
            self.headers_for(200,ASSET_TYPES[file.suffix],len(data),'public, max-age=31536000, immutable')
            self.end_headers();self.wfile.write(data);return
        # /classic keeps the previous page reachable; it shares the same API and session.
        files={'/':'index.html','/classic':'index.html','/styles.css':'styles.css','/app.js':'app.js','/copy.js':'copy.js','/steps.js':'steps.js'}
        vendor=['leaflet.js','leaflet.css','LICENSE','images/layers.png','images/layers-2x.png','images/marker-icon.png','images/marker-icon-2x.png','images/marker-shadow.png']
        files.update({'/vendor/leaflet/'+name:'vendor/leaflet/'+name for name in vendor})
        if route not in files:return self.json_response(404,{'error':'Not found'})
        token=None
        if route in ('/','/classic'):
            try:token=self.server.sessions.issue(Sessions.token(self.headers.get('Cookie')),self.server.sessions.ip(self))
            except ValueError:pass
        file=WEB/'index.html' if route=='/' and (WEB/'index.html').is_file() else ROOT/'static'/files[route]
        data=file.read_bytes()
        self.headers_for(200,(mimetypes.guess_type(file.name)[0] or 'text/plain')+('' if file.suffix=='.png' else '; charset=utf-8'),len(data))
        if token:self.send_header('Set-Cookie',f'taste_session={token}; HttpOnly; SameSite=Strict; Path=/'+('; Secure' if os.getenv('COOKIE_SECURE')=='1' else ''))
        self.end_headers();self.wfile.write(data)
    def do_POST(self):
        if self.path!='/api/plan':return self.json_response(404,{'error':'Not found'})
        origin=self.headers.get('Origin')
        if origin and urlsplit(origin).netloc!=self.headers.get('Host'):
            return self.json_response(403,{'error':'Origin not allowed'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=20000:raise ValueError()
            body=json.loads(self.rfile.read(length))
            if not isinstance(body,dict):raise ValueError()
        except (ValueError,TypeError):return self.json_response(400,{'error':'Invalid plan request'})
        token=Sessions.token(self.headers.get('Cookie'))
        mutex,error=self.server.sessions.acquire(token,self.server.sessions.ip(self))
        if error=='unknown':return self.json_response(403,{'error':'Open the home page to start a valid session.'})
        if error=='limit':return self.json_response(429,{'error':'Daily new-session limit reached. The saved scene remains available.'})
        if error=='busy':return self.json_response(409,{'error':'A plan is already running in this session'})
        self.headers_for(200,'application/x-ndjson; charset=utf-8')
        self.end_headers();self.close_connection=True
        write_lock=threading.Lock()
        disconnected=threading.Event()
        def emit(event):
            if disconnected.is_set():return
            with write_lock:
                try:self.wfile.write((json.dumps(event,ensure_ascii=False)+'\n').encode());self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):disconnected.set()
        try:
            result=self.server.agent.run(token,body,emit)
            # Visitors may fill a missing snapshot, never replace one: choices, text and
            # suggested actions can change the result while the scene inputs look identical.
            if result['status']=='done' and not any(result['veto'].values()) and not body.get('choices') and not str(body.get('veto_text','')).strip() and not body.get('suggested_action'):
                for name in PRESETS:
                    expected=scene_body(name)
                    if all(result.get(k)==v for k,v in expected.items()) and read_scene(self.server.qloo,name) is None:save_scene(self.server.qloo,name,result)
            emit({'event':'result','result':public(result)})
        except BudgetError as err:
            result=read_scene(self.server.qloo,default_scene())
            if result:
                result['notice']=str(err)+' Showing the saved default scene; your edits were not applied.'
                emit({'event':'result','result':public(result)})
            else:emit({'event':'error','message':str(err)+' No saved default scene is available yet.'})
        except (QlooError,ValueError) as err:
            emit({'event':'error','message':str(err)})
        except Exception:
            emit({'event':'error','message':'The plan could not be completed. Please try again.'})
        finally:mutex.release()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=int((os.getenv('PORT') or '3000')));parser.add_argument('--host',default=(os.getenv('HOST') or '127.0.0.1'));args=parser.parse_args()
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    server.qloo=Qloo();server.agent=Agent(server.qloo);server.sessions=Sessions(server.qloo)
    print(f'Taste Truce running at http://localhost:{args.port}',flush=True)
    server.serve_forever()
