// While a page or Ro layer moves, the observers that measure the page (ScrollEdges, CssFlags) wait, and run once
// when it has landed (docs/MOTION.md §0). The signal lives here in memory: it writes no attribute, so starting or
// ending a movement invalidates no selector. A movement that never ends (an exception between begin and end) is
// closed after LIMIT ms, so observers cannot stay asleep. No DOM: Node tests can import it.
const LIMIT=2000;
const open=new Set(),waiting=new Set();

function settle(){
 if(open.size)return;
 const callbacks=[...waiting];waiting.clear();
 for(const callback of callbacks){try{callback();}catch(error){queueMicrotask(()=>{throw error;});}}
}
// Marks a movement as started. Returns end(); calling it more than once is harmless.
export function begin(){
 const token={};open.add(token);
 const finish=()=>{if(!open.delete(token))return;clearTimeout(timer);settle();};
 const timer=setTimeout(finish,LIMIT);
 return finish;
}
// end(begin()) is the same as calling what begin() returned.
export function end(handle){handle?.();}
export function isBusy(){return open.size>0;}
// Runs callback once when no movement is open (at once if none is). The same function is queued only once, so an
// observer that is told several times during a push runs once after it. Returns a cancel function.
export function onIdle(callback){
 if(!open.size){callback();return ()=>{};}
 waiting.add(callback);
 return ()=>waiting.delete(callback);
}
