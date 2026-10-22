import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from agent import Agent
from test_agent import FakeQloo, LargePoolQloo

ROOT=Path(__file__).resolve().parent.parent
NODE=shutil.which('node')
UUID=re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',re.I)
ID=['00000000-0000-4000-8000-%012d'%i for i in range(50)]
# Working labels the server writes into steps; none may reach the panel.
HIDDEN=['take ','bound candidate union','maximin-rank','rank-sum ·','Direct plan','plan · Plan this scene','validate category','widen → retry','candidate limit','per person','at most 50',' entities','All input names','<hr>']

def render(rows):
    """Run static/steps.js in node and return its view and markup for each row."""
    if NODE is None:raise AssertionError('node is required to test static/steps.js')
    script='const S=require(process.argv[1]);const rows=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(rows.map(r=>({view:S.view(r),html:S.html(r)}))))'
    out=subprocess.run([NODE,'-e',script,str(ROOT/'static'/'steps.js')],input=json.dumps(rows),capture_output=True,text=True,check=True)
    return json.loads(out.stdout)

def agent_steps(qloo,body,text=''):
    # The local parser handles the condition; no planner endpoint is configured.
    env={k:v for k,v in os.environ.items() if not k.startswith('LLM_')}
    events=[]
    with mock.patch.dict(os.environ,env,clear=True):Agent(qloo).run('test',{**body,'veto_text':text},events.append)
    return [e['step'] for e in events if e['event']=='step']

def row(tool,entities,count,**extra):return {'tool':tool,'entities':entities,'count':count,'latency_ms':0,**extra}

class StepLabelTests(unittest.TestCase):
    def test_server_labels_map_to_plain_names(self):
        rows=[row('Direct plan · no condition',['plan · Plan this scene'],1),
              row('LLM planner',['exclude_categories · Exclude bars'],1),
              row('choose category',['restaurant','dinner'],2),
              row('validate category + exclusions',['Williamsburg NYC','2000 m','take 30'],51),
              row('widen → retry',['2000 → 3500 m','take 30 → 40','Fewer than 5 eligible places'],3),
              row('candidate limit reached',['Return the actual remaining count'],4),
              row('bound candidate union',['Top 29 per person; at most 50 candidates'],49),
              row('rank-sum',['Rescoring incomplete; retrieve more candidates'],49),
              row('/v2/insights · fallback take 50',['Indie + jazz'],50),
              row('consensus · maximin-rank',['A','B','C','D','E'],5),
              row('consensus · rank-sum',['A'],1),
              row('observe → replan · Local planner',['29 places left · 17 excluded · 2 km','Try a different shared pick'],1),
              row('/search',['Moonrise Kingdom'],5)]
        got=[(r['view']['title'],r['view']['lines'][:1],r['view']['count']) for r in render(rows)]
        self.assertEqual(got,[('Plan',[],None),
                              ('LLM planner',['exclude_categories · Exclude bars'],None),
                              ('Choose category',['restaurant'],None),
                              ('Filter places',['Williamsburg NYC · within 2 km · 51 places'],None),
                              ('Search farther',['2 km → 3.5 km · fewer than 5 places'],None),
                              ('Widest search reached',['4 places left'],None),
                              ('Shared list',['Top 29 per friend · 49 places'],None),
                              ('Lowest rank sum',['Some ranks are missing; searching wider'],None),
                              ('/v2/insights · fallback',['Indie + jazz'],50),
                              ('Fair pick',['A'],None),
                              ('Fair pick',['A'],None),
                              ('observe → replan · Local planner',['29 places left · 17 excluded · 2 km'],None),
                              ('/search',['Moonrise Kingdom'],5)])

    def test_long_place_lists_fold_into_all_places(self):
        names=['Indie + jazz']+['Place %d'%i for i in range(49)]
        out=render([row('/v2/insights · rescore',names,49,entity_ids=ID[:49])])[0]['html']
        self.assertIn('Indie + jazz · Place 0 · Place 1 · +47 more',out)
        self.assertIn('<summary>All places</summary>',out)
        self.assertIn('Place 48',out)
        self.assertNotIn('Indie + jazz<br>',out)
        self.assertIn('49 returned',out)

    def test_rendered_steps_show_no_entity_ids(self):
        rows=[row('/v2/insights · rescore',['Indie + jazz']+['Place %d'%i for i in range(10)],10,entity_ids=ID[:10]),
              row('consensus · maximin-rank',['Place %d'%i for i in range(10)],10,entity_ids=ID[:10]),
              row('LLM planner',['exclude_place · '+ID[0],ID[1]],1)]
        for r in render(rows):
            with self.subTest(html=r['html'][:60]):
                self.assertIsNone(UUID.search(r['html']))
                self.assertNotIn('entity_ids',r['html'])

    def test_steps_from_agent_runs_render_without_working_labels(self):
        body={'people':[{'name':'Friend','seeds':[{'query':'Example film','type':'movie'}]}]}
        large={'people':[{'name':n,'seeds':[{'query':n,'type':'movie'}]} for n in 'AB']}
        rows=agent_steps(FakeQloo(),body)+agent_steps(LargePoolQloo(),large)+agent_steps(FakeQloo(),body,'no bars please')
        tools={r['tool'].split(' · ')[0] for r in rows}
        self.assertTrue({'widen → retry','bound candidate union','validate category + exclusions'}<=tools,tools)
        for source,out in zip(rows,render(rows)):
            with self.subTest(tool=source['tool']):
                for word in HIDDEN:self.assertNotIn(word,out['html'])
                self.assertIsNone(UUID.search(out['html']))
                self.assertEqual('returned' in out['html'],source['tool'].startswith('/'))
