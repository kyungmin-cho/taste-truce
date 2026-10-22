"""Translate requests into bounded tools; ranking remains in logic.py."""
import copy
import json
import os
import re
import sys
import urllib.request

# At 5 km a Williamsburg search reaches Midtown Manhattan; stop at 3.5 km there and keep Brooklyn addresses (agent.in_area).
MAX_RADIUS = {'Seongsu':5000,'Williamsburg NYC':3500}

def max_radius(area):
    return MAX_RADIUS.get(area,5000)

TOOL_PARAMS = {
    'plan': {},
    'exclude_categories': {'categories': {'type':'array','items':{'type':'string','enum':['bar','pub','nightclub']},'minItems':1}},
    'exclude_tags': {'tags': {'type':'array','items':{'type':'string','enum':['Loud','Busy','Lively','Expensive','Moderately expensive']},'minItems':1}},
    'exclude_place': {'target': {'type':'string','enum':['current']}},
    'widen_radius': {'radius': {'type':'integer','enum':[3500,5000]}},
    'change_occasion': {'occasion': {'type':'string','enum':['Dinner','Cafe','Drinks']}},
    'change_area': {'area': {'type':'string','enum':['Seongsu','Williamsburg NYC']}},
    'prefer_budget': {'max_price_level': {'type':'integer','enum':[1,2]}},
    'add_friend': {'name': {'type':'string','maxLength':60}, 'vegetarian': {'type':'boolean'}},
}
DESCRIPTIONS = {
    'plan':'Retrieve and deterministically rank the current scene.',
    'exclude_categories':'Exclude bars, pubs or nightclubs, including politely phrased vetoes.',
    'exclude_tags':'Exclude recorded ambience or cost tags; quieter means Loud, Busy and Lively.',
    'exclude_place':'Veto the current shared pick. Only use for a request to reject that place.',
    'widen_radius':'Search farther away, at 3500 or 5000 metres.',
    'change_occasion':'Change the meeting purpose.', 'change_area':'Change to a supported neighborhood.',
    'prefer_budget':'Require a recorded price level at or below the limit. Cheaper defaults to 2.',
    'add_friend':'Add a friend and ask for their cultural taste. Vegetarian also requires recorded vegetarian offerings; never infer allergies.',
}
TOOLS = [{'type':'function','function':{'name':name,'description':DESCRIPTIONS[name],
    'parameters':{'type':'object','properties':props,'required':list(props),'additionalProperties':False}}} for name,props in TOOL_PARAMS.items()]

def local_tools(text):
    t=text.casefold().strip(); actions=[]
    def add(tool_name, **args):actions.append({'name':tool_name,'arguments':args})
    if not t:return [{'name':'plan','arguments':{}}]
    if re.search(r'\b(no|not|without|avoid|skip|exclude|remove|don.t want|anything but)\b.{0,25}\b(bars?|pubs?|clubs?|nightclubs?)\b|술집.*(빼|싫|말고)|술.*없이',t):
        add('exclude_categories',categories=['bar','pub','nightclub'])
    if re.search(r'quiet|less noisy|not so loud|not too loud|hear each other|actually talk|조용',t):
        add('exclude_tags',tags=['Loud','Busy','Lively'])
    if re.search(r'not (that|this|the same) (place|one|restaurant)|somewhere else|another (place|one)|different (place|restaurant)|그\s*(집|곳).*말고|여기.*말고',t):
        add('exclude_place',target='current')
    if re.search(r'cheap|less expensive|affordable|budget|저렴|싼',t):add('prefer_budget',max_price_level=2)
    if re.search(r'further|farther|widen|larger radius|expand|broaden|넓혀|멀리',t):add('widen_radius',radius=3500)
    if re.search(r'\b(add|bring|join|include|invite)\b.*\b(friend|person|vegetarian)\b|친구.*추가',t):
        add('add_friend',name='Vegetarian friend' if 'vegetarian' in t or '채식' in t else 'New friend',vegetarian='vegetarian' in t or '채식' in t)
    if 'williamsburg' in t or re.search(r'\bnyc\b|new york',t):add('change_area',area='Williamsburg NYC')
    elif 'seongsu' in t or '성수' in t:add('change_area',area='Seongsu')
    for pattern,occasion in [(r'\b(caf[eé]|coffee)\b|카페','Cafe'),(r'\b(dinner|dining|meal)\b|저녁','Dinner'),(r'\bdrinks\b|술모임','Drinks')]:
        if re.search(pattern,t):add('change_occasion',occasion=occasion)
    if not actions:raise ValueError('Please name a condition: no bars, somewhere quieter, not that place, cheaper, search farther, a neighborhood, or add a friend.')
    return actions

def join_words(words):
    return words[0] if len(words)==1 else ', '.join(words[:-1])+' and '+words[-1]

def label_for(action):
    """A short button label; arguments never appear as raw data."""
    name,args=action['name'],action['arguments']
    if name=='exclude_categories':return 'Exclude '+join_words([x+'s' for x in args['categories']])
    if name=='exclude_tags':
        quiet=any(t in ('Loud','Busy','Lively') for t in args['tags']);pricey=any('xpensive' in t for t in args['tags'])
        return 'Quieter and cheaper places' if quiet and pricey else ('Somewhere quieter' if quiet else 'Skip expensive places')
    if name=='exclude_place':return 'Try a different shared pick'
    if name=='widen_radius':return f"Search farther · {args['radius']/1000:g} km"
    if name=='change_occasion':return 'Switch to '+args['occasion'].lower()
    if name=='change_area':return 'Move to '+args['area']
    if name=='prefer_budget':return 'Cheapest places only' if args['max_price_level']==1 else 'Cheaper places'
    if name=='add_friend':return 'Add '+args['name']
    return 'Plan this scene'

def validate(actions):
    if not isinstance(actions,list) or not 1<=len(actions)<=8:raise ValueError('Invalid tools')
    for a in actions:
        name=a.get('name');args=a.get('arguments');props=TOOL_PARAMS.get(name)
        if props is None or not isinstance(args,dict) or set(args)!=set(props):raise ValueError('Invalid tool arguments')
        for key,spec in props.items():
            value=args[key];kind=spec['type']
            if kind=='array':
                if not isinstance(value,list) or not 1<=len(value)<=8 or any(x not in spec['items']['enum'] for x in value):raise ValueError('Invalid list')
            elif kind=='string':
                if not isinstance(value,str) or not value.strip() or len(value)>spec.get('maxLength',120):raise ValueError('Invalid text')
            elif kind=='integer' and type(value) is not int:raise ValueError('Invalid number')
            elif kind=='boolean' and type(value) is not bool:raise ValueError('Invalid boolean')
            if 'enum' in spec and value not in spec['enum']:raise ValueError('Unsupported value')
    return actions

class PlannerError(ValueError):
    def __init__(self,message,planner):
        super().__init__(message);self.planner=planner

def parse_local(text, marker):
    try:return marker,validate(local_tools(text))
    except ValueError as err:raise PlannerError(str(err),marker) from None

def llm_timeout():
    return float(os.getenv('LLM_TIMEOUT_SECONDS') or '8')

def post_chat(payload):
    # An explicit agent: Cloudflare-fronted providers such as Groq answer the default Python-urllib agent with 403 (error 1010).
    req=urllib.request.Request(os.environ['LLM_BASE_URL'].rstrip('/')+'/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+os.environ['LLM_API_KEY'],'User-Agent':'TasteTruce/1.0'})
    with urllib.request.urlopen(req,timeout=llm_timeout()) as response:return json.load(response)

def llm_failed(step, err):
    # Status code or error type only; requests, responses and keys stay out of the log.
    print(f'{step}: LLM unavailable ({getattr(err,"code",None) or type(err).__name__})',file=sys.stderr,flush=True)

def choose_tools(text, scene):
    if not text.strip():return 'Direct plan · no condition', [{'name':'plan','arguments':{}}]
    configured=all(os.getenv(k) for k in ['LLM_BASE_URL','LLM_MODEL','LLM_API_KEY'])
    if configured:
        try:
            payload={'model':os.environ['LLM_MODEL'],'messages':[
                {'role':'system','content':'Choose only the tools needed for the user request. Use plan for an initial scene. Do not rank places, invent tastes, or add unrelated tools. Multiple conditions may require multiple tools. Only supported neighborhoods and occasions are allowed. A request to add a vegetarian friend requires add_friend with vegetarian true, even before their taste is known.'},
                {'role':'user','content':json.dumps({'request':text or 'Plan this scene','scene':scene})}],
                'tools':TOOLS,'tool_choice':'required','max_tokens':600}
            data=post_chat(payload)
            calls=data['choices'][0]['message']['tool_calls']
            actions=validate([{'name':c['function']['name'],'arguments':json.loads(c['function']['arguments'])} for c in calls])
            if text and all(a['name']=='plan' for a in actions):raise ValueError('Request needs a condition tool')
            return 'LLM planner',actions
        except Exception as err:
            llm_failed('planner',err)
            return parse_local(text,'Local planner')
    return parse_local(text,'Local planner')

def apply_tools(scene, veto, actions, current_pick):
    scene=copy.deepcopy(scene);veto=copy.deepcopy(veto);needs_taste=False
    for a in actions:
        name,args=a['name'],a['arguments']
        if name=='exclude_categories':veto['categories']=sorted(set(veto.get('categories',[])+args['categories']))
        elif name=='exclude_tags':veto['tags']=sorted(set(veto.get('tags',[])+args['tags']))
        elif name=='exclude_place':
            if not current_pick:raise ValueError('Choose a plan before vetoing its shared pick.')
            veto['excluded']=sorted(set(veto.get('excluded',[])+[current_pick]))
        elif name=='widen_radius':scene['start_radius']=args['radius']
        elif name=='change_area':scene['area']=args['area']
        elif name=='change_occasion':scene['occasion']=args['occasion']
        elif name=='prefer_budget':veto['max_price_level']=args['max_price_level']
        elif name=='add_friend':
            if len(scene['people'])>=5:raise ValueError('Up to five friends can share a plan.')
            scene['people'].append({'name':args['name'],'seeds':[{'query':'','type':'artist'}]})
            if args['vegetarian']:veto['vegetarian']=True
            needs_taste=True
    return scene,veto,needs_taste


def observe_replan(text, scene, actions, observation):
    """One observation turn proposes tools; the user chooses before new execution."""
    limit=max_radius(scene.get('area'))
    if observation['remaining_count']<10 and observation['radius']<limit:
        local=[{'name':'widen_radius','arguments':{'radius':limit}}]
    elif observation['nothing_matched']:
        local=[{'name':'exclude_tags','arguments':{'tags':['Loud','Busy','Lively']}}]
    else:
        local=[{'name':'exclude_place','arguments':{'target':'current'}}]
    local=[{'label':label_for(a),**a} for a in local]
    if all(os.getenv(k) for k in ['LLM_BASE_URL','LLM_MODEL','LLM_API_KEY']):
        try:
            calls=[{'id':'executed_'+str(i),'type':'function','function':{'name':a['name'],'arguments':json.dumps(a['arguments'])}} for i,a in enumerate(actions)]
            messages=[{'role':'system','content':'Observe the executed tool results and propose ONE sensible alternative tool. Nothing matched means propose a different condition; fewer than ten candidates means suggest widening if possible. Do not change scores or execute anything. The user will choose.'},
                      {'role':'user','content':json.dumps({'request':text,'scene':scene})},
                      {'role':'assistant','content':None,'tool_calls':calls}]
            messages += [{'role':'tool','tool_call_id':c['id'],'content':json.dumps(observation)} for c in calls]
            payload={'model':os.environ['LLM_MODEL'],'messages':messages,'tools':[t for t in TOOLS if t['function']['name'] in ('exclude_tags','widen_radius','exclude_place','prefer_budget','change_occasion')],'tool_choice':'required','max_tokens':400}
            data=post_chat(payload)
            c=data['choices'][0]['message']['tool_calls'][0]['function']
            a=validate([{'name':c['name'],'arguments':json.loads(c['arguments'])}])[0]
            if a['name']=='widen_radius':a['arguments']['radius']=min(a['arguments']['radius'],limit)
            if a['name']=='widen_radius' and a['arguments']['radius']<=observation['radius']:
                return 'Local planner',local
            if a['name'] not in ('exclude_tags','widen_radius','exclude_place','prefer_budget','change_occasion'):raise ValueError('Unsupported follow-up')
            return 'LLM planner',[{'label':label_for(a),**a}]
        except Exception as err:
            llm_failed('observe',err)
            return 'Local planner',local
    return 'Local planner',local
