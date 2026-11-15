// PodView has one layout: the 1180×820 wall-iPad canvas. The delivered stylesheet is resolved
// for exactly that stage, so the browser frame size (HA sidebar, header, safe areas, portrait)
// can never switch to another layout. The page scales the stage uniformly (ui/stage.js).
export const STAGE={width:1180,height:820};
const SIZE=/^(min-|max-)?(width|height|aspect-ratio|orientation)$/;

function featureHolds(name,value,stage){
 const [, bound,feature]=SIZE.exec(name);
 if(feature==='orientation')return value===(stage.width>=stage.height?'landscape':'portrait');
 let actual,wanted;
 if(feature==='aspect-ratio'){
  const [a,b='1']=value.split('/').map(part=>part.trim());
  actual=stage.width/stage.height;wanted=Number(a)/Number(b);
 }else{
  const match=/^(\d*\.?\d+)px$/.exec(value);
  if(!match)throw Error(`Unsupported stage media value: ${name}:${value}`);
  actual=stage[feature];wanted=Number(match[1]);
 }
 if(bound==='min-')return actual>=wanted;
 if(bound==='max-')return actual<=wanted;
 return actual===wanted;
}

// Returns null when the query can never match the stage, '' when it always matches,
// or the remaining non-size query (for example prefers-reduced-motion).
function resolveQuery(query,stage){
 const rest=[];
 for(const part of query.trim().split(/\s+and\s+/i)){
  const feature=/^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/i.exec(part.trim());
  if(feature&&SIZE.test(feature[1].toLowerCase())){
   if(!featureHolds(feature[1].toLowerCase(),feature[2].toLowerCase(),stage))return null;
  }else if(part.trim()&&!/^(all|screen)$/i.test(part.trim()))rest.push(part.trim());
 }
 return rest.join(' and ');
}

function closingBrace(css,open){
 let depth=0;
 for(let i=open;i<css.length;i++){
  const ch=css[i];
  if(ch==='"'||ch==="'"){i=css.indexOf(ch,i+1);if(i<0)break;continue;}
  if(ch==='/'&&css[i+1]==='*'){i=css.indexOf('*/',i+2)+1;continue;}
  if(ch==='{')depth++;
  else if(ch==='}'&&--depth===0)return i;
 }
 throw Error('Unbalanced CSS block in stage stylesheet');
}

export function resolveStageMedia(css,stage=STAGE){
 let out='',at=0;
 const pattern=/@media\b/gi;
 for(let match;(match=pattern.exec(css));){
  const open=css.indexOf('{',match.index);
  const close=closingBrace(css,open);
  const queries=css.slice(match.index+6,open).split(',').map(query=>resolveQuery(query,stage));
  const inner=resolveStageMedia(css.slice(open+1,close),stage);
  out+=css.slice(at,match.index);
  if(queries.includes(''))out+=inner;
  else{
   const kept=queries.filter(query=>query!==null);
   if(kept.length)out+=`@media ${kept.join(',')}{${inner}}`;
  }
  at=close+1;pattern.lastIndex=at;
 }
 return out+css.slice(at);
}

// Viewport units mean the stage, not the browser frame.
export function resolveStageUnits(css,stage=STAGE){
 const unit={vw:stage.width/100,vh:stage.height/100,vmin:Math.min(stage.width,stage.height)/100,
  vmax:Math.max(stage.width,stage.height)/100};
 return css.replace(/(^|[^\w.#-])(-?\d*\.?\d+)[dsl]?(vmin|vmax|vw|vh)\b/g,(all,lead,number,name)=>
  `${lead}${+(Number(number)*unit[name]).toFixed(3)}px`);
}

export function resolveStage(css,stage=STAGE){
 return resolveStageUnits(resolveStageMedia(css,stage),stage);
}
