import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from qloo import Qloo,QlooError,BudgetError

class TransportTests(unittest.TestCase):
    def test_cached_requests_do_not_spend_the_session_budget(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_STATE_DIR':directory,'QLOO_API_KEY':'synthetic-test-token','SESSION_CALL_CAP':'1','QLOO_PROBE_LOGGER':''}):
            q=Qloo();payload={'success':True,'results':[]}
            with patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(payload).encode())) as network:
                first,hit=q.request('session','/search',{'query':'A'})
                second,cached=q.request('session','/search',{'query':'A'})
            self.assertFalse(hit);self.assertTrue(cached);self.assertEqual(first,second)
            self.assertEqual(q.used('session'),1);self.assertEqual(network.call_count,1)
            with self.assertRaises(QlooError):q.request('session','/search',{'query':'B'})
    def test_monthly_budget_survives_restart_and_serializes_workers(self):
        from concurrent.futures import ThreadPoolExecutor
        import sqlite3
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_STATE_DIR':directory,'QLOO_API_KEY':'synthetic-test-token','QLOO_PROBE_LOGGER':'','MONTHLY_CALL_CAP':'1002','MONTHLY_RESERVED_CALLS':'1000'}):
            workers=[Qloo() for _ in range(4)]
            def reserve(i):
                try:workers[i].reserve(str(i));return True
                except BudgetError:return False
            with ThreadPoolExecutor(max_workers=4) as pool:
                outcomes=list(pool.map(reserve,range(4)))
            self.assertEqual(sum(outcomes),2)
            with self.assertRaises(BudgetError):Qloo().reserve('new-session')
            with sqlite3.connect(workers[0].database) as db:
                self.assertEqual(db.execute('SELECT used FROM months').fetchone()[0],1002)

    def test_exhausted_budget_serves_fresh_and_stale_cache_without_network(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_STATE_DIR':directory,'QLOO_API_KEY':'synthetic-test-token','QLOO_PROBE_LOGGER':'','MONTHLY_CALL_CAP':'1','MONTHLY_RESERVED_CALLS':'1'}):
            q=Qloo();payload={'results':[]};q.save('/search',{'query':'A'},payload)
            with patch('urllib.request.urlopen') as network:
                self.assertTrue(q.request('s','/search',{'query':'A'})[1])
                q.ttl=-1
                self.assertEqual(q.request('s','/search',{'query':'A'}),(payload,'stale · budget reached'))
                with self.assertRaises(BudgetError):q.request('s','/search',{'query':'B'})
                network.assert_not_called()
            self.assertEqual(q.used('s'),0)

    def test_rate_limit_is_shared_by_transport_instances(self):
        from concurrent.futures import ThreadPoolExecutor
        import sqlite3
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_STATE_DIR':directory,'QLOO_PROBE_LOGGER':''}):
            workers=[Qloo() for _ in range(6)]
            with ThreadPoolExecutor(max_workers=6) as pool:
                list(pool.map(lambda i:workers[i].reserve(str(i)),range(6)))
            with sqlite3.connect(workers[0].database) as db:
                self.assertEqual(db.execute('SELECT used FROM months').fetchone()[0],1006)
                # The sixth start only becomes possible once the first window expires.
                self.assertLessEqual(db.execute('SELECT count(*) FROM starts').fetchone()[0],5)

    def test_new_utc_month_gets_its_own_reserved_balance(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_STATE_DIR':directory,'QLOO_PROBE_LOGGER':''}):
            q=Qloo()
            for month in ['2026-10','2026-11']:
                with patch('qloo.time.strftime',return_value=month):q.reserve(month)
            with sqlite3.connect(q.database) as db:
                self.assertEqual(db.execute('SELECT month, used FROM months ORDER BY month').fetchall(),[('2026-10',1001),('2026-11',1001)])

    def test_failed_upstream_request_is_charged_and_cap_cannot_exceed_8000(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_STATE_DIR':directory,'QLOO_API_KEY':'synthetic-test-token','QLOO_PROBE_LOGGER':'','MONTHLY_CALL_CAP':'99999'}):
            q=Qloo();self.assertEqual(q.monthly_cap,8000)
            with patch('urllib.request.urlopen',side_effect=OSError('offline')):
                with self.assertRaises(QlooError):q.request('s','/search',{'query':'A'})
            self.assertEqual(q.used('s'),1)

    def test_blank_optional_environment_values_keep_safe_defaults(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_STATE_DIR':directory,'QLOO_BASE_URL':'','SESSION_CALL_CAP':'','QLOO_CACHE_TTL_SECONDS':'','QLOO_PROBE_LOGGER':''}):
            q=Qloo();self.assertEqual(q.session_cap,30)
            self.assertEqual(q.base,'https://hackathon.api.qloo.com')

if __name__=='__main__':unittest.main()
