"""Preset inputs and private, durable computed scene snapshots."""
import copy
import json
import os
import time
from agent import DEFAULT_PEOPLE
from logic import merge_rows

PRESETS={
    'seongsu':{'label':'Seongsu','area':'Seongsu','people':DEFAULT_PEOPLE},
    'williamsburg':{'label':'Williamsburg','area':'Williamsburg NYC','people':DEFAULT_PEOPLE},
    'majority':{'label':'Williamsburg · majority / minority','area':'Williamsburg NYC','people':DEFAULT_PEOPLE[:2]+[
        {'name':'Pop + athleisure','seeds':[{'query':'Taylor Swift','type':'artist'},{'query':'Lululemon','type':'brand'}]}]},
}
VERSION=2

def default_scene():
    name=os.getenv('DEFAULT_SCENE') or 'williamsburg'
    if name not in PRESETS:raise ValueError('DEFAULT_SCENE must be seongsu, williamsburg or majority')
    return name

def scene_body(name):
    p=PRESETS[name]
    return copy.deepcopy({'people':p['people'],'area':p['area'],'occasion':'Dinner','start_radius':2000})

def scene_key(name):return '/scene/'+name

def save_scene(q,name,result):
    q.save(scene_key(name),{}, {'version':VERSION,'result':result})

def read_scene(q,name):
    if name not in PRESETS:return None
    try:
        item=json.loads((q.cache/(q.signature(scene_key(name),{})+'.json')).read_text())
        ttl=int(os.getenv('DEFAULT_SCENE_TTL_SECONDS') or '0')
        if ttl and ttl<2592000:raise ValueError('Default scene TTL must be zero or at least 30 days')
        data=item['data']
        if data['version']!=VERSION or (ttl and time.time()-item['saved']>=ttl):return None
        result=copy.deepcopy(data['result'])
        # Snapshots saved before rows were merged still show one row per place.
        if result.get('concession_table'):result['concession_table']=merge_rows(result['concession_table'])
        result['saved_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(item['saved']))
        return result
    except (OSError,KeyError,ValueError,TypeError):return None

def health(q):
    name=default_scene();saved=read_scene(q,name)
    # Not ready means the first screen would be empty until prewarm.py succeeds.
    ready=saved is not None
    return {'status':'ok' if ready else 'not_ready','ready':ready,'default_scene':name,'default_scene_ready':ready,
            'needs_new_calls':not ready,'saved_utc':saved.get('saved_utc') if saved else None}
