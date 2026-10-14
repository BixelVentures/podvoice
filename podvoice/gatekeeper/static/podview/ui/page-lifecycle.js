// Window listeners belong to the connected host, never to a removed scene.
export class PageLifecycle {
 constructor(host,target=window){this.host=host;this.target=target;this.hide=()=>{if(host.isConnected)host.cleanup();};this.show=()=>{if(!host.isConnected)return;host.schedule();if(host.live&&host.liveTransport?.closed)host.connectPodVoice();};}
 attach(){this.detach();this.target.addEventListener('pagehide',this.hide);this.target.addEventListener('pageshow',this.show);}
 detach(){this.target.removeEventListener('pagehide',this.hide);this.target.removeEventListener('pageshow',this.show);}
}
