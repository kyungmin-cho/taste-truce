"""Small local HTTP app; all provider credentials stay in this process."""
import argparse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent

def load_env(path):
    if not path.exists():return
    for line in path.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            k,v=line.split('=',1)
            os.environ.setdefault(k.strip(),v.strip().strip('"').strip("'"))

load_env(Path(os.getenv('ENV_FILE',ROOT/'.env')))
from agent import Agent, DEFAULT_PEOPLE
from qloo import Qloo, QlooError, BudgetError

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self, *_):pass
    def headers_for(self, status, content_type, length=None):
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.send_header('Cache-Control','no-store')
        if length is not None:self.send_header('Content-Length',str(length))
    def json_response(self,status,data):
        payload=json.dumps(data).encode();self.headers_for(status,'application/json',len(payload));self.end_headers();self.wfile.write(payload)
    def do_GET(self):
        route=urlsplit(self.path).path
        if route=='/api/config':
            return self.json_response(200,{'people':DEFAULT_PEOPLE,'session_call_cap':self.server.qloo.session_cap})
        if route=='/health':return self.json_response(200,{'status':'ok'})
        files={'/':'index.html','/styles.css':'styles.css','/app.js':'app.js'}
        if route not in files:return self.json_response(404,{'error':'Not found'})
        file=ROOT/'static'/files[route];data=file.read_bytes()
        self.headers_for(200,mimetypes.guess_type(file.name)[0]+'; charset=utf-8',len(data));self.end_headers();self.wfile.write(data)
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
        jar=cookies.SimpleCookie()
        try:jar.load(self.headers.get('Cookie',''))
        except cookies.CookieError:pass
        token=jar.get('taste_session')
        token=token.value if token else ''
        with self.server.session_lock:
            if token not in self.server.sessions:
                token=secrets.token_urlsafe(24);self.server.sessions.add(token)
            mutex=self.server.plan_locks.setdefault(token,threading.Lock())
        if not mutex.acquire(blocking=False):return self.json_response(409,{'error':'A plan is already running in this session'})
        self.headers_for(200,'application/x-ndjson; charset=utf-8')
        self.send_header('Connection','close')
        self.send_header('Set-Cookie',f'taste_session={token}; HttpOnly; SameSite=Strict; Path=/')
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
            if (result['status']=='done' and result['people']==DEFAULT_PEOPLE and result['area']=='Seongsu'
                and result['occasion']=='Dinner' and not result['veto']['excluded'] and not result['veto']['no_bars']):
                self.server.qloo.save('/scene/default',{},result)
            emit({'event':'result','result':result})
        except BudgetError as err:
            cached=self.server.qloo.cache/(self.server.qloo.signature('/scene/default',{})+'.json')
            try:
                item=json.loads(cached.read_text())
                result=item['data']
                result['notice']=str(err)+' Showing the saved default Seongsu scene; your edits were not applied.'
                result['saved_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(item['saved']))
                result['session_calls']=self.server.qloo.used(token)
                emit({'event':'step','step':{'tool':'budget → cached default scene','entities':[result['saved_utc']],'count':len(result['picks']),'latency_ms':0,'cache':True}})
                emit({'event':'result','result':result})
            except (OSError,ValueError,KeyError):
                emit({'event':'error','message':str(err)+' No saved default scene is available yet.'})
        except (QlooError,ValueError) as err:
            emit({'event':'error','message':str(err)})
        except Exception:
            emit({'event':'error','message':'The plan could not be completed. Please try again.'})
        finally:mutex.release()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=int((os.getenv('PORT') or '3000')));parser.add_argument('--host',default=(os.getenv('HOST') or '127.0.0.1'));args=parser.parse_args()
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    server.qloo=Qloo();server.agent=Agent(server.qloo);server.sessions=set();server.plan_locks={};server.session_lock=threading.Lock()
    print(f'Taste Truce running at http://localhost:{args.port}',flush=True)
    server.serve_forever()
