import unittest
from agent import compact
from logic import CATEGORY, DINNER, ambiguity, complete_scores, concession, consensus, eligible

def place(i,genre='Korean barbecue restaurant',tags=None):
    return {'id':i,'name':i,'genre':genre,'tags':tags or [{'id':CATEGORY+'restaurant','name':'Restaurant'},{'id':DINNER,'name':'Dinner'}]}

def sequence(ids):return [place(i) for i in ids]

class ConsensusTests(unittest.TestCase):
    def test_maximin_protects_the_worst_rank_while_sum_favors_two_people(self):
        lists=[sequence('axbyz'),sequence('axbyz'),sequence('xybza')]
        pool=sequence('ab')
        self.assertEqual(consensus(pool,lists,'maximin-rank')[0]['id'],'b')
        self.assertEqual(consensus(pool,lists,'rank-sum')[0]['id'],'a')
    def test_missing_score_is_never_claimed_as_a_complete_consensus(self):
        pool=sequence('ab');lists=[sequence('ab'),sequence('a')]
        self.assertEqual([e['id'] for e in consensus(pool,lists)],['a'])
        result=consensus(pool,lists,'rank-sum')
        self.assertEqual(result[1]['observed'],[True,False])
        self.assertFalse(complete_scores(pool,[dict(place('a'),affinity=.7)]))
    def test_concession_uses_rank_and_recorded_tag_difference(self):
        first=place('a',tags=[{'id':'jazz','name':'Jazz'}]);pick=place('b',tags=[{'id':'noodles','name':'Noodles'}])
        picked=consensus([pick],[[first,pick],[pick]],limit=1)[0]
        c=concession({'name':'Friend','seeds':[{'query':'Example film'}]},[first,pick],picked,0)
        self.assertEqual(c['rank_drop'],1)
        self.assertEqual(c['removed_tags'],['Jazz']);self.assertEqual(c['added_tags'],['Noodles'])
        self.assertIn('People who like',c['text']);self.assertNotIn('you will love',c['text'])
    def test_no_bars_preserves_barbecue_and_excludes_dual_tagged_places(self):
        self.assertTrue(eligible(place('a'),'Dinner',{'no_bars':True}))
        bar=place('b','Barbecue restaurant',tags=place('b')['tags']+[{'id':CATEGORY+'bar','name':'Bar'}])
        self.assertFalse(eligible(bar,'Dinner',{'no_bars':True}))
        self.assertFalse(eligible(place('c','Beer store'),'Dinner',{}))
        self.assertFalse(eligible(place('d'),'Dinner',{'excluded':['d']}))
    def test_search_and_insights_tag_identifiers_are_normalized(self):
        for key in ['id','tag_id']:
            e=compact({'entity_id':'example','name':'Example','tags':[{key:'urn:tag:example','name':'Example'}]})
            self.assertEqual(e['tags'],[{'id':'urn:tag:example','name':'Example'}])

    def test_exact_name_homonyms_require_clarification(self):
        self.assertTrue(ambiguity([{'name':'Example'},{'name':'Example'}],'Example'))
        self.assertFalse(ambiguity([{'name':'Example'},{'name':'Something else'}],'Example'))

class ConstraintTests(unittest.TestCase):
    def test_recorded_price_quiet_and_vegetarian_are_required(self):
        e=dict(place('a'),price_level=2)
        self.assertTrue(eligible(e,'Dinner',{'max_price_level':2}))
        self.assertFalse(eligible(place('a'),'Dinner',{'max_price_level':2}))
        self.assertFalse(eligible(e,'Dinner',{'vegetarian':True}))
        e['tags'].append({'id':'urn:tag:offerings:place:vegetarian_options','name':'Vegetarian meals'})
        self.assertTrue(eligible(e,'Dinner',{'vegetarian':True}))
        e['tags'].append({'id':'urn:tag:noise_level:qloo:loud','name':'Loud'})
        self.assertFalse(eligible(e,'Dinner',{'tags':['Loud']}))
    def test_first_rank_never_says_zero_place_drop(self):
        e=place('a');pick=consensus([e],[[e]])[0]
        c=concession({'name':'A','seeds':[{'query':'Film'}]},[e],pick,0)
        self.assertIn('also #1',c['text']);self.assertNotIn('0-place',c['text'])

class ContrastTests(unittest.TestCase):
    def test_overlap_rank_shifts_and_missing_popularity_rank_are_honest(self):
        from logic import taste_contrast
        a,b,c=[dict(place(x),popularity=pop) for x,pop in [('a',.9),('b',.8),('c',.7)]]
        baseline,comparison=taste_contrast([b,c],[b,c,a],[a,b])
        self.assertEqual(comparison['overlap'],1)
        self.assertEqual(comparison['pick_popularity_rank'],2)
        rows={r['id']:r for r in comparison['rows']}
        self.assertEqual(rows['a']['change'],'removed')
        self.assertEqual(rows['a']['taste_rank'],3)
        self.assertIsNone(rows['c']['popularity_rank'])
        self.assertEqual(rows['c']['change'],'added')
        self.assertEqual(rows['b']['change'],'shared')

if __name__=='__main__':unittest.main()
