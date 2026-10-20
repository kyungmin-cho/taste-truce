"""Warm both default dinner scenes in the configured (normally default) cache."""
import copy
import json
import uuid
from server import Agent, DEFAULT_PEOPLE, Qloo

def main():
    q=Qloo()
    for area in ['Seongsu','Williamsburg NYC']:
        token='prewarm-'+uuid.uuid4().hex
        result=Agent(q).run(token,{'people':copy.deepcopy(DEFAULT_PEOPLE),'area':area},lambda _:None)
        if result['status']!='done':raise SystemExit('Default scene needs clarification; cache was not warmed.')
        q.save('/scene/default' if area=='Seongsu' else '/scene/williamsburg',{},result)
        print(json.dumps({'area':area,'pick':result['picks'][0]['name'],'method':result['method'],'calls':q.used(token),'elapsed_ms':result['elapsed_ms']}))

if __name__=='__main__':main()
