import {PodVoiceTransport} from './podvoice-transport.js';

const form=document.getElementById('pair-form'),field=document.getElementById('pair-code'),submit=document.getElementById('pair-submit'),status=document.getElementById('pair-status');
const transport=new PodVoiceTransport({room:new URLSearchParams(location.search).get('room')||undefined,onConnection:state=>{const connected=state==='connected';submit.disabled=!connected;status.textContent=connected?'PodVoice er klar til opsætning.':'Forbindelsen til PodVoice mangler.';}});
transport.start().catch(()=>{status.textContent='PodVoice kunne ikke nås. Åbn siden igen, når forbindelsen er klar.';});
form.addEventListener('submit',async event=>{event.preventDefault();if(!transport.connected)return;const code=field.value;field.value='';submit.disabled=true;status.textContent='Kontrollerer engangskoden…';try{await transport.pair(code);status.textContent='Skærmen er forbundet i fem minutter. Du kan gå tilbage til PodView.';}catch{status.textContent='Koden kunne ikke bruges. Kontrollér forbindelsen og en ny kode i PodVoice.';}finally{submit.disabled=!transport.connected;}});
window.addEventListener('pagehide',()=>transport.close(),{once:true});
