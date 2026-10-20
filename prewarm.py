"""Daily cron entry point: build only missing/expired presets, no calls if ready."""
import argparse
import json
import uuid
from server import Agent, Qloo
from scenes import PRESETS, scene_body, read_scene, save_scene

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--refresh',action='store_true',help='Recompute snapshots using the configured response cache');args=parser.parse_args()
    q=Qloo()
    for name in PRESETS:
        token='prewarm-'+uuid.uuid4().hex
        result=None if args.refresh else read_scene(q,name)
        reused=result is not None
        if not reused:
            result=Agent(q).run(token,scene_body(name),lambda _:None)
            if result['status']!='done':raise SystemExit('Preset needs clarification; snapshot was not saved.')
            save_scene(q,name,result)
        print(json.dumps({'scene':name,'pick':result['picks'][0]['name'],'ranks':result['picks'][0]['ranks'],'snapshot_reused':reused,'calls':q.used(token)}))

if __name__=='__main__':main()
