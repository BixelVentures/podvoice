// Same-origin HA-ingress transport. Import only in live /view/ mode.
// No provider credentials, cross-origin bridge, background retries or offline actions.
export class PodVoiceTransport {
 constructor({url = globalThis.location?.href, room, fetch = globalThis.fetch?.bind(globalThis), EventSource = globalThis.EventSource, onSnapshot = () => {}, onConnection = () => {}} = {}) {
  const page = new URL(url);
  if (!['https:', 'http:'].includes(page.protocol) || !/\/view\//.test(page.pathname)) throw new Error('PodVoice ingress /view/ is required');
  const prefix = page.pathname.slice(0, page.pathname.lastIndexOf('/view/') + 6);
  this.base = new URL(`${prefix}api/`, page.origin);
  this.room = room; this.fetch = fetch; this.EventSource = EventSource;
  this.onSnapshot = onSnapshot; this.onConnection = onConnection;
  this.snapshot = null; this.connected = false; this.closed = true; this.generation = 0;
 }
 endpoint(path, params = {}) {
  if (!['snapshot','events','music','actions','pair'].includes(path)) throw new Error('unsupported_endpoint');
  const url = new URL(path, this.base);
  if (this.room) url.searchParams.set('room', this.room);
  for (const [key,value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key,value);
  return url;
 }
 accept(value) {
  if (this.closed || value?.schema !== 'podview.snapshot.v1' || typeof value.bootId !== 'string' || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.roomId !== 'string' || !value.voice || !value.timers || !value.capabilities) return false;
  if (!['observed','unavailable'].includes(value.timers.status)||!Array.isArray(value.timers.items)||!Array.isArray(value.capabilities.musicRead)||!Array.isArray(value.capabilities.timerActions)) return false;
  if (this.room && value.roomId !== this.room) return false;
  if (this.snapshot?.bootId === value.bootId && this.snapshot.revision > value.revision) return false;
  this.room = value.roomId; this.snapshot = value; this.connected = true;
  this.onConnection('connected'); this.onSnapshot(value); return true;
 }
 async start() {
  this.close(); this.closed = false;
  const generation = this.generation;
  this.controller = new AbortController();
  this.onConnection('connecting');
  try {
   const response = await this.fetch(this.endpoint('snapshot'), {credentials:'same-origin', cache:'no-store', signal:this.controller.signal});
   const value = await response.json();
   if (generation !== this.generation) return;
   if (!response.ok || !this.accept(value)) throw new Error(value.error || 'invalid_snapshot');
   this.stream = new this.EventSource(this.endpoint('events'), {withCredentials:false});
   this.stream.addEventListener('snapshot', event => {
    if (generation !== this.generation) return;
    try { if (!this.accept(JSON.parse(event.data))) this.disconnected(); } catch { this.disconnected(); }
   });
   this.stream.onerror = () => { if (generation === this.generation) this.disconnected(); };
  } catch (error) { if (generation === this.generation) { this.disconnected(); throw error; } }
 }
 disconnected() { this.connected = false; this.onConnection('disconnected'); }
 async music(kind, account) {
  if (!this.connected || !this.snapshot.capabilities.musicRead?.includes(kind)) throw new Error('music_unavailable');
  const response = await this.fetch(this.endpoint('music', {kind,account}), {credentials:'same-origin',cache:'no-store',signal:this.controller.signal});
  const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || 'music_unavailable');
  return body;
 }
 async pair(code) {
  if (!this.connected || !this.room) throw new Error('disconnected');
  const response = await this.fetch(this.endpoint('pair'), {method:'POST',credentials:'same-origin',cache:'no-store',signal:this.controller.signal,headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({roomId:this.room,code})});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'pairing_denied');
  // Cookie is HttpOnly: reopen SSE so its request captures the newly paired cookie.
  await this.start();
  return result;
 }
 async action({action, args, requestId}) {
  if (!this.connected || !this.snapshot) throw new Error('control_not_paired');
  const snapshot = this.snapshot;
  if (!snapshot.capabilities.timerActions.includes(action)) throw new Error('unsupported_action');
  const body = {bootId:snapshot.bootId,roomId:snapshot.roomId,taskId:`timers:${snapshot.timers.epoch}`,revision:snapshot.revision,requestId,action,args};
  // Exactly one send. A transport failure is UNKNOWN, never permission to resend.
  try {
   const response = await this.fetch(this.endpoint('actions'), {method:'POST',credentials:'same-origin',cache:'no-store',signal:this.controller.signal,headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify(body)});
   return await response.json();
  } catch { return {ok:false,requestId,outcome:'unknown',retryAllowed:false}; }
 }
 close() {
  this.generation++; this.closed = true; this.connected = false;
  this.controller?.abort(); this.stream?.close(); this.stream = null;
 }
}
