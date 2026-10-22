// Agent steps as shown in the panel. Stored steps keep the server's step names; they are renamed here for display only.
const STEPS=(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const distance=m=>m<1000?`${m} m`:`${m/1000} km`;
  const places=n=>`${n} ${n===1?'place':'places'}`;
  function view(row){
    const tool=String(row.tool||''),names=(row.entities||[]).map(String).filter(x=>!ID.test(x)),count=row.count;
    const step={title:tool,lines:names,count:null,list:null};
    // Only Qloo calls report how many results came back.
    if(tool.startsWith('/'))return {...step,title:tool.replace(/ · fallback.*/,' · person'),count,...(tool.endsWith('rescore')?{list:names.slice(1)}:{})};
    if(tool.startsWith('Direct'))return {...step,title:'Plan',lines:[]};
    if(tool==='ask user')return {...step,title:'Ask which one'};
    if(tool==='choose category')return {...step,title:'Choose category'};
    if(tool.startsWith('validate'))return {...step,title:'Filter places',lines:[`${names[0]} · within ${distance(parseInt(names[1],10))} · ${places(count)}`]};
    if(tool.startsWith('widen')){const [,from,to]=(names[0]||'').match(/(\d+) → (\d+)/)||[];return {...step,title:'Search farther',lines:from?[`${distance(+from)} → ${distance(+to)} · fewer than 5 places`]:[]};}
    if(tool==='candidate limit reached')return {...step,title:'Widest search reached',lines:[`${places(count)} left`]};
    if(tool.startsWith('bound')){const [,k]=(names[0]||'').match(/(\d+)/)||[];return {...step,title:'Shared list',lines:[`Top ${k} per friend · ${places(count)}`]};}
    if(tool==='rank-sum')return {...step,title:'Lowest rank sum',lines:['Some ranks are missing; searching wider']};
    if(tool.startsWith('consensus'))return {...step,title:'Fair pick',list:names};
    return step;
  }
  function html(row){
    const v=view(row),shown=v.list?v.lines.slice(0,3):v.lines,more=v.lines.length-shown.length;
    return `<strong>${esc(v.title)}</strong>${shown.length?`<small>${esc(shown.join(' · '))}${more?` · +${more} more`:''}</small>`:''}${v.count===null?'':`<div class="step-meta">${v.count} returned</div>`}${more?`<details><summary>All places</summary><small>${v.list.map(esc).join('<br>')}</small></details>`:''}`;
  }
  return {view,html};
})();
if(typeof module!=='undefined')module.exports=STEPS;
