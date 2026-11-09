// Candidate presentation only. No slider draft, inferred average or effect owner.
const installed = new WeakSet();
export function lightMaterialObservation(device, lamps, connected = true) {
    if (!connected || !device || device.live === true || device.exampleOnly !== true || device.stale || device.hidden || !['on','off','mixed'].includes(device.status) || !lamps?.length)
        return {state:'unknown', level:null};
    if (!lamps.every(lamp => typeof lamp.on === 'boolean' && (lamp.state === undefined || ['on','off'].includes(lamp.state)))) return {state:'unknown',level:null};
    const on = lamps.filter(lamp => lamp.on);
    if (!on.length) return {state:'off',level:null};
    if (on.length !== lamps.length) return {state:'mixed',level:null};
    const first = lamps[0].brightness;
    const shared = lamps.every(lamp => lamp.dimmable === true && Number.isFinite(lamp.brightness) && lamp.brightness >= 0 && lamp.brightness <= 100 && lamp.brightness === first);
    return {state:'on',level:shared ? first : null};
}
export function lightMaterialValues({state,level}) {
    const known = state === 'on' && Number.isFinite(level) && level >= 0 && level <= 100;
    const shown = state === 'on' || state === 'mixed';
    return {known, opacity:shown ? known ? .3 + .6 * level / 100 : .55 : 0,
        scale:known ? .65 + .35 * level / 100 : .8};
}
export function installLightMaterial(host, {
    document=host.ownerDocument || globalThis.document,
    media=document?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)'),
    Observer=globalThis.MutationObserver
}={}) {
    if (host.live !== false || document?.documentElement?.dataset.design !== 'candidate' || installed.has(host)) return;
    installed.add(host);
    const render=host.render, cleanup=host.cleanup, surfaces=new Set();
    let disposed=false, observer;
    const reset=node=>{
        for(const key of ['lightMaterial','lightLevelKnown','lightMaterialMotion']) delete node.dataset[key];
        for(const key of ['--pv-light-material-opacity','--pv-light-material-scale','--pv-light-observed-level']) node.style.removeProperty(key);
    };
    const sync=()=>{
        if(disposed)return;
        if(!host.isConnected){dispose();return;}
        const wanted=new Set(), connected=host.state?.connected!==false;
        const reduced=media?.matches || host.dataset.motion==='reduced' || document.documentElement.dataset.motion==='reduced';
        const apply=(node,observation,pending=false)=>{
            if(!node)return;wanted.add(node);surfaces.add(node);
            const values=lightMaterialValues(observation);
            const attrs={lightMaterial:observation.state,lightLevelKnown:String(values.known),lightMaterialMotion:pending||reduced||document.hidden?'settled':'transition'};
            for(const[key,value]of Object.entries(attrs))if(node.dataset[key]!==value)node.dataset[key]=value;
            const vars={'--pv-light-material-opacity':String(values.opacity),'--pv-light-material-scale':String(values.scale),'--pv-light-observed-level':values.known?String(observation.level):null};
            for(const[key,value]of Object.entries(vars))if(value===null){if(node.style.getPropertyValue(key))node.style.removeProperty(key);}else if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);
        };
        for(const node of host.querySelectorAll('.resource-preview[data-kind="light"]')){
            const device=host.state?.devices?.find(row=>row.id===node.dataset.target);
            apply(node,lightMaterialObservation(device,device?.lights,connected),!!device?.pending);
        }
        const device=host.currentLightDevice?.();
        for(const[id,row]of host.lightRoomView?.rows || [])apply(row.power,lightMaterialObservation(device,device?.lights?.filter(lamp=>lamp.roomId===id),connected),!!device?.pending);
        for(const row of host.inlineLamps?.snapshot?.(device) || []){
            const entry=host.inlineLamps.rows.get(row.id);
            const state=row.stale||row.unavailable||!connected?'unknown':row.on===true?'on':row.on===false?'off':'unknown';
            apply(entry?.node,{state,level:row.dimmable?row.level:null},!!device?.pending||entry?.model?.pending===true);
        }
        for(const node of surfaces)if(!wanted.has(node)){reset(node);surfaces.delete(node);}
    };
    const wrapped=host.render=function(...args){const result=render.apply(this,args);sync();return result;};
    const dispose=()=>{
        if(disposed)return;disposed=true;observer?.disconnect();
        media?.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);
        for(const node of surfaces)reset(node);surfaces.clear();installed.delete(host);
        if(host.render===wrapped)host.render=render;
        if(host.cleanup===teardown)host.cleanup=cleanup;
    };
    const teardown=host.cleanup=function(...args){dispose();return cleanup.apply(this,args);};
    if(Observer){observer=new Observer(sync);observer.observe(host,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','data-motion','data-resource-status']});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});}
    media?.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);sync();
}
