// Retained, native button anatomy shared by the overview and supporting stack.
// Visuals reflect known local state only; there is no invented device telemetry.
export function createResourceTile(open){
 const b=document.createElement('button');b.type='button';b.className='resource-preview';
 b.innerHTML='<span class="resource-visual" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="resource-dial-track" cx="40" cy="40" r="34"/><circle class="resource-dial-progress" cx="40" cy="40" r="34" pathLength="100"/></svg><img alt=""><span class="resource-value"></span></span><span class="resource-label"><strong></strong><small></small></span><img class="resource-chevron" src="assets/icons/chevron-right.svg" alt="">';
 b.addEventListener('click',()=>open(b.dataset.target));return b;
}
export function updateResourceTile(b,r){
 b.hidden=false;b.dataset.target=r.target;b.dataset.kind=r.kind;b.dataset.status=r.status||'';
 b.querySelector('strong').textContent=r.title;b.querySelector('small').textContent=r.detail;
 b.querySelector('.resource-value').textContent=r.value||'';
 const icon=b.querySelector('.resource-visual img');icon.hidden=r.kind==='timer';
 if(!icon.hidden)icon.src=`assets/icons/${r.kind==='vacuum'?'vacuum':'lightbulb'}.svg`;
 b.querySelector('svg').style.display=r.kind==='timer'?'':'none';b.style.setProperty('--remaining',Math.max(0,Math.min(100,(r.remaining||0)/(r.duration||60)*100)));
 b.setAttribute('aria-label',`${r.title}${r.value?' · '+r.value:''} · ${r.detail}. Åbn detaljer`);
}
