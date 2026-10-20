"""Server-only Qloo transport with shared rate limiting and a private disk cache."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

class QlooError(Exception):
    pass

class Qloo:
    def __init__(self):
        self.key = os.getenv('QLOO_API_KEY', '')
        self.base = (os.getenv('QLOO_BASE_URL') or 'https://hackathon.api.qloo.com').rstrip('/')
        self.cache = Path((os.getenv('QLOO_CACHE_DIR') or '.cache/qloo'))
        self.cache.mkdir(parents=True, exist_ok=True)
        self.ttl = int((os.getenv('QLOO_CACHE_TTL_SECONDS') or '86400'))
        self.session_cap = int((os.getenv('SESSION_CALL_CAP') or '30'))
        self.lock = threading.RLock()
        self.starts = []
        self.sessions = {}
        self.key_locks = {}
        self.logger = None
        logger_path = os.getenv('QLOO_PROBE_LOGGER')
        if logger_path:
            spec = importlib.util.spec_from_file_location('private_probe', logger_path)
            self.logger = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.logger)
            # Import previous responses by exact request signature, without another call.
            for row in json.loads(self.logger.LEDGER.read_text()):
                if row.get('status') == 200 and row.get('raw_file'):
                    data = json.loads((self.logger.OUT/row['raw_file']).read_text())
                    self.save(row['path'], row['params'], data)

    def signature(self, path, params):
        return hashlib.sha256(json.dumps([path, {k:str(v) for k,v in params.items()}], sort_keys=True).encode()).hexdigest()

    def save(self, path, params, data):
        target = self.cache/(self.signature(path, params)+'.json')
        tmp = target.with_suffix('.tmp')
        tmp.write_text(json.dumps({'saved': time.time(), 'data': data}))
        os.chmod(tmp, 0o600)
        tmp.replace(target)

    def used(self, session):
        with self.lock:
            return self.sessions.get(session, 0)

    def request(self, session, path, params):
        digest = self.signature(path, params)
        with self.lock:
            mutex = self.key_locks.setdefault(digest, threading.Lock())
        with mutex:
            cached = self.cache/(digest+'.json')
            if cached.exists():
                try:
                    item = json.loads(cached.read_text())
                    if time.time()-item['saved'] < self.ttl:
                        return item['data'], True
                except (ValueError, KeyError):
                    pass
            if not self.key:
                raise QlooError('Set QLOO_API_KEY on the server, then restart.')
            with self.lock:
                if self.sessions.get(session, 0) >= self.session_cap:
                    raise QlooError('Session call budget reached. Cached plans remain available.')
                self.sessions[session] = self.sessions.get(session, 0)+1
                now = time.monotonic()
                self.starts = [s for s in self.starts if now-s < 1.05]
                if len(self.starts) >= 5:
                    time.sleep(max(0, 1.05-(now-self.starts[0])))
                self.starts.append(time.monotonic())
            if self.logger:
                data = self.logger.call('app-'+digest[:10], path, params)
                if not data or (data.get('errors') or not data.get('success', True)):
                    raise QlooError('Qloo request failed; see the private call ledger.')
            else:
                req = urllib.request.Request(self.base+path+'?'+urllib.parse.urlencode(params), headers={'X-Api-Key': self.key, 'Accept': 'application/json'})
                try:
                    with urllib.request.urlopen(req, timeout=12) as response:
                        data = json.load(response)
                except urllib.error.HTTPError as err:
                    raise QlooError(f'Qloo returned HTTP {err.code}. Please retry later.') from None
                except (OSError, ValueError):
                    raise QlooError('Qloo could not be reached. Please retry later.') from None
                if (data.get('errors') or not data.get('success', True)):
                    raise QlooError('Qloo could not complete this request.')
            self.save(path, params, data)
            return data, False
