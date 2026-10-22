"""A bounded tool loop: resolve, clarify, retrieve, widen, rescore, decide."""
from concurrent.futures import ThreadPoolExecutor
import time
from logic import OCCASIONS, ambiguity, complete_scores, concession, consensus, eligible, ranked, taste_contrast, concession_table
from qloo import QlooError, BudgetError
from planner import choose_tools, apply_tools, PlannerError, observe_replan, validate

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
            'price_level':prop.get('price_level'), 'explainability':((e.get('query') or {}).get('explainability') or {}).get('signal.interests.entities',[]),
            'affinity':(e.get('query') or {}).get('affinity'), 'popularity':e.get('popularity'), 'closed':prop.get('is_closed',False)}

class Agent:
    def __init__(self, qloo):
        self.qloo=qloo

    def run(self, session, body, emit):
        started=time.perf_counter()
        people=body.get('people', DEFAULT_PEOPLE)
        area=body.get('area','Williamsburg NYC')
        occasion=body.get('occasion','Dinner')
        start_radius=body.get('start_radius',2000)
        if start_radius not in (100,2000,3500,5000):raise ValueError('Choose a supported starting radius.')
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
            step(tool,names,len(es),(time.perf_counter()-t)*1000,cache=hit,**({'entity_ids':params['filter.results.entities'].split(',')} if 'filter.results.entities' in params else {}))
            return [compact(e) for e in es]
        veto=body.get('veto') or {}
        text=str(body.get('veto_text','')).strip()[:500]
        if not isinstance(veto,dict):raise ValueError('Invalid exclusions.')
        veto={k:v for k,v in veto.items() if k in ('no_bars','excluded','categories','tags','vegetarian','max_price_level')}
        veto.setdefault('excluded',[])
        if not isinstance(veto['excluded'],list) or len(veto['excluded'])>100:raise ValueError('Too many exclusions.')
        if any(not isinstance(x,str) or len(x)>120 for x in veto['excluded']):raise ValueError('Invalid place exclusion.')
        for key,allowed in [('categories',{'bar','pub','nightclub'}),('tags',{'Loud','Busy','Lively','Expensive','Moderately expensive'})]:
            if key in veto and (not isinstance(veto[key],list) or any(x not in allowed for x in veto[key])):raise ValueError('Invalid condition.')
        if 'max_price_level' in veto and veto['max_price_level'] not in (1,2):raise ValueError('Invalid price limit.')
        scene={'people':people,'area':area,'occasion':occasion,'start_radius':start_radius}
        t=time.perf_counter()
        try:
            if body.get('suggested_action'):
                planner,actions='User-selected next step',validate([body['suggested_action']])
            else:planner,actions=choose_tools(text,scene)
        except PlannerError as err:
            step(err.planner,['No supported tool matched; ask for a condition'],0,(time.perf_counter()-t)*1000)
            raise
        step(planner,[a['name']+' '+str(a['arguments']) for a in actions],len(actions),(time.perf_counter()-t)*1000)
        scene,veto,needs_taste=apply_tools(scene,veto,actions,body.get('current_pick'))
        people,area,occasion,start_radius=(scene[k] for k in ('people','area','occasion','start_radius'))
        if needs_taste:
            return {'status':'friend_taste','people':people,'area':area,'occasion':occasion,'start_radius':start_radius,'veto':veto,'planner':planner,'steps':steps}
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
            if choice=='skip':return pi,si,seed,key,'skip',results
            selected=next((r for r in results if r['id']==choice),None)
            if choice and not selected:raise ValueError('The selected entity is not in the search results.')
            ambiguous=ambiguity(results,seed['query']) or (seed['type']=='place' and len(results)>1)
            if not selected and results and not ambiguous:
                selected=next((r for r in results if r['name'].casefold().strip()==seed['query'].casefold().strip()),None)
            return pi,si,seed,key,selected,results
        jobs=[(pi,si,s) for pi,p in enumerate(people) for si,s in enumerate(p['seeds'])]
        with ThreadPoolExecutor(max_workers=6) as executor:
            resolved=list(executor.map(resolve,jobs))
        clarification=[];ids=[[] for _ in people]
        seed_names={};resolved_choices={}
        active_seeds=[[] for _ in people]
        for pi,si,seed,key,selected,results in resolved:
            if selected=='skip':continue
            active_seeds[pi].append(seed)
            if selected:
                seed_names[selected['id']]=selected['name']
                resolved_choices[f'{pi}:{len(active_seeds[pi])-1}']=selected['id']
            if selected:ids[pi].append(selected['id'])
            else:clarification.append({'key':key,'person':people[pi]['name'],'query':seed['query'],'options':results})
        if clarification:
            step('ask user',[c['query'] for c in clarification],len(clarification))
            return {'status':'clarification','people':people,'area':area,'occasion':occasion,'start_radius':start_radius,'questions':clarification,'planner':planner,'steps':steps,'veto':veto,'elapsed_ms':round((time.perf_counter()-started)*1000)}
        if any(not x for x in ids):raise ValueError('Each friend needs at least one resolved taste. Add another taste or remove that friend after skipping.')
        people=[{**p,'seeds':active_seeds[i]} for i,p in enumerate(people)]
        tags=OCCASIONS[occasion]
        step('choose category',[t.rsplit(':',1)[-1].replace('_',' ') for t in tags],len(tags),occasion=occasion,operator='intersection')
        lon,lat=AREAS[area]
        pool={};lists=[];baseline=[];excluded_ids=set()
        attempts=[(r,t) for r,t in [(100,10),(2000,30),(3500,40),(5000,50)] if r>=start_radius]
        for attempt,(radius,take) in enumerate(attempts):
            params={'filter.type':'urn:entity:place','filter.location':f'POINT({lon} {lat})','filter.location.radius':radius,'take':take,'filter.tags':','.join(tags),'operator.filter.tags':'intersection'}
            def retrieve(i):
                p={**params,'signal.interests.entities':','.join(ids[i])}
                rows=request('/v2/insights · person','/v2/insights',p,[people[i]['name']]+[s['query'] for s in people[i]['seeds']])
                excluded_ids.update(e['id'] for e in rows if eligible(e,occasion,{}) and not eligible(e,occasion,veto))
                return [e for e in rows if eligible(e,occasion,veto)]
            with ThreadPoolExecutor(max_workers=4) as executor:
                fs=[executor.submit(retrieve,i) for i in range(len(people))]
                base_future=executor.submit(request,'/v2/insights · popularity','/v2/insights',params,[area,occasion,'No taste signal'])
                lists=[f.result() for f in fs]
                base_rows=base_future.result()
                excluded_ids.update(e['id'] for e in base_rows if eligible(e,occasion,{}) and not eligible(e,occasion,veto))
                baseline=[e for e in base_rows if eligible(e,occasion,veto)]
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
        if len(pool)>50:
            k=50//len(people)
            while len({e['id'] for rows in lists for e in rows[:k+1]})<=50 and k<max(map(len,lists)):k+=1
            pool={e['id']:e for rows in lists for e in rows[:k]}
            step('bound candidate union',[f'Top {k} per person; at most 50 candidates'],len(pool))
        pool_rows=list(pool.values())
        def rescore(i):
            chunk=sorted(e['id'] for e in pool_rows)
            query={'filter.type':'urn:entity:place','filter.results.entities':','.join(chunk),'signal.interests.entities':','.join(ids[i]),'take':len(chunk),'feature.explainability':'true'}
            rows=request('/v2/insights · rescore','/v2/insights',query,[people[i]['name']]+[e['name'] for e in pool_rows])
            for e in rows:
                e['contributions']=[{'seed':seed_names.get(c.get('entity_id'),'Unknown seed'),'score':c['score']} for c in e['explainability'] if isinstance(c.get('score'),(int,float))]
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
            step('rank-sum',['Rescoring incomplete; retrieve more candidates'],len(pool))
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
        result={'status':'done','choices':resolved_choices,'area':area,'occasion':occasion,'people':people,'picks':picks,'personal':[es[:10] for es in lists],
                'baseline':baseline,'overlap':overlap,'overlap_denominator':min(10,len(picks)), 'pool_size':len(pool), 'method':method,
                'concessions':explanations,'veto':veto,'planner':planner,'start_radius':start_radius, 'excluded_count':len(excluded_ids),
                'notice':('Nothing matched, nothing changed.' if (text or any(veto.values())) and not excluded_ids and all(a['name'] in ('plan','exclude_categories','exclude_tags','exclude_place') for a in actions) else ''),'radius':radius,'take':take,'contrast':contrast, 'session_calls':self.qloo.used(session)}
        result['concession_table']=concession_table(people,lists,baseline,picks[0])
        if text:
            observation={'excluded_count':len(excluded_ids),'remaining_count':len(pool),'radius':radius,'nothing_matched':result['notice']=='Nothing matched, nothing changed.'}
            t=time.perf_counter()
            source,suggestions=observe_replan(text,scene,actions,observation)
            result['suggestions']=suggestions
            step('observe → replan · '+source,[str(observation)]+[s['label'] for s in suggestions],len(suggestions),(time.perf_counter()-t)*1000)
        result['steps']=steps
        result['elapsed_ms']=round((time.perf_counter()-started)*1000)
        return result
