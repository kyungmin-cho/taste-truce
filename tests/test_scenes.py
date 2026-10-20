import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch
from qloo import Qloo, QlooError
from scenes import default_scene, read_scene, save_scene, health
from logic import concession_table

class SceneTests(unittest.TestCase):
    def test_default_env_and_snapshot_ttl(self):
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'QLOO_CACHE_DIR':root,'QLOO_STATE_DIR':root,'DEFAULT_SCENE':'majority','DEFAULT_SCENE_TTL_SECONDS':'0'}):
            q=Qloo();self.assertEqual(default_scene(),'majority');self.assertTrue(health(q)['needs_new_calls'])
            save_scene(q,'majority',{'picks':[]})
            file=q.cache/(q.signature('/scene/majority',{})+'.json');item=json.loads(file.read_text());item['saved']=time.time()-40*86400;file.write_text(json.dumps(item))
            self.assertIsNotNone(read_scene(q,'majority'));self.assertFalse(health(q)['needs_new_calls'])
            with patch.dict(os.environ,{'DEFAULT_SCENE_TTL_SECONDS':str(30*86400)}):self.assertIsNone(read_scene(q,'majority'))
            with patch.dict(os.environ,{'DEFAULT_SCENE_TTL_SECONDS':'86400'}):self.assertIsNone(read_scene(q,'majority'))
    def test_response_cache_default_has_no_ttl_and_expiry_is_configurable(self):
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'QLOO_CACHE_DIR':root,'QLOO_STATE_DIR':root,'QLOO_CACHE_TTL_SECONDS':'0'}):
            q=Qloo();q.save('/search',{}, {'results':[]})
            file=q.cache/(q.signature('/search',{})+'.json');item=json.loads(file.read_text());item['saved']=time.time()-40*86400;file.write_text(json.dumps(item))
            with patch('urllib.request.urlopen') as network:
                self.assertTrue(q.request('s','/search',{})[1]);network.assert_not_called()
            q.ttl=30*86400;q.key=''
            with self.assertRaises(QlooError):q.request('s','/search',{})
    def test_table_contains_all_personal_choices_majority_and_unknown_cells(self):
        a={'id':'a','name':'A'};b={'id':'b','name':'B'};c={'id':'c','name':'C','observed':[True]*3}
        people=[{'name':n} for n in ['One','Two','Three']]
        rows=concession_table(people,[[a,c,b],[b,c,a],[b,c,a]],[a],c)
        self.assertEqual([r['ranks'] for r in rows],[[1,3,3],[1,3,3],[3,1,1],[3,1,1],[3,1,1],[2,2,2]])
        self.assertEqual(rows[-2]['label'],'Majority #1 (2/3)')
        rows=concession_table(people,[[a],[b],[b]],[c],c)
        self.assertEqual(rows[0]['ranks'],[None]*3);self.assertIsNone(rows[0]['worst_rank'])
