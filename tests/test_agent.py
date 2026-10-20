import unittest
from agent import Agent
from logic import CATEGORY, DINNER

class FakeQloo:
    def __init__(self, fail_scores=False):self.requests=[];self.fail_scores=fail_scores
    def used(self,session):return len(self.requests)
    def request(self,session,path,params):
        self.requests.append((path,params))
        if path=='/search':
            if params['query']=='Ambiguous':
                return {'results':[{'entity_id':'x','name':'Ambiguous'},{'entity_id':'y','name':'Ambiguous Branch'}]},False
            return {'results':[{'entity_id':'seed','name':params['query']}]},False
        count=2 if params.get('filter.location.radius')==2000 else 6
        if 'filter.results.entities' in params:
            ids=params['filter.results.entities'].split(',')
            if self.fail_scores:ids=ids[:1]
        else:ids=[str(i) for i in range(count)]
        rows=[{'entity_id':i,'name':'Place '+i,'properties':{'primary_genre':{'name':'Restaurant'}},'tags':[{'id':CATEGORY+'restaurant','name':'Restaurant'},{'id':DINNER,'name':'Dinner'}],'query':{'affinity':1/(int(i)+1)},'popularity':.5} for i in ids]
        return {'results':{'entities':rows}},False

class LargePoolQloo(FakeQloo):
    def request(self,session,path,params):
        self.requests.append((path,params))
        if path=='/search':
            return {'results':[{'entity_id':params['query'],'name':params['query']}]},False
        if 'filter.results.entities' in params:
            raise AssertionError('The API cannot return all candidates of a pool larger than 50')
        self_ceiling=params['take']
        assert self_ceiling<=50
        start=0 if params.get('signal.interests.entities','A')=='A' else 50
        rows=[{'entity_id':str(i),'name':str(i),'properties':{'primary_genre':{'name':'Restaurant'}},'tags':[{'id':CATEGORY+'restaurant','name':'Restaurant'},{'id':DINNER,'name':'Dinner'}],'query':{'affinity':1/(i+1)}} for i in range(start,start+self_ceiling)]
        return {'results':{'entities':rows}},False

class AgentTests(unittest.TestCase):
    def body(self):return {'people':[{'name':'Friend','seeds':[{'query':'Example film','type':'movie'}]}]}
    def test_widens_a_sparse_pool_then_rescores_the_whole_union(self):
        q=FakeQloo();events=[];result=Agent(q).run('test',self.body(),events.append)
        self.assertEqual(result['radius'],3500)
        self.assertEqual(len(result['picks']),6)
        self.assertEqual(result['method'],'maximin-rank')
        self.assertIn('widen → retry',[x['step']['tool'] for x in events])
    def test_narrow_start_retries_in_order_and_logs_real_shortfall(self):
        class NarrowQloo(FakeQloo):
            def request(self,session,path,params):
                if params.get('filter.location.radius')==100:
                    self.requests.append((path,params));return {'results':{'entities':[]}},False
                return super().request(session,path,params)
        q=NarrowQloo();events=[]
        result=Agent(q).run('test',{**self.body(),'start_radius':100},events.append)
        self.assertEqual(result['radius'],3500)
        widen=[e['step'] for e in events if e['step']['tool']=='widen → retry']
        self.assertEqual([s['count'] for s in widen],[0,2])
        self.assertEqual([s['entities'][0] for s in widen],['100 → 2000 m','2000 → 3500 m'])
        params=[p for path,p in q.requests if 'filter.location.radius' in p]
        self.assertEqual(sorted({(p['filter.location.radius'],p['take']) for p in params}),[(100,10),(2000,30),(3500,40)])
        self.assertEqual(result['pool_size'],6)

    def test_large_disjoint_pool_uses_supported_take_and_marks_unknown_ranks(self):
        q=LargePoolQloo();people=[{'name':name,'seeds':[{'query':name,'type':'movie'}]} for name in ['A','B']]
        result=Agent(q).run('test',{'people':people},lambda _:None)
        self.assertEqual(result['method'],'rank-sum')
        self.assertEqual(result['pool_size'],100)
        self.assertIn(False,result['picks'][0]['observed'])
        self.assertEqual(sum(path=='/v2/insights' for path,_ in q.requests),5)

    def test_incomplete_rescore_uses_larger_rank_sum_retrieval(self):
        q=FakeQloo(True);result=Agent(q).run('test',self.body(),lambda _:None)
        self.assertEqual(result['method'],'rank-sum')
        self.assertTrue(any(p.get('take')==50 for _,p in q.requests))
    def test_ambiguous_place_pauses_before_insights_even_with_one_exact_name(self):
        q=FakeQloo();body=self.body();body['people'][0]['seeds']=[{'query':'Ambiguous','type':'place'}]
        result=Agent(q).run('test',body,lambda _:None)
        self.assertEqual(result['status'],'clarification')
        self.assertEqual(len(result['questions'][0]['options']),2)
        self.assertTrue(all(path=='/search' for path,_ in q.requests))

if __name__=='__main__':unittest.main()
