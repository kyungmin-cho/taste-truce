"""A bounded tool loop: resolve, clarify, retrieve, widen, rescore, decide."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import time
import urllib.request
from logic import OCCASIONS, ambiguity, complete_scores, concession, consensus, eligible, ranked, taste_contrast
from qloo import QlooError, BudgetError

AREAS = {'Seongsu': (127.0557,37.5445), 'Williamsburg NYC': (-73.9571,40.7081)}
DEFAULT_PEOPLE = [
    {'name':'Indie + jazz','seeds':[{'query':'Moonrise Kingdom','type':'movie'}, {'query':'Miles Davis','type':'artist'}]},
    {'name':'K-pop + streetwear','seeds':[{'query':'BTS','type':'artist'}, {'query':'Supreme','type':'brand'}]},
    {'name':'Coffee + design','seeds':[{'query':'Blue Bottle Coffee','type':'brand'}, {'query':'Muji','type':'brand'}]},
]

def compact(e):
    prop=e.get('properties') or {}
    return {'id':e['entity_id'], 'name':e['name'], 'types':e.get('types', [e.get('subtype')]),
            'location': e.get('location'), 'address': prop.get('address',''),
            'genre': (prop.get('primary_genre') or {}).get('name',''),
            'tags':[{'id':t.get('id') or t['tag_id'],'name':t.get('name') or t.get('id') or t['tag_id']} for t in e.get('tags') or [] if t.get('id') or t.get('tag_id')],
            'affinity':(e.get('query') or {}).get('affinity'), 'popularity':e.get('popularity'), 'closed':prop.get('is_closed',False)}

class Agent:
    def __init__(self, qloo):
        self.qloo=qloo

    def run(self, session, body, emit):
        started=time.perf_counter()
        people=body.get('people', DEFAULT_PEOPLE)
        area=body.get('area','Seongsu')
        occasion=body.get('occasion','Dinner')
        start_radius=body.get('start_radius',2000)
        if start_radius not in (100,2000):raise ValueError('Choose a supported starting radius.')
        if area not in AREAS or occasion not in OCCASIONS or not isinstance(people,list) or not 1<=len(people)<=5:
            raise ValueError('Choose a supported scene and one to five friends.')
        for p in people:
            if not isinstance(p,dict) or not isinstance(p.get('name'),str) or not 1<=len(p['name'].strip())<=60 or not 1<=len(p.get('seeds',[]))<=3:
                raise ValueError('Each friend needs a name and one to three taste seeds.')
            for s in p['seeds']:
                if not isinstance(s.get('query'),str) or not 1<=len(s['query'].strip())<=120 or s.get('type') not in ['movie','artist','brand','place','book','tv_show']:
                    raise ValueError('Use a supported seed type and a name under 120 characters.')
        steps=[]
        def step(tool, entities, count, latency=0, **extra):
            row={'tool':tool,'entities':entities,'count':count,'latency_ms':round(latency,1),**extra}
            steps.append(row);emit({'event':'step','step':row})
        def request(tool,path,params,names):
            t=time.perf_counter()
            data,hit=self.qloo.request(session,path,params)
            es=data.get('results',[])
            if isinstance(es,dict):es=es.get('entities',[])
            step(tool,names,len(es),(time.perf_counter()-t)*1000,cache=hit)
            return [compact(e) for e in es]
        veto=body.get('veto') or {}
        text=str(body.get('veto_text','')).strip()[:160]
        veto={'no_bars':bool(veto.get('no_bars')), 'excluded':[str(x) for x in veto.get('excluded',[])][:100]}
        if text:
            if text.lower() in ('no bars','no bar','no pubs'):
                veto['no_bars']=True
            elif text.lower()=='not that place':
                if not body.get('current_pick'):
                    raise ValueError('Choose a plan before vetoing its shared pick.')
                veto['excluded']=list(set(veto['excluded']+[body['current_pick']]))
            else:
                raise ValueError('Try “no bars” or “not that place”, or use a place’s Veto button.')
        if text or veto['excluded'] or veto['no_bars']:
            step('veto → replan',[text or 'Saved exclusions']+veto['excluded'],len(veto['excluded']),no_bars=veto['no_bars'])
        choices=body.get('choices',{})
        def resolve(job):
            pi,si,seed=job
            params={'query':seed['query'],'types':'urn:entity:'+seed['type'],'take':5}
            if seed['type']=='place':
                lon,lat=AREAS[area]
                params.update({'filter.location':f'{lat},{lon}','filter.radius':15})
            results=request('/search','/search',params,[seed['query']])
            key=f'{pi}:{si}'
            choice=choices.get(key)
            selected=next((r for r in results if r['id']==choice),None)
            if choice and not selected:raise ValueError('The selected entity is not in the search results.')
            ambiguous=(len(results)>1 if seed['type']=='place' else ambiguity(results,seed['query']))
            if not selected and results and not ambiguous:
                selected=next(r for r in results if r['name'].casefold()==seed['query'].casefold())
            return pi,si,seed,key,selected,results
        jobs=[(pi,si,s) for pi,p in enumerate(people) for si,s in enumerate(p['seeds'])]
        with ThreadPoolExecutor(max_workers=6) as executor:
            resolved=list(executor.map(resolve,jobs))
        clarification=[];ids=[[] for _ in people]
        for pi,si,seed,key,selected,results in resolved:
            if selected:ids[pi].append(selected['id'])
            else:clarification.append({'key':key,'person':people[pi]['name'],'query':seed['query'],'options':results})
        if clarification:
            step('ask user',[c['query'] for c in clarification],len(clarification))
            return {'status':'clarification','questions':clarification,'steps':steps,'veto':veto,'elapsed_ms':round((time.perf_counter()-started)*1000)}
        tags=OCCASIONS[occasion]
        step('choose category',tags,len(tags),occasion=occasion,operator='intersection')
        lon,lat=AREAS[area]
        pool={};lists=[];baseline=[]
        attempts=([(100,10)] if start_radius==100 else [])+[(2000,30),(3500,40),(5000,50)]
        for attempt,(radius,take) in enumerate(attempts):
            params={'filter.type':'urn:entity:place','filter.location':f'POINT({lon} {lat})','filter.location.radius':radius,'take':take,'filter.tags':','.join(tags),'operator.filter.tags':'intersection'}
            def retrieve(i):
                p={**params,'signal.interests.entities':','.join(ids[i])}
                return [e for e in request('/v2/insights · person','/v2/insights',p,[people[i]['name']]+[s['query'] for s in people[i]['seeds']]) if eligible(e,occasion,veto)]
            with ThreadPoolExecutor(max_workers=4) as executor:
                fs=[executor.submit(retrieve,i) for i in range(len(people))]
                base_future=executor.submit(request,'/v2/insights · popularity','/v2/insights',params,[area,occasion,'No taste signal'])
                lists=[f.result() for f in fs]
                baseline=[e for e in base_future.result() if eligible(e,occasion,veto)]
            pool={e['id']:e for es in lists for e in es}
            step('validate category + exclusions',[area,f'{radius} m',f'take {take}'],len(pool))
            if len(pool)>=5:break
            if radius<5000:
                next_radius,next_take=attempts[attempt+1]
                step('widen → retry',[f'{radius} → {next_radius} m',f'take {take} → {next_take}','Fewer than 5 eligible places'],len(pool))
            else:
                step('candidate limit reached',['Return the actual remaining count'],len(pool))
        if not pool:
            raise QlooError('No eligible places remain. Change the scene or reset exclusions.')
        pool_rows=list(pool.values())
        def rescore(i):
            chunk=sorted(e['id'] for e in pool_rows)
            query={'filter.type':'urn:entity:place','filter.results.entities':','.join(chunk),'signal.interests.entities':','.join(ids[i]),'take':len(chunk)}
            rows=request('/v2/insights · rescore','/v2/insights',query,[people[i]['name']]+chunk)
            return ranked(rows) if complete_scores(pool_rows,rows) else None

        method='maximin-rank'
        try:
            if len(pool_rows)>50:
                raise QlooError('Union exceeds the API take ceiling of 50')
            with ThreadPoolExecutor(max_workers=3) as executor:
                rescored=list(executor.map(rescore,range(len(people))))
            if any(r is None for r in rescored):raise QlooError('Incomplete affinity coverage')
            lists=rescored
        except BudgetError:
            raise
        except QlooError:
            method='rank-sum'
            step('fallback · rank-sum',['Rescoring unavailable or incomplete; expand retrieval'],len(pool))
            larger={**params,'take':50}
            def widen(i):
                return [e for e in request('/v2/insights · fallback take 50','/v2/insights',{**larger,'signal.interests.entities':','.join(ids[i])},[people[i]['name']]) if eligible(e,occasion,veto)]
            with ThreadPoolExecutor(max_workers=3) as executor:lists=list(executor.map(widen,range(len(people))))
            pool={e['id']:e for es in lists for e in es};pool_rows=list(pool.values())
        t=time.perf_counter()
        all_picks=consensus(pool_rows,lists,method,limit=len(pool_rows))
        picks=all_picks[:10]
        if not picks:raise QlooError('There are no comparable candidates. Change the scene.')
        if any(not rows for rows in lists):raise QlooError('One signal has no candidates after exclusions. Change the scene.')
        explanations=[concession(p,lists[i],picks[0],i) for i,p in enumerate(people)]
        step('consensus · '+method,[e['name'] for e in picks],len(picks),(time.perf_counter()-t)*1000)
        baseline,contrast=taste_contrast(picks,all_picks,baseline)
        overlap=contrast['overlap']
        result={'status':'done','area':area,'occasion':occasion,'people':people,'picks':picks,'personal':[es[:10] for es in lists],
                'baseline':baseline,'overlap':overlap,'overlap_denominator':min(10,len(picks)), 'pool_size':len(pool), 'method':method,
                'concessions':explanations,'veto':veto,'radius':radius,'take':take,'contrast':contrast, 'session_calls':self.qloo.used(session)}
        # Optional narration never replaces the deterministic, evidence-grounded concessions.
        if os.getenv('LLM_API_KEY') and os.getenv('LLM_BASE_URL') and os.getenv('LLM_MODEL'):
            t=time.perf_counter()
            try:
                evidence={'pick':picks[0]['name'],'concessions':explanations}
                payload={'model':os.environ['LLM_MODEL'],'messages':[{'role':'system','content':'Summarize only the supplied evidence in two English sentences. Use group affinity language, never promise personal enjoyment. Do not invent facts.'},{'role':'user','content':json.dumps(evidence)}],'max_tokens':160}
                req=urllib.request.Request(os.environ['LLM_BASE_URL'].rstrip('/')+'/chat/completions',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['LLM_API_KEY'],'Content-Type':'application/json'})
                with urllib.request.urlopen(req,timeout=5) as response:result['narration']=json.load(response)['choices'][0]['message']['content']
                if any(phrase in result['narration'].lower() for phrase in ('you will love', "you'll love", 'you will enjoy', "you'll enjoy")):
                    result.pop('narration',None)
                    raise ValueError('Use group affinity phrasing')
                step('optional narration',[picks[0]['name']],1,(time.perf_counter()-t)*1000)
            except Exception:
                step('narration fallback',['Use grounded templates'],len(explanations),(time.perf_counter()-t)*1000)
        result['steps']=steps
        result['elapsed_ms']=round((time.perf_counter()-started)*1000)
        return result
