const colors=['#9c66b9','#dd8257','#4a99a3','#728d4c','#ab7c96'];
const el=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let people=[],result=null,choices={},veto={excluded:[],no_bars:false},map=null,pins=[],busy=false,steps=[];
function renderPeople(){
  el('people').innerHTML=people.map((p,i)=>`<article class="person" style="--color:${colors[i]}"><div class="person-head"><span class="avatar">${i+1}</span><h3>${esc(p.name)}</h3></div>${p.seeds.map((s,j)=>`<div class="seed"><label class="sr-only" for="type-${i}-${j}">Seed type for friend ${i+1}, taste ${j+1}</label><select id="type-${i}-${j}" data-person="${i}" data-seed="${j}" data-field="type">${['movie','artist','brand','place','book','tv_show'].map(t=>`<option ${t===s.type?'selected':''} value="${t}">${t.replace('_',' ')}</option>`).join('')}</select><label class="sr-only" for="seed-${i}-${j}">Taste ${j+1} for ${esc(p.name)}</label><input id="seed-${i}-${j}" value="${esc(s.query)}" data-person="${i}" data-seed="${j}" data-field="query" maxlength="120"></div>`).join('')}</article>`).join('');
}
el('people').addEventListener('input',event=>{
  const node=event.target;if(node.dataset.field){people[+node.dataset.person].seeds[+node.dataset.seed][node.dataset.field]=node.value;choices={};}
});
function addStep(row){
  steps.push(row);el('step-count').textContent=String(steps.length).padStart(2,'0');
  if(steps.length===1)el('steps').innerHTML='';
  const li=document.createElement('li');
  const names=row.entities||[];
  li.innerHTML=`<strong>${esc(row.tool)}</strong><small>${esc(names.slice(0,3).join(' · '))}${names.length>3?` · +${names.length-3} entities`:''}</small><div class="step-meta"><span>${row.count} returned</span><span>${(row.latency_ms/1000).toFixed(2)}s</span>${'cache' in row?`<span>${row.cache?'CACHE':'LIVE'}</span>`:''}</div>${names.length>3?`<details><summary>Entity IDs</summary><small>${names.map(esc).join('<br>')}</small></details>`:''}`;
  el('steps').append(li);li.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function setBusy(value){
  busy=value;el('plan').disabled=value;
  document.querySelectorAll('#veto-form button,#shortlist button,#questions button').forEach(b=>b.disabled=value);
}
async function plan(vetoText=''){
  if(busy)return;
  setBusy(true);steps=[];el('step-count').textContent='00';el('steps').innerHTML='';el('questions').hidden=true;
  el('results').hidden=true;el('status').textContent='Finding the overlap between three worlds…';
  const body={people,choices,area:el('area').value,occasion:el('occasion').value,veto,veto_text:vetoText,current_pick:result?.picks?.[0]?.id};
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
          if(event.result.status==='clarification'){showQuestions(event.result.questions);el('status').textContent='A name needs a little more context.';}
          else{result=event.result;el('taste-off').checked=false;renderResult();el('status').textContent=`${result.pool_size} eligible places · ${result.session_calls} session calls`;}
        }
      }
      if(done)break;
    }
    if(!finished)throw new Error('The connection ended before a plan was ready. Please retry.');
  }catch(err){el('status').textContent=err.message;}
  finally{setBusy(false);}
}
function showQuestions(questions){
  const question=questions[0];el('questions').hidden=false;
  el('questions').innerHTML=`<h3>Which “${esc(question.query)}”?</h3><p>${esc(question.person)}’s taste could refer to different places or entities. Pick the one you mean.</p>${question.options.map((e,i)=>`<button data-choice="${i}"><strong>${esc(e.name)}</strong><br><small>${esc(e.genre||e.types?.join(', '))} · ${esc(e.address)}</small></button>`).join('')}${question.options.length?'':'<p>No matches. Edit the seed above and try again.</p>'}`;
  el('questions').querySelectorAll('button').forEach(button=>button.onclick=()=>{choices[question.key]=question.options[+button.dataset.choice].id;plan();});
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
  if(off)result.baseline.forEach((e,i)=>pin(e,'#819075',i+1));
  else{result.personal.forEach((rows,i)=>rows.slice(0,5).forEach((e,j)=>pin(e,colors[i],j+1)));pin(result.picks[0],'#20332b','✳',true);}
  if(points.length)map.fitBounds(points,{padding:[35,35],maxZoom:15});
}
function renderResult(){
  const off=el('taste-off').checked;el('results').hidden=false;
  const pick=result.picks[0];
  el('pick-name').textContent=off?'The popularity perspective':pick.name;
  el('fairness').textContent=off?`${result.baseline.length} baseline places`:(result.method==='maximin-rank'?`Everyone within top ${pick.worst_rank} of ${result.pool_size}`:'Rank-sum fallback · missing ranks penalized');
  el('overlap').textContent=`${result.overlap}/${result.overlap_denominator} overlap with popularity`;
  el('timing').textContent=`${(result.elapsed_ms/1000).toFixed(2)}s · ${result.radius/1000} km`;
  el('legend').innerHTML=off?'<span><i style="background:#819075"></i>Popularity · taste off</span>':result.people.map((p,i)=>`<span><i style="background:${colors[i]}"></i>${esc(p.name)}</span>`).join('')+'<span><i style="background:#20332b"></i>Our shared pick</span>';
  el('baseline-note').hidden=!off;el('concessions').hidden=off;el('narration').hidden=off;
  el('concessions').innerHTML=result.concessions.map((c,i)=>`<article class="concession" style="--color:${colors[i]}"><strong>${esc(c.person)}</strong><span class="rank">${c.rank===null?'Rank unknown':`#1 → #${c.rank} · ${c.rank_drop} places`}</span><div>${esc(c.text)}</div></article>`).join('');
  el('narration').textContent=result.narration||'';
  el('list-title').textContent=off?'Popularity baseline':'The common ground shortlist';
  const rows=off?result.baseline:result.picks;
  el('shortlist').innerHTML=rows.map((e,i)=>`<article class="place"><span class="num">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(e.name)}</strong><small>${esc(e.genre)} · ${esc(e.address)}</small></div><div class="rank-pills">${off?`<span style="--color:#728d4c">Popularity ${typeof e.popularity==='number'?e.popularity.toFixed(3):'n/a'}</span>`:e.ranks.map((r,j)=>`<span style="--color:${colors[j]}">${e.observed[j]?'#'+r:'—'}</span>`).join('')}</div><button data-veto="${esc(e.id)}" aria-label="Veto ${esc(e.name)}">Veto</button></article>`).join('');
  el('shortlist').querySelectorAll('button').forEach(button=>button.onclick=()=>{veto.excluded=[...new Set([...veto.excluded,button.dataset.veto])];plan();});
  requestAnimationFrame(()=>drawMap(off));
}
el('plan').onclick=()=>plan();
el('taste-off').onchange=()=>{if(result)renderResult();};
el('veto-form').onsubmit=event=>{event.preventDefault();const text=el('veto').value.trim();if(text){el('veto').value='';plan(text);}};
el('reset').onclick=()=>{veto={excluded:[],no_bars:false};plan();};
el('area').onchange=()=>{choices={};veto={excluded:[],no_bars:false};el('status').textContent=`Fri 7 p.m. · ${el('area').value} · ${el('occasion').value} · 3 friends`;};
el('occasion').onchange=()=>{veto={excluded:[],no_bars:false};el('status').textContent=`Fri 7 p.m. · ${el('area').value} · ${el('occasion').value} · 3 friends`;};
fetch('/api/config').then(r=>r.json()).then(config=>{people=config.people;renderPeople();}).catch(()=>{el('status').textContent='Could not load the scene. Reload to retry.';});
