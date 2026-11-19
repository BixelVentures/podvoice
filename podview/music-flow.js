// Both simulated speech and touch submit the same bound option, never a position.
export const newMusicFlow=()=>({phase:'idle',run:0,sessionId:null,revision:null,optionId:null,operation:null});
export function musicFlow(s,e){
 if(e.type==='start')return {...newMusicFlow(),phase:'listening',run:s.run+1,sessionId:e.sessionId,revision:e.revision};
 if(e.type==='cancel')return {...s,phase:'idle',run:s.run+1};
 if(e.run!==s.run)return s;
 if(e.type==='heard'&&s.phase==='listening')return {...s,phase:'thinking'};
 if(e.type==='options'&&s.phase==='thinking')return {...s,phase:'choosing',revision:e.revision};
 if(e.type==='choose'&&s.phase==='choosing'&&e.sessionId===s.sessionId&&e.revision===s.revision&&e.allowed.includes(e.optionId))return {...s,phase:'selecting',optionId:e.optionId,operation:e.operation};
 if(e.type==='receipt'&&s.phase==='selecting'&&e.operation===s.operation)return {...s,phase:'playing'};
 if(e.type==='settle'&&s.phase==='playing')return {...s,phase:'settled'};
 return s;
}
