"""Server-only Qloo transport with shared rate limiting and a private disk cache."""
import hashlib
import importlib.util
import json
import os
import sqlite3
import secrets
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

class QlooError(Exception):
    pass

class BudgetError(QlooError):
    pass

class Qloo:
    def __init__(self):
        self.key = os.getenv('QLOO_API_KEY', '')
        self.base = (os.getenv('QLOO_BASE_URL') or 'https://hackathon.api.qloo.com').rstrip('/')
        self.cache = Path(os.getenv('QLOO_CACHE_DIR') or Path.home()/'.cache'/'taste-truce'/'responses')
        self.cache.mkdir(parents=True, exist_ok=True)
        self.state = Path(os.getenv('QLOO_STATE_DIR') or Path.home()/'.local'/'state'/'taste-truce')
        self.state.mkdir(parents=True, exist_ok=True)
        self.database = self.state/'budget.sqlite3'
        self.monthly_cap = min(8000, max(0, int(os.getenv('MONTHLY_CALL_CAP') or '8000')))
        # Leave headroom for calls made outside this installation before accounting began.
        self.monthly_reserved = max(0, int(os.getenv('MONTHLY_RESERVED_CALLS') or '1000'))
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE IF NOT EXISTS months (month TEXT PRIMARY KEY, used INTEGER NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS starts (at REAL NOT NULL)')
        os.chmod(self.database, 0o600)
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
            for row in (json.loads(self.logger.LEDGER.read_text()) if os.getenv('QLOO_PROBE_IMPORT') == '1' else []):
                if row.get('status') == 200 and row.get('raw_file'):
                    data = json.loads((self.logger.OUT/row['raw_file']).read_text())
                    self.save(row['path'], row['params'], data)

    def signature(self, path, params):
        return hashlib.sha256(json.dumps([path, {k:str(v) for k,v in params.items()}], sort_keys=True).encode()).hexdigest()

    def save(self, path, params, data):
        target = self.cache/(self.signature(path, params)+'.json')
        tmp = target.with_suffix('.'+secrets.token_hex(6)+'.tmp')
        tmp.write_text(json.dumps({'saved': time.time(), 'data': data}))
        os.chmod(tmp, 0o600)
        tmp.replace(target)

    def used(self, session):
        with self.lock:
            return self.sessions.get(session, 0)

    def reserve(self, session):
        """Reserve before sending; failures count. SQLite serializes all local workers."""
        while True:
            with self.lock:
                if self.sessions.get(session, 0) >= self.session_cap:
                    raise BudgetError('Session call budget reached. Try the cached Seongsu scene.')
                with sqlite3.connect(self.database, timeout=10) as db:
                    db.execute('BEGIN IMMEDIATE')
                    month = time.strftime('%Y-%m', time.gmtime())
                    db.execute('INSERT OR IGNORE INTO months VALUES (?, ?)', (month, self.monthly_reserved))
                    used = db.execute('SELECT used FROM months WHERE month=?', (month,)).fetchone()[0]
                    if used >= self.monthly_cap:
                        raise BudgetError('Monthly call budget reached. Cached scenes remain available.')
                    now = time.time()
                    db.execute('DELETE FROM starts WHERE at<=?', (now-1.25,))
                    starts = [r[0] for r in db.execute('SELECT at FROM starts ORDER BY at')]
                    # Leave room for network jitter at the provider's five-per-second edge.
                    delay = max(0, starts[-1]+0.30-now) if starts else 0
                    if len(starts)>=4:delay=max(delay, starts[0]+1.25-now)
                    if not delay:
                        db.execute('UPDATE months SET used=used+1 WHERE month=?', (month,))
                        db.execute('INSERT INTO starts VALUES (?)', (now,))
                        self.sessions[session] = self.sessions.get(session, 0)+1
                        return
            time.sleep(delay)

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
            try:
                self.reserve(session)
            except BudgetError:
                if cached.exists():
                    try:
                        return json.loads(cached.read_text())['data'], 'stale · budget reached'
                    except (ValueError, KeyError):
                        pass
                raise
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
