// A bounded request owns one child abort signal. Mutations are sent once;
// timeout means unknown, not permission to retry. Parent shutdown cancels it.
export async function requestWithin(fetch,url,options,signal,ms=12000){
 const child=new AbortController(),abort=()=>child.abort(signal?.reason);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timeout=setTimeout(()=>child.abort(new DOMException('Request timed out','TimeoutError')),ms);
 try{return await fetch(url,{...options,signal:child.signal});}
 finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
