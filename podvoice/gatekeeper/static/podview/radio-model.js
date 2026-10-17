// Station names are navigation choices, never stream URLs or playback authority.
export const stations=Object.freeze([
 {id:'p3',label:'P3'},
 {id:'p1',label:'P1'},
 {id:'p4-ostjylland',label:'P4 Østjylland'},
 {id:'p6-beat',label:'P6 Beat'},
 {id:'p8-jazz',label:'P8 Jazz'},
].map(station=>Object.freeze(station)));

const byId=new Map(stations.map(station=>[station.id,station]));
export function radioStation(id){return typeof id==='string'?byId.get(id)??null:null;}

// A local-only content preview for the existing PlayerView. The player anatomy
// stays in place, while all observed playback and control capabilities are off.
export function localRadioPlayerModel(stationId,baseVm={}){
 const station=radioStation(stationId);
 if(!station)return null;
 return {
  active:true,playing:false,fresh:false,title:station.label,artist:'Ikke tilsluttet endnu',
  target:typeof baseVm?.target==='string'?baseVm.target:'',
  volume:baseVm?.volume??null,
  fixtureArt:null,artwork:null,canOutput:false,canDiscover:false,
  exampleOnly:true,sourceKind:'radio',previewLabel:'Radio',
 };
}
