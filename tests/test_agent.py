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
            ids=params['filter.results.entities'].split(',');assert len(ids)<=50
            return {'results':{'entities':[{'entity_id':i,'name':i,'query':{'affinity':1/(int(i)+1)}} for i in ids]}},False
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

    def test_large_disjoint_pool_is_bounded_and_rescored_for_maximin(self):
        q=LargePoolQloo();people=[{'name':name,'seeds':[{'query':name,'type':'movie'}]} for name in ['A','B']]
        result=Agent(q).run('test',{'people':people},lambda _:None)
        self.assertEqual(result['method'],'maximin-rank')
        self.assertEqual(result['pool_size'],50)
        self.assertTrue(all(result['picks'][0]['observed']))
        pools=[set(p['filter.results.entities'].split(',')) for _,p in q.requests if 'filter.results.entities' in p]
        self.assertEqual(pools[0],pools[1])
        self.assertTrue(set(map(str,range(25))).issubset(pools[0]))
        self.assertTrue(set(map(str,range(50,75))).issubset(pools[0]))
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

class ReviewRegressionTests(unittest.TestCase):
    def test_single_inexact_place_is_clarified_and_can_be_skipped(self):
        class Inexact(FakeQloo):
            def request(self,session,path,params):
                if path=='/search' and params['query']=='Unknown palace':
                    self.requests.append((path,params))
                    return {'results':[{'entity_id':'wrong','name':'A restaurant'}]},False
                return super().request(session,path,params)
        q=Inexact();body={'people':[{'name':'A','seeds':[{'query':'Film','type':'movie'},{'query':'Unknown palace','type':'place'}]}]}
        result=Agent(q).run('s',body,lambda _:None)
        self.assertEqual(result['status'],'clarification');self.assertEqual(len(result['questions'][0]['options']),1)
        self.assertTrue(all(path=='/search' for path,_ in q.requests))
        result=Agent(q).run('s',{**body,'choices':{'0:1':'skip'}},lambda _:None)
        self.assertEqual(result['status'],'done');self.assertEqual(len(result['people'][0]['seeds']),1)
        self.assertEqual(result['choices'],{'0:0':'seed'})
    def test_no_matching_veto_reports_no_change(self):
        result=Agent(FakeQloo()).run('s',{'people':[{'name':'A','seeds':[{'query':'Film','type':'movie'}]}],'veto_text':'no bars please'},lambda _:None)
        self.assertEqual(result['excluded_count'],0);self.assertEqual(result['notice'],'Nothing matched, nothing changed.')
    def test_unknown_intent_records_parser_and_does_not_call_qloo(self):
        events=[];q=FakeQloo()
        with self.assertRaises(ValueError):Agent(q).run('s',{'veto_text':'something completely unknown'},events.append)
        self.assertEqual(q.requests,[]);self.assertEqual(events[0]['step']['tool'],'Local planner')

    def test_friend_request_pauses_before_network(self):
        q=FakeQloo();result=Agent(q).run('s',{'veto_text':'add a vegetarian friend'},lambda _:None)
        self.assertEqual(result['status'],'friend_taste');self.assertEqual(len(result['people']),4);self.assertEqual(q.requests,[])
    def test_contributions_are_attached_by_seed_and_person(self):
        class Explain(FakeQloo):
            def request(self,session,path,params):
                data,hit=super().request(session,path,params)
                if 'filter.results.entities' in params:
                    assert params['feature.explainability']=='true'
                    for e in data['results']['entities']:e['query']['explainability']={'signal.interests.entities':[{'entity_id':'seed','score':.75}]}
                return data,hit
        result=Agent(Explain()).run('s',{'people':[{'name':'A','seeds':[{'query':'Film','type':'movie'}]}]},lambda _:None)
        self.assertEqual(result['concessions'][0]['contributions'],[{'seed':'Film','score':.75}])

if __name__=='__main__':unittest.main()

class NeighborhoodRadiusTests(unittest.TestCase):
    class Sparse(FakeQloo):
        def request(self,session,path,params):
            if 'filter.location.radius' in params and 'filter.results.entities' not in params:
                self.requests.append((path,params))
                rows=[{'entity_id':i,'name':'Place '+i,'properties':{'primary_genre':{'name':'Restaurant'}},'tags':[{'id':CATEGORY+'restaurant','name':'Restaurant'},{'id':DINNER,'name':'Dinner'}],'query':{'affinity':1/(int(i)+1)},'popularity':.5} for i in '01']
                return {'results':{'entities':rows}},False
            return super().request(session,path,params)
    def radii(self,q):return sorted({p['filter.location.radius'] for _,p in q.requests if 'filter.location.radius' in p})
    def body(self,area,**extra):return {'people':[{'name':'A','seeds':[{'query':'Film','type':'movie'}]}],'area':area,**extra}

    def test_sparse_williamsburg_search_stops_at_three_and_a_half_km(self):
        q=self.Sparse();events=[]
        result=Agent(q).run('s',self.body('Williamsburg NYC'),events.append)
        self.assertEqual(self.radii(q),[2000,3500]);self.assertEqual(result['radius'],3500)
        self.assertIn('candidate limit reached',[e['step']['tool'] for e in events])
        q=self.Sparse();Agent(q).run('s',self.body('Seongsu'),lambda _:None)
        self.assertEqual(self.radii(q),[2000,3500,5000])

    def test_suggested_or_linked_wide_radius_stays_in_williamsburg(self):
        for extra in [{'suggested_action':{'name':'widen_radius','arguments':{'radius':5000}},'veto_text':'Search farther · 5 km'},{'start_radius':5000}]:
            with self.subTest(extra=extra):
                q=self.Sparse();result=Agent(q).run('s',self.body('Williamsburg NYC',**extra),lambda _:None)
                self.assertEqual(self.radii(q),[3500]);self.assertEqual(result['start_radius'],3500)

    def test_suggested_veto_does_not_widen_past_the_neighborhood(self):
        q=self.Sparse()
        result=Agent(q).run('s',self.body('Williamsburg NYC',suggested_action={'name':'exclude_tags','arguments':{'tags':['Loud','Busy','Lively']}},veto_text='Somewhere quieter'),lambda _:None)
        self.assertLessEqual(max(self.radii(q)),3500)
        self.assertNotIn('widen_radius',[s['name'] for s in result['suggestions']])

    def test_williamsburg_keeps_brooklyn_addresses_only(self):
        class Boroughs(FakeQloo):
            addresses={'0':'1 Bedford Ave, Brooklyn, NY 11211','1':'2 Delancey St, New York, NY 10002','2':'3 Kent Ave 11249','3':'4 Avenue A, New York, NY 10009','4':'5 Grand St, Brooklyn, NY 11211','5':'','6':'성동구 성수이로 1'}
            def request(self,session,path,params):
                data,hit=super().request(session,path,params)
                if path!='/search':
                    for e in data['results']['entities']:e['properties']['address']=self.addresses.get(e['entity_id'],'')
                return data,hit
        q=Boroughs();result=Agent(q).run('s',{'people':[{'name':'A','seeds':[{'query':'Film','type':'movie'}]}],'area':'Williamsburg NYC'},lambda _:None)
        self.assertEqual({p['id'] for p in result['picks']},{'0','2','4','5'})
        self.assertTrue(all(e['id'] in {'0','2','4','5'} for e in result['baseline']))
        self.assertEqual(result['excluded_count'],0)
        result=Agent(Boroughs()).run('s',{'people':[{'name':'A','seeds':[{'query':'Film','type':'movie'}]}],'area':'Seongsu'},lambda _:None)
        self.assertEqual(len(result['picks']),6)
