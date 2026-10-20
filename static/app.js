const colors=['#9c66b9','#dd8257','#4a99a3','#728d4c','#ab7c96'];
const el=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let people=[],result=null,choices={},veto={excluded:[],no_bars:false},map=null,pins=[],busy=false,steps=[],swapFrom=null;
function renderPeople(){
  el('people').innerHTML=people.map((p,i)=>`<article class="person" style="--color:${colors[i]}"><div class="person-head"><span class="avatar">${i+1}</span><label class="sr-only" for="name-${i}">Friend ${i+1} name</label><input id="name-${i}" class="friend-name" data-name="${i}" value="${esc(p.name)}" maxlength="60"><button class="quiet" data-remove="${i}" aria-label="Remove ${esc(p.name)}" ${people.length===1?'disabled':''}>×</button></div>${p.seeds.map((s,j)=>`<div class="seed"><label class="sr-only" for="type-${i}-${j}">Seed type for friend ${i+1}, taste ${j+1}</label><select id="type-${i}-${j}" data-person="${i}" data-seed="${j}" data-field="type">${['movie','artist','brand','place','book','tv_show'].map(t=>`<option ${t===s.type?'selected':''} value="${t}">${t.replace('_',' ')}</option>`).join('')}</select><label class="sr-only" for="seed-${i}-${j}">Taste ${j+1} for ${esc(p.name)}</label><input id="seed-${i}-${j}" value="${esc(s.query)}" data-person="${i}" data-seed="${j}" data-field="query" maxlength="120"><button class="quiet" data-removeseed="${i}:${j}" ${p.seeds.length===1?'disabled':''}>Remove taste</button></div>`).join('')}<button class="quiet" data-addseed="${i}" ${p.seeds.length===3?'disabled':''}>+ Add taste</button></article>`).join('');
}
el('people').addEventListener('input',event=>{
  const node=event.target;if(node.dataset.name!==undefined){people[+node.dataset.name].name=node.value;return;}if(node.dataset.field){people[+node.dataset.person].seeds[+node.dataset.seed][node.dataset.field]=node.value;choices={};}
});
function addStep(row){
  steps.push(row);el('step-count').textContent=String(steps.length).padStart(2,'0');
  if(steps.length===1)el('steps').innerHTML='';
  const li=document.createElement('li');
  const names=row.entities||[];
  li.innerHTML=`<strong>${esc(row.tool)}</strong><small>${esc(names.slice(0,3).join(' · '))}${names.length>3?` · +${names.length-3} entities`:''}</small><div class="step-meta"><span>${row.count} returned</span><span>${(row.latency_ms/1000).toFixed(2)}s</span>${'cache' in row?`<span>${typeof row.cache==='string'?'STALE · BUDGET':(row.cache?'CACHE':'LIVE')}</span>`:''}</div>${names.length>3?`<details><summary>All input names${row.entity_ids?' and IDs':''}</summary><small>${names.map(esc).join('<br>')}${row.entity_ids?'<hr>'+row.entity_ids.map(esc).join('<br>'):''}</small></details>`:''}`;
  el('steps').append(li);el('steps').scrollTop=el('steps').scrollHeight;
}
function setBusy(value){
  busy=value;el('plan').disabled=value;
  document.querySelectorAll('#veto-form button,#shortlist button,#questions button,#people input,#people select,#people button,#add-friend,#area,#occasion,#radius,#share,#swap-taste').forEach(b=>b.disabled=value);
}
async function plan(vetoText=''){
  if(busy)return;
  setBusy(true);steps=[];el('step-count').textContent='00';el('steps').innerHTML='';el('questions').hidden=true;
  el('veto-message').textContent='';el('status').textContent=`Reading ${people.length} taste signals…`;performance.mark('plan-start');
  const body={people,choices,start_radius:Number(el('radius').value),area:el('area').value,occasion:el('occasion').value,veto,veto_text:vetoText,current_pick:result?.picks?.[0]?.id};
  try{
    const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw new Error((await response.json()).error||'Could not start a plan.');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',finished=false;
    while(true){
      const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
      const lines=buffer.split('\n');buffer=lines.pop();
      for(const line of lines){
        if(!line.trim())continue;const event=JSON.parse(line);
        if(event.event==='step')addStep(event.step);
        if(event.event==='error')throw new Error(event.message);
        if(event.event==='result'){
          finished=true;veto=event.result.veto;
          if(event.result.people){people=event.result.people;renderPeople();el('friend-count').textContent=`${people.length} friends`;}
          if(event.result.area)el('area').value=event.result.area;
          if(event.result.occasion)el('occasion').value=event.result.occasion;
          if(event.result.start_radius)el('radius').value=event.result.start_radius;
          if(event.result.status==='friend_taste'){el('status').textContent='Friend added. Enter their film, artist or brand above, then find common ground. Vegetarian options must be recorded; confirm dietary needs with the venue.';el(`seed-${people.length-1}-0`).focus();}
          else if(event.result.status==='clarification'){showQuestions(event.result.questions);el('status').textContent='A name needs a little more context.';}
          else{result=event.result;choices=result.choices||{};el('taste-off').checked=false;renderResult();performance.mark('result-rendered');requestAnimationFrame(()=>requestAnimationFrame(()=>performance.mark('meaningful-render')));el('status').textContent=result.notice||`${result.pool_size} eligible places · ${result.planner}`;el('veto-message').textContent=result.notice||(vetoText?`${result.excluded_count} eligible ${result.excluded_count===1?'place':'places'} excluded by recorded conditions.`:'');}
        }
      }
      if(done)break;
    }
    if(!finished)throw new Error('The connection ended before a plan was ready. Please retry.');
  }catch(err){el('status').textContent=err.message;el('veto-message').textContent=err.message;if(result){veto=structuredClone(result.veto);el('results').hidden=false;}}
  finally{setBusy(false);el('add-friend').disabled=people.length>=5;document.querySelectorAll('[data-remove]').forEach(b=>b.disabled=people.length===1);document.querySelectorAll('[data-addseed]').forEach(b=>b.disabled=people[+b.dataset.addseed].seeds.length===3);document.querySelectorAll('[data-removeseed]').forEach(b=>b.disabled=people[+b.dataset.removeseed.split(':')[0]].seeds.length===1);}
}
function showQuestions(questions){
  const question=questions[0];el('questions').hidden=false;
  el('questions').innerHTML=`<h3>Which “${esc(question.query)}”?</h3><p>${esc(question.person)}’s taste could refer to different places or entities. Pick the one you mean.</p>${question.options.map((e,i)=>`<button data-choice="${i}"><strong>${esc(e.name)}</strong><br><small>${esc(e.genre||e.types?.join(', '))} · ${esc(e.address)}</small></button>`).join('')}<button data-skip>None of these / skip this taste</button>${question.options.length?'':'<p>No matches. Edit the seed above and try again.</p>'}`;
  el('questions').querySelectorAll('button').forEach(button=>button.onclick=()=>{if(button.hasAttribute('data-skip')){const [pi,si]=question.key.split(':').map(Number);if(people[pi].seeds.length===1){if(people.length>1){people.splice(pi,1);choices={};renderPeople();plan();return;}el('status').textContent='This is the last taste. Replace it above to continue.';el(`seed-${pi}-${si}`).focus();return;}choices[question.key]='skip';}else choices[question.key]=question.options[+button.dataset.choice].id;plan();});
}
function drawMap(off){
  if(!window.L){el('map-fallback').hidden=false;el('map-fallback').textContent='The map could not load. Place names and ranks remain available below.';return;}
  if(!map){map=L.map('map',{scrollWheelZoom:false}).setView([37.5445,127.0557],14);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19}).addTo(map);}
  map.invalidateSize();pins.forEach(p=>map.removeLayer(p));pins=[];
  const points=[];
  function pin(e,color,label,shared=false){
    if(!e.location||!Number.isFinite(e.location.lat)||!Number.isFinite(e.location.lon))return;
    const point=[e.location.lat,e.location.lon];points.push(point);
    const icon=L.divIcon({className:'',html:`<div class="pin ${shared?'consensus-pin':''}" style="background:${color};width:30px;height:30px">${label}</div>`,iconSize:[shared?36:30,shared?36:30],iconAnchor:[15,15]});
    const marker=L.marker(point,{icon,zIndexOffset:shared?1000:0}).addTo(map).bindPopup(`<strong>${esc(e.name)}</strong><br>${esc(e.genre)}<br>${esc(e.address)}`);pins.push(marker);
  }
  if(off)result.baseline.forEach((e,i)=>pin(e,result.picks.some(p=>p.id===e.id)?'#b5bbb2':'#c77545',i+1));
  else{result.personal.forEach((rows,i)=>rows.slice(0,3).forEach((e,j)=>pin(e,colors[i],j+1)));result.picks.slice(1).forEach((e,i)=>pin(e,result.baseline.some(p=>p.id===e.id)?'#b5bbb2':'#548739',i+2));pin(result.picks[0],'#20332b','✳',true);}
  if(points.length)map.stop().fitBounds(points,{padding:[35,35],maxZoom:15,animate:false});
}
function swapComparison(pick){
  if(!swapFrom)return '';
  const changed=result.people.map((p,i)=>{
    const moves=result.personal[i].slice(0,3).map((e,j)=>{
      const old=swapFrom.personal[i]?.[j];
      return old&&old.id!==e.id?`#${j+1}: ${esc(old.name)} → ${esc(e.name)}`:'';
    }).filter(Boolean);
    return moves.length?`<b>${esc(p.name)} personal top 3:</b> ${moves.join(' · ')}`:'';
  }).filter(Boolean).join('<br>');
  return `<p class="swap-change">One taste swapped · Group pick: ${esc(swapFrom.picks[0].name)} → ${esc(pick.name)}${swapFrom.picks[0].id===pick.id?' (unchanged)':''}</p><p>${changed||'Personal top 3 unchanged.'}</p>`;
}
function renderResult(){
  const off=el('taste-off').checked;el('results').hidden=false;
  const pick=result.picks[0];
  el('pick-name').textContent=off?(result.baseline[0]?.name||'No popularity sample'):pick.name;
  const displayed=off?result.baseline[0]:pick;el('pick-context').textContent=displayed?[displayed.genre,displayed.address].filter(Boolean).join(' · '):'';
  el('fairness').textContent=off?`${result.baseline.length} baseline places`:(result.method==='maximin-rank'?`Everyone within top ${pick.worst_rank} of ${result.pool_size}`:'Rank-sum fallback · missing ranks penalized');
  renderContrast(off);
  el('overlap').textContent=`${result.overlap}/${result.overlap_denominator} overlap with popularity`;
  el('timing').textContent=`${(result.elapsed_ms/1000).toFixed(2)}s · ${result.radius/1000} km`;
  el('legend').innerHTML=off?'<span><i style="background:#819075"></i>Popularity · taste off</span>':result.people.map((p,i)=>`<span><i style="background:${colors[i]}"></i>${esc(p.name)}</span>`).join('')+'<span><i style="background:#20332b"></i>Our shared pick</span>';
  el('baseline-note').hidden=!off;el('concessions').hidden=off;
  el('concessions').innerHTML=result.concessions.map((c,i)=>`<article class="concession" style="--color:${colors[i]}"><strong>${esc(c.person)}</strong><span class="rank">${c.rank===null?'Rank unknown':(c.rank===1?'Still #1':`#1 → #${c.rank} · ${c.rank_drop} ${c.rank_drop===1?'place':'places'}`)}</span><small class="place-context">Personal #1 · ${esc(result.personal[i][0]?.genre)} · ${esc(result.personal[i][0]?.address)}</small><div>${esc(c.text)}</div><p class="seed-contributions">${c.contributions?.length?'Qloo taste signal contributions to this pick: '+c.contributions.map(x=>`${esc(x.seed)} ${(x.score*100).toFixed(1)}%`).join(' · '):'Seed contributions unavailable for this response.'}</p></article>`).join('');
  const inputs=result.people.map(p=>`<span><b>${esc(p.name)}</b>: ${p.seeds.map(s=>esc(s.query)).join(' + ')}</span>`).join('');
  const own=result.concessions.map((c,i)=>`${esc(c.person)}: ${esc(c.top)} (${esc(result.personal[i][0]?.genre)})`).join(' · ');
  el('scene-summary').innerHTML=`<div class="input-summary">${inputs}</div><p><b>Without taste:</b> ${esc(result.baseline[0]?.name||'No returned baseline')} · <b>Each person’s own #1:</b> ${own} · <b>Group pick:</b> ${esc(pick.name)}</p><small>Same eligible scene · provider defaults · no popularity cap or bias override. ${esc(pick.genre)} · ${esc(pick.address)}</small>${swapComparison(pick)}`;
  el('list-title').textContent=off?'Popularity baseline':'The common ground shortlist';
  const rows=off?result.baseline:result.picks;
  el('shortlist').innerHTML=rows.map((e,i)=>`<article class="place ${result.contrast.rows.find(r=>r.id===e.id)?.change==='shared'?'shared':'changed'}"><span class="num">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(e.name)}</strong><small>${esc(e.genre)} · ${esc(e.address)}</small><small class="change-label">${result.contrast.rows.find(r=>r.id===e.id)?.change==='shared'?'In both top 10s':(off?'Taste signal leaves this out':'Taste signal brings this in')}</small></div><div class="rank-pills">${off?`<span style="--color:#728d4c">Popularity ${typeof e.popularity==='number'?e.popularity.toFixed(3):'n/a'}</span>`:e.ranks.map((r,j)=>`<span style="--color:${colors[j]}">${e.observed[j]?'#'+r:'—'}</span>`).join('')}</div><button data-veto="${esc(e.id)}" aria-label="Veto ${esc(e.name)}">Veto</button></article>`).join('');
  el('shortlist').querySelectorAll('button').forEach(button=>button.onclick=()=>{veto.excluded=[...new Set([...veto.excluded,button.dataset.veto])];plan();});
  requestAnimationFrame(()=>drawMap(off));
}
el('plan').onclick=()=>plan();
el('taste-off').onchange=()=>{if(result)renderResult();};
el('veto-form').onsubmit=event=>{event.preventDefault();const text=el('veto').value.trim();if(text){el('veto').value='';plan(text);}};
el('swap-taste').onclick=()=>{if(busy)return;const seed=people.flatMap(p=>p.seeds).find(s=>s.type==='artist'&&s.query==='BTS');if(!seed){el('status').textContent='This demo swaps BTS. Restore the default tastes to try it again.';return;}swapFrom=result?structuredClone(result):null;seed.query='Miles Davis';choices={};veto={excluded:[],no_bars:false};renderPeople();plan();};
el('reset').onclick=()=>{veto={excluded:[],no_bars:false};plan();};

function resetScene(){swapFrom=null;choices={};veto={excluded:[],no_bars:false};result=null;el('results').hidden=true;el('questions').hidden=true;el('friend-count').textContent=`${people.length} friends`;el('status').textContent=`Fri 7 p.m. · ${el('area').value} · ${el('occasion').value} · ${people.length} friends`;el('add-friend').disabled=people.length>=5;}
el('people').addEventListener('click',event=>{const add=event.target.closest('[data-addseed]'),remove=event.target.closest('[data-removeseed]');if(!busy&&add&&people[+add.dataset.addseed].seeds.length<3){people[+add.dataset.addseed].seeds.push({query:'',type:'artist'});resetScene();renderPeople();return;}if(!busy&&remove){const [i,j]=remove.dataset.removeseed.split(':').map(Number);if(people[i].seeds.length>1){people[i].seeds.splice(j,1);resetScene();renderPeople();}return;}const button=event.target.closest('[data-remove]');if(button&&!busy&&people.length>1){people.splice(+button.dataset.remove,1);resetScene();renderPeople();}});
el('add-friend').onclick=()=>{if(!busy&&people.length<5){people.push({name:`Friend ${people.length+1}`,seeds:[{query:'',type:'movie'}]});resetScene();renderPeople();el(`seed-${people.length-1}-0`).focus();}};
for(const id of ['area','occasion','radius'])el(id).onchange=resetScene;
function sceneData(){return {v:1,people:people.map(p=>({name:p.name,seeds:p.seeds.map(s=>({query:s.query,type:s.type}))})),area:el('area').value,occasion:el('occasion').value,start_radius:Number(el('radius').value)};}
function encodeScene(scene){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(scene)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decodeScene(hash){const text=hash.replace(/^#scene=/,'').replaceAll('-','+').replaceAll('_','/');if(text.length>12000)throw Error('Scene link is too long.');const scene=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text),c=>c.charCodeAt(0))));if(scene.v!==1||!Array.isArray(scene.people)||scene.people.length<1||scene.people.length>5||!['Seongsu','Williamsburg NYC'].includes(scene.area)||!['Dinner','Cafe','Drinks'].includes(scene.occasion)||![100,2000,3500,5000].includes(scene.start_radius))throw Error('Invalid scene link.');for(const p of scene.people){if(typeof p.name!=='string'||!p.name.trim()||p.name.length>60||!Array.isArray(p.seeds)||p.seeds.length<1||p.seeds.length>3)throw Error('Invalid friend.');for(const s of p.seeds){if(typeof s.query!=='string'||!s.query.trim()||s.query.length>120||!['movie','artist','brand','place','book','tv_show'].includes(s.type))throw Error('Invalid taste seed.');}}return scene;}
el('share').onclick=async()=>{try{const url=new URL(location.href);url.hash='scene='+encodeScene(sceneData());history.replaceState(null,'',url);await navigator.clipboard.writeText(url.href);el('share-status').textContent='Scene link copied';}catch{el('share-status').textContent='Copy the scene link from the address bar';}};
function renderContrast(off){
 const c=result.contrast,rank=c.pick_popularity_rank,added=c.rows.filter(r=>r.change==='added'),removed=c.rows.filter(r=>r.change==='removed');
 const list=rows=>rows.map(r=>`<span><b>${esc(r.name)}</b> · ${esc(r.genre)}<small>Popularity ${r.popularity_rank?'#'+r.popularity_rank:'not returned'} → Taste signal ${r.taste_rank?'#'+r.taste_rank:'not in candidate pool'}</small><small>${esc(r.tags.filter(t=>/urn:tag:(ambience|culinary_style|offerings|service_type):/.test(t.id)).slice(0,3).map(t=>t.name).join(' · ')||'No descriptive tags recorded')}</small></span>`).join('');
 el('contrast').innerHTML=`<div class="decision"><span>${rank===1?'Taste agrees with the popular pick':'THE TASTE SIGNAL PERSPECTIVE'}</span><strong>${esc(result.picks[0].name)}</strong><div>Popularity ${rank?'#'+rank:'outside the returned sample'} → Taste signal #1</div><small>Popularity rank within ${c.sample_count} eligible no-signal results · group ranks within ${result.pool_size} candidates</small></div><div class="contrast-summary">Top 3: ${c.top3_overlap}/${Math.min(3,c.taste_count,c.baseline_count)} shared · Top 10: ${c.overlap} shared, ${added.length} added, ${removed.length} left out</div><div class="delta-columns"><div><h4>+ Taste signal brings in</h4>${list(added)||'No additions'}</div><div><h4>− Taste signal leaves out</h4>${list(removed)||'No removals'}</div></div><small>Overlapping shortlist rows are dimmed. ${off?'Orange pins mark places left out by taste.':'Switch Taste off to inspect the popularity sample.'}</small>`;
}
fetch('/api/config').then(r=>r.json()).then(config=>{people=config.people;if(location.hash.startsWith('#scene=')){const scene=decodeScene(location.hash);people=scene.people;el('area').value=scene.area;el('occasion').value=scene.occasion;el('radius').value=scene.start_radius;}resetScene();renderPeople();plan();}).catch(err=>{el('status').textContent=err.message||'Could not load the scene. Reload to retry.';});
