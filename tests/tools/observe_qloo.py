"""Run a local Qloo observation proxy with a capped ledger outside the repository.

Example: python3 tests/tools/observe_qloo.py --output /tmp/qloo-observation
Point QLOO_BASE_URL at http://127.0.0.1:3939 for the app under test.
The upstream base/key come from the environment; do not record request headers.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def serve(output, cap, port):
    output=Path(output).expanduser().resolve()
    repo=Path(__file__).resolve().parents[2]
    if output==repo or repo in output.parents:raise ValueError('Keep observations outside the repository.')
    output.mkdir(parents=True,exist_ok=True,mode=0o700)
    ledger=output/'calls.json';lock=threading.Lock();starts=[]
    base=(os.getenv('QLOO_UPSTREAM_BASE_URL') or 'https://hackathon.api.qloo.com').rstrip('/')
    key=os.environ['QLOO_API_KEY']
    class Proxy(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            parsed=urllib.parse.urlsplit(self.path)
            if parsed.path not in ('/search','/v2/insights'):self.send_error(404);return
            with lock:
                rows=json.loads(ledger.read_text()) if ledger.exists() else []
                if len(rows)>=cap:self.send_error(429);return
                now=time.time();delay=max(0,starts[-1]+.31-now) if starts else 0
                if len(starts)>=4:delay=max(delay,starts[-4]+1.26-now)
                if delay:time.sleep(delay)
                at=time.time();starts.append(at);number=len(rows)+1
                row={'number':number,'path':parsed.path,'params':dict(urllib.parse.parse_qsl(parsed.query)),'started_epoch':at,'status':'started'}
                rows.append(row);ledger.write_text(json.dumps(rows,indent=2))
            req=urllib.request.Request(base+self.path,headers={'X-Api-Key':key,'Accept':'application/json'})
            try:
                try:response=urllib.request.urlopen(req,timeout=15)
                except urllib.error.HTTPError as err:response=err
                data=response.read();status=response.status
                # A provider response must not echo a credential into an observation.
                data=data.replace(key.encode(),b'[REDACTED]')
                raw=output/f'{number:03d}.json';raw.write_bytes(data);os.chmod(raw,0o600)
                row.update(status=status,raw_file=raw.name,latency_ms=round((time.time()-at)*1000))
            except Exception:status=502;data=b'{}';row['status']='transport_error'
            with lock:
                rows=json.loads(ledger.read_text());rows[number-1]=row;ledger.write_text(json.dumps(rows,indent=2))
            self.send_response(status);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    ThreadingHTTPServer(('127.0.0.1',port),Proxy).serve_forever()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--cap',type=int,default=80);parser.add_argument('--port',type=int,default=3939)
    args=parser.parse_args();serve(args.output,args.cap,args.port)
