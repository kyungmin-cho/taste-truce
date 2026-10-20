import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch
from qloo import Qloo, BudgetError
from server import Handler
from sessions import Sessions

class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'QLOO_CACHE_DIR':self.temp.name,'QLOO_STATE_DIR':self.temp.name,'IP_DAILY_CALL_CAP':'1','IP_DAILY_SESSION_CAP':'2','MAX_SESSIONS':'2','TRUSTED_PROXY_HEADER':'X-Forwarded-For','TRUSTED_PROXY_IPS':'127.0.0.2'})
        self.env.start();self.q=Qloo();self.sessions=Sessions(self.q)
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def test_session_cap_eviction_cleanup_and_daily_issuance(self):
        one=self.sessions.issue('','ip1');two=self.sessions.issue('','ip1')
        self.q.sessions[one]=1
        third=self.sessions.issue('','ip2')
        self.assertEqual(len(self.sessions.rows),2);self.assertIsNone(self.sessions.get(one,'ip1'))
        self.assertNotIn(one,self.q.sessions);self.assertNotIn(one,self.q.session_ips)
        with self.assertRaises(ValueError):self.sessions.issue('','ip1')
        self.assertIsNotNone(self.sessions.get(third,'ip2'))
    def test_ip_daily_call_budget_survives_new_sessions_and_restart(self):
        one=self.sessions.issue('','ip');self.q.reserve(one)
        two=self.sessions.issue('','ip')
        with self.assertRaises(BudgetError):self.q.reserve(two)
        restarted=Qloo();restarted.bind_session('third','ip')
        with self.assertRaises(BudgetError):restarted.reserve('third')
        restarted.save('/search',{}, {'results':[]})
        self.assertTrue(restarted.request('third','/search',{})[1])
    def test_only_explicit_proxy_peer_can_supply_ip(self):
        headers={'X-Forwarded-For':'192.0.2.4, 192.0.2.5'}
        self.assertEqual(self.sessions.ip(SimpleNamespace(client_address=('127.0.0.1',0),headers=headers)),'127.0.0.1')
        self.assertEqual(self.sessions.ip(SimpleNamespace(client_address=('127.0.0.2',0),headers=headers)),'192.0.2.4')
    def test_session_binding_expiry_and_active_slot_protection(self):
        one=self.sessions.issue('','ip');self.assertIsNone(self.sessions.get(one,'other'))
        mutex,error=self.sessions.acquire(one,'ip');self.assertIsNone(error)
        self.sessions.cap=1
        with self.assertRaises(ValueError):self.sessions.issue('','other')
        mutex.release()
        self.sessions.rows[one]['at']=0
        self.assertIsNone(self.sessions.get(one,'ip'))
    def test_get_issues_cookie_and_unknown_posts_never_reach_agent(self):
        app=ThreadingHTTPServer(('127.0.0.1',0),Handler);app.qloo=self.q;app.sessions=self.sessions
        class FakeAgent:
            calls=0
            def run(self,*args):self.calls+=1;return {'status':'clarification','veto':{}}
        app.agent=FakeAgent();thread=threading.Thread(target=app.serve_forever,daemon=True);thread.start()
        def request(method,path,headers={}):
            c=http.client.HTTPConnection(*app.server_address)
            c.request(method,path,body='{}' if method=='POST' else None,headers=headers)
            r=c.getresponse();result=(r.status,dict(r.getheaders()),r.read());c.close();return result
        try:
            for cookie in ['', 'taste_session=unknown']:
                self.assertEqual(request('POST','/api/plan',{'Cookie':cookie})[0],403)
            self.assertEqual(app.agent.calls,0)
            status,headers,_=request('GET','/')
            self.assertEqual(status,200);self.assertIn('HttpOnly',headers['Set-Cookie']);self.assertIn('SameSite=Strict',headers['Set-Cookie'])
            self.assertEqual(request('POST','/api/plan',{'Cookie':headers['Set-Cookie'].split(';')[0]})[0],200)
            self.assertEqual(app.agent.calls,1)
            self.assertEqual(request('GET','/vendor/leaflet/leaflet.js')[0],200)
            self.assertEqual(request('GET','/vendor/leaflet/images/marker-icon.png')[0],200)
            self.assertEqual(request('GET','/vendor/leaflet/../../server.py')[0],404)
            self.assertEqual(request('GET','/')[0],200)
            self.assertEqual(request('GET','/')[0],429)
        finally:app.shutdown();app.server_close();thread.join()
