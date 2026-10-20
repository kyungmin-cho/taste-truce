import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from qloo import Qloo,QlooError

class TransportTests(unittest.TestCase):
    def test_cached_requests_do_not_spend_the_session_budget(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_API_KEY':'synthetic-test-token','SESSION_CALL_CAP':'1','QLOO_PROBE_LOGGER':''}):
            q=Qloo();payload={'success':True,'results':[]}
            with patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(payload).encode())) as network:
                first,hit=q.request('session','/search',{'query':'A'})
                second,cached=q.request('session','/search',{'query':'A'})
            self.assertFalse(hit);self.assertTrue(cached);self.assertEqual(first,second)
            self.assertEqual(q.used('session'),1);self.assertEqual(network.call_count,1)
            with self.assertRaises(QlooError):q.request('session','/search',{'query':'B'})
    def test_blank_optional_environment_values_keep_safe_defaults(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'QLOO_CACHE_DIR':directory,'QLOO_BASE_URL':'','SESSION_CALL_CAP':'','QLOO_CACHE_TTL_SECONDS':'','QLOO_PROBE_LOGGER':''}):
            q=Qloo();self.assertEqual(q.session_cap,30)
            self.assertEqual(q.base,'https://hackathon.api.qloo.com')

if __name__=='__main__':unittest.main()
