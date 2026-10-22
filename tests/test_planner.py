import io
import json
import os
import unittest
from unittest.mock import patch
from planner import choose_tools, local_tools, apply_tools, validate, observe_replan

class PlannerTests(unittest.TestCase):
    def test_common_phrasings_and_combined_conditions(self):
        cases={'no bars please':'exclude_categories',"I'd rather avoid pubs tonight":'exclude_categories','somewhere quieter':'exclude_tags','a less noisy place':'exclude_tags','not that place please':'exclude_place','somewhere else':'exclude_place','a cheaper option':'prefer_budget','more affordable please':'prefer_budget','look farther away':'widen_radius','coffee instead':'change_occasion','move to Williamsburg':'change_area','add a vegetarian friend':'add_friend','술집 빼고 조용한 곳':'exclude_categories'}
        for text,tool in cases.items():
            with self.subTest(text=text):self.assertIn(tool,[x['name'] for x in validate(local_tools(text))])
        self.assertEqual([a['name'] for a in local_tools('no bars please and somewhere quieter')],['exclude_categories','exclude_tags'])
    def test_real_http_tool_response_is_validated_and_failure_falls_back(self):
        config={'LLM_BASE_URL':'http://localhost:9999/v1','LLM_API_KEY':'synthetic-test-token','LLM_MODEL':'test'}
        response={'choices':[{'message':{'tool_calls':[{'function':{'name':'exclude_place','arguments':'{"target":"current"}'}}]}}]}
        with patch.dict(os.environ,config),patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(response).encode())) as network:
            planner,actions=choose_tools('not that place',{})
            self.assertEqual(planner,'LLM planner');self.assertEqual(actions[0]['name'],'exclude_place')
            request=network.call_args[0][0];body=json.loads(request.data)
            self.assertTrue(body['tools']);self.assertEqual(body['tool_choice'],'required')
            self.assertEqual(network.call_args[1]['timeout'],8.0)
        with patch.dict(os.environ,config),patch('urllib.request.urlopen',side_effect=OSError()):
            planner,actions=choose_tools('no bars please',{})
            self.assertIn('LLM unavailable',planner);self.assertEqual(actions[0]['name'],'exclude_categories')
    def test_llm_timeout_is_configurable_and_failures_log_only_the_status(self):
        import contextlib,urllib.error
        config={'LLM_BASE_URL':'http://localhost:9999/v1','LLM_API_KEY':'synthetic-test-token','LLM_MODEL':'test','LLM_TIMEOUT_SECONDS':'3'}
        denied=urllib.error.HTTPError('http://localhost:9999/v1/chat/completions',403,'Forbidden',{},io.BytesIO(b'{"error":"synthetic-test-token"}'))
        log=io.StringIO()
        with patch.dict(os.environ,config),patch('urllib.request.urlopen',side_effect=denied) as network,contextlib.redirect_stderr(log):
            planner,_=choose_tools('no bars please',{})
        self.assertIn('LLM unavailable',planner);self.assertEqual(network.call_args[1]['timeout'],3.0)
        self.assertIn('planner: LLM unavailable (403)',log.getvalue());self.assertNotIn('synthetic-test-token',log.getvalue())
    def test_planner_and_observe_requests_send_an_explicit_user_agent(self):
        # Cloudflare-fronted providers reject the default Python-urllib agent with 403 (error 1010).
        config={'LLM_BASE_URL':'http://localhost:9999/v1','LLM_API_KEY':'synthetic-test-token','LLM_MODEL':'test'}
        response={'choices':[{'message':{'tool_calls':[{'function':{'name':'exclude_place','arguments':'{"target":"current"}'}}]}}]}
        for call in [lambda:choose_tools('not that place',{}),lambda:observe_replan('no bars',{},[],{'remaining_count':30,'radius':2000,'nothing_matched':False})]:
            with patch.dict(os.environ,config),patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(response).encode())) as network:
                source,_=call()
                self.assertEqual(source,'LLM planner')
                headers={k.lower():v for k,v in network.call_args[0][0].header_items()}
                self.assertTrue(headers.get('user-agent'));self.assertFalse(headers['user-agent'].startswith('Python-urllib'))
    def test_malformed_or_unbounded_model_tools_use_local_fallback(self):
        response={'choices':[{'message':{'tool_calls':[{'function':{'name':'change_area','arguments':'{"area":"Atlantis"}'}}]}}]}
        with patch.dict(os.environ,{'LLM_BASE_URL':'http://localhost','LLM_API_KEY':'synthetic-test-token','LLM_MODEL':'test'}),patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(response).encode())):
            planner,actions=choose_tools('move to Williamsburg',{})
            self.assertIn('Local',planner);self.assertEqual(actions[0]['arguments']['area'],'Williamsburg NYC')
        for args in [{'name':'score','arguments':{}},{'name':'exclude_place','arguments':{'target':'arbitrary-id'}},{'name':'add_friend','arguments':{'name':'X','vegetarian':1}}]:
            with self.assertRaises(ValueError):validate([args])
    def test_friend_is_asked_for_a_taste_without_inventing_one(self):
        scene={'people':[{'name':'A','seeds':[{'query':'Film','type':'movie'}]}],'area':'Seongsu','occasion':'Dinner','start_radius':2000}
        result,veto,needs=apply_tools(scene,{'excluded':[]},local_tools('add a vegetarian friend'),None)
        self.assertTrue(needs);self.assertTrue(veto['vegetarian'])
        self.assertEqual(result['people'][1]['seeds'][0]['query'],'')
        self.assertEqual(len(scene['people']),1)
        result,_,_=apply_tools(scene,{},local_tools('search farther and change to Williamsburg for coffee'),None)
        self.assertEqual((result['start_radius'],result['area'],result['occasion']),(3500,'Williamsburg NYC','Cafe'))

class ObservationTests(unittest.TestCase):
    def test_empty_text_never_calls_llm(self):
        with patch.dict(os.environ,{'LLM_BASE_URL':'http://unused','LLM_API_KEY':'test','LLM_MODEL':'test'}),patch('urllib.request.urlopen') as network:
            source,actions=choose_tools(' ',{})
            self.assertEqual(actions,[{'name':'plan','arguments':{}}]);network.assert_not_called()
    def test_local_next_steps_match_actual_observation(self):
        with patch.dict(os.environ,{'LLM_BASE_URL':''}):
            _,steps=observe_replan('no bars',{},[],{'remaining_count':30,'radius':2000,'nothing_matched':True})
            self.assertEqual(steps[0]['name'],'exclude_tags')
            _,steps=observe_replan('quieter',{},[],{'remaining_count':6,'radius':2000,'nothing_matched':False})
            self.assertEqual(steps[0]['arguments'],{'radius':5000})
    def test_llm_receives_executed_tool_result_and_returns_valid_suggestion(self):
        answer={'choices':[{'message':{'tool_calls':[{'function':{'name':'widen_radius','arguments':'{"radius":5000}'}}]}}]}
        config={'LLM_BASE_URL':'http://localhost/v1','LLM_API_KEY':'test','LLM_MODEL':'test'}
        with patch.dict(os.environ,config),patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(answer).encode())) as network:
            source,steps=observe_replan('quieter',{},[{'name':'exclude_tags','arguments':{'tags':['Loud']}}],{'remaining_count':6,'radius':2000,'nothing_matched':False})
            self.assertEqual(source,'LLM planner');self.assertEqual(steps[0]['name'],'widen_radius')
            messages=json.loads(network.call_args[0][0].data)['messages']
            self.assertEqual(messages[-1]['role'],'tool');self.assertEqual(json.loads(messages[-1]['content'])['remaining_count'],6)

    def test_repeated_radius_is_replaced_by_a_useful_local_suggestion(self):
        answer={'choices':[{'message':{'tool_calls':[{'function':{'name':'widen_radius','arguments':'{"radius":3500}'}}]}}]}
        config={'LLM_BASE_URL':'http://localhost/v1','LLM_API_KEY':'test','LLM_MODEL':'test'}
        with patch.dict(os.environ,config),patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(answer).encode())):
            source,steps=observe_replan('search farther',{},[{'name':'widen_radius','arguments':{'radius':3500}}],{'remaining_count':23,'radius':3500,'nothing_matched':False})
            self.assertIn('repeated radius rejected',source);self.assertEqual(steps[0]['name'],'exclude_place')
