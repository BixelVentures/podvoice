// Only observed or explicit local activities enter the existing overview slot.
export function overviewActivities(timers=[],devices=[],vehicle=null,{allowExamples=false}={}){
 const active=timers.filter(t=>!t.hidden&&['running','paused','done'].includes(t.status));
 return [...active.map(t=>({id:`timer:${t.id}`,kind:'timer',resource:t,label:t.name||'Timer'})),...devices.filter(d=>!d.hidden&&!d.presentationOnly&&d.kind==='vacuum'&&['cleaning','paused','docking','fault'].includes(d.status)).sort((a,b)=>(a.status==='fault'?0:1)-(b.status==='fault'?0:1)).map(d=>({id:`device:${d.id}`,kind:'vacuum',resource:d,label:'Robotstøvsuger'})),...(((vehicle?.mode==='observed'&&vehicle.source==='home_assistant_state')||(allowExamples&&vehicle?.mode==='fixture'&&vehicle.exampleOnly===true))&&!vehicle.stale&&vehicle.charging?.status==='charging'?[{id:'vehicle:charging',kind:'vehicle',resource:vehicle,label:'Tesla oplader'}]:[])];
}
export function selectOverviewActivity(activities,selectedId){
 return activities.find(item=>item.id===selectedId)||activities.find(item=>item.kind==='timer')||activities[0]||null;
}
