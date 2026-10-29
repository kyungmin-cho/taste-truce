import unittest
from agent import compact
from logic import CATEGORY, DINNER, ambiguity, complete_scores, concession, concession_table, consensus, distinct_options, eligible, venue_evidence

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
    def test_rank_sum_table_rows_name_the_fair_pick_without_working_labels(self):
        pool=sequence('ab');lists=[sequence('ab'),sequence('b')]
        pick=next(e for e in consensus(pool,lists,'rank-sum') if not all(e['observed']))
        rows=concession_table([{'name':'A'},{'name':'B'}],lists,sequence('a'),pick)
        labels=[r['label'] for r in rows]
        self.assertIn('Fair pick · lowest rank sum · Popularity #1 · A #1',labels)
        for label in labels:
            with self.subTest(label=label):self.assertNotIn('fallback',label.lower())
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
    def test_bar_veto_covers_qloo_bar_subtypes_but_not_food_bars(self):
        def kind(i,k,genre='New American restaurant'):return place(i,genre,tags=place(i)['tags']+[{'id':CATEGORY+k,'name':k}])
        for k in ['wine_bar','cocktail_bar','sports_bar','bar_grill','irish_pub','brewpub','lounge']:
            with self.subTest(kind=k):
                self.assertFalse(eligible(kind(k,k),'Dinner',{'categories':['bar']}))
                self.assertFalse(eligible(kind(k,k),'Dinner',{'no_bars':True}))
        wine_genre=place('g','Restaurant',tags=place('g')['tags']+[{'id':'urn:tag:genre:place:restaurant:wine_bar','name':'Wine bar'}])
        self.assertFalse(eligible(wine_genre,'Dinner',{'categories':['bar']}))
        for k in ['sushi_bar','espresso_bar','korean_barbecue_restaurant','barbecue_restaurant']:
            with self.subTest(kept=k):self.assertTrue(eligible(kind(k,k,'Korean barbecue restaurant'),'Dinner',{'categories':['bar']}))
        full_bar=place('f',tags=place('f')['tags']+[{'id':'urn:tag:amenity:qloo:full_bar','name':'Full bar'}])
        self.assertTrue(eligible(full_bar,'Dinner',{'categories':['bar']}))
        self.assertTrue(eligible(kind('w','wine_bar'),'Dinner',{'categories':['pub']}))
        self.assertFalse(eligible(kind('p','gastropub'),'Dinner',{'categories':['pub']}))
    def test_bar_veto_reads_the_name_description_and_night_out_tags(self):
        def raw(name,description='',extra=(),cats=('restaurant',),genre='Restaurant',**more):
            tags=[{'id':CATEGORY+c,'name':c} for c in cats]+[{'id':DINNER,'name':'Dinner'}]+[{'id':t,'name':t} for t in extra]
            return compact({'entity_id':name,'name':name,'tags':tags,'properties':{'primary_genre':{'name':genre},'description':description,**more}})
        bars={
            'aperitivo bar in the description':raw('Pasta Counter','Pasta shop and aperitivo bar with a garden.',cats=('restaurant','pasta_shop')),
            'hookah and club tags':raw('Carnival Room','Latin eatery with DJ sets, cocktails and hookah.',extra=('urn:tag:ambience:qloo:club_like','urn:tag:amenity:qloo:hookah')),
            'club tag only':raw('Late Room',extra=('urn:tag:ambience:qloo:club_like',)),
            'supper club in the name':raw('Hilltop Restaurant & Supper Club','Southern food and live music.'),
            'bar and grill in the name':raw('Harbor Bar & Grill'),
            'tavern in the name':raw('Rustic Tavern'),
            'evening cocktail bar':raw('Corner Cafe',service_description='Coffee by day and a cocktail bar in the evening.'),
            'gastropub':raw('Union Hall','A neighborhood gastropub with burgers.'),
            'nightclub genre':raw('Velvet',genre='Nightclub restaurant'),
        }
        for label,e in bars.items():
            with self.subTest(out=label):
                self.assertTrue(venue_evidence(e,'bar'))
                self.assertFalse(eligible(e,'Dinner',{'categories':['bar']}))
                self.assertFalse(eligible(e,'Dinner',{'no_bars':True}))
        kept={
            'cocktails and a full bar':raw('Trattoria','Italian restaurant with pastas and classic cocktails.',extra=('urn:tag:amenity:qloo:full_bar','urn:tag:amenities:place:bar_onsite','urn:tag:beverage_offering:qloo:cocktails'),amenities_description='It offers a full bar and bar seating.'),
            'cellar bar and raw bar':raw('Nordic Table','Tasting menu with a cellar bar.',cuisine_description='Small plates and raw bar selections.'),
            'hotel lobby bar':raw('Hotel Kitchen',amenities_description='Next to a full-service lobby bar.'),
            'lively bar scene':raw('Osteria',overall_description='Known for its high-energy bar scene.'),
            'sushi bar genre':raw('Omakase Room',genre='Sushi bar restaurant',cats=('restaurant','sushi_bar')),
            'barbecue name':raw("Smoky's Bar-B-Q",genre='Barbecue restaurant'),
            'nightlife tag alone':raw('Late Kitchen',extra=('urn:tag:activity_type:qloo:nightlife','urn:tag:offerings:place:late_night_food')),
        }
        for label,e in kept.items():
            with self.subTest(kept=label):
                self.assertEqual(venue_evidence(e,'bar'),[])
                self.assertTrue(eligible(e,'Dinner',{'categories':['bar']}))
                self.assertTrue(eligible(e,'Dinner',{'no_bars':True}))
        self.assertTrue(eligible(bars['aperitivo bar in the description'],'Dinner',{'categories':['pub']}))
        self.assertFalse(eligible(bars['gastropub'],'Dinner',{'categories':['pub']}))
        self.assertFalse(eligible(bars['supper club in the name'],'Dinner',{'categories':['nightclub']}))
        self.assertEqual(compact({'entity_id':'x','name':'x'})['venue_terms'],[])
    def test_search_and_insights_tag_identifiers_are_normalized(self):
        for key in ['id','tag_id']:
            e=compact({'entity_id':'example','name':'Example','tags':[{key:'urn:tag:genre:example','name':'Example'}]})
            self.assertEqual(e['tags'],[{'id':'urn:tag:genre:example','name':'Example'}])
    def test_compact_keeps_only_tags_something_reads(self):
        tags=[{'id':'urn:tag:menu_highlight:place:x','name':'Dumplings'},{'id':'urn:tag:ambience:qloo:cozy','name':'Cozy'},
              {'id':'urn:tag:noise_level:qloo:loud','name':'Loud'},{'id':'urn:tag:setting:qloo:supper_club','name':'Supper club'},
              {'id':'urn:tag:amenity:qloo:vegetarian_options','name':'Vegetarian options'},{'id':'jazz','name':'Jazz'},
              {'id':'urn:tag:payments:place:cash','name':'Cash only'}]
        kept=[t['name'] for t in compact({'entity_id':'x','name':'x','tags':tags})['tags']]
        self.assertEqual(kept,['Cozy','Loud','Supper club','Vegetarian options','Jazz'])

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

class OptionTests(unittest.TestCase):
    def test_a_branch_listed_twice_is_offered_once_and_the_first_stays(self):
        joe=lambda i,name,address:{'id':i,'name':name,'address':address}
        results=[joe('a',"Joe's Pizza",'10 Pizza Ave Brooklyn, NY 11210'),joe('b',"Joe's Pizza",'11 Pizza Ave Brooklyn, NY 11211'),
                 joe('c',"Joe\u2019s Pizza",'12 Pizza Ave Brooklyn, NY 11212'),joe('d',"JOE'S PIZZA",'11 Pizza Ave.,  Brooklyn, NY 11211')]
        self.assertEqual([e['id'] for e in distinct_options(results)],['a','b','c'])
    def test_results_without_an_address_are_all_kept(self):
        results=[{'id':'a','name':'Nirvana'},{'id':'b','name':'Nirvana'},{'id':'c','name':'Nirvana','address':''}]
        self.assertEqual([e['id'] for e in distinct_options(results)],['a','b','c'])

if __name__=='__main__':unittest.main()
