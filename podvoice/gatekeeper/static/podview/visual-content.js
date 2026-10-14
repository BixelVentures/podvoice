// Read-only visual payloads. This validates shape, not the truth of source data.
export const visualFamilies = ['fact-card','sourced-image','answer-timeline','simple-diagram'];
const string = (value, max = 300) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const fail = () => { throw new Error('Invalid visual content'); };
function link(value, image = false) {
 if (!string(value, 2048) || /[\s\\]/.test(value)) return false;
 // Relative content must be an app-owned asset or an explicit local source page.
 if (image && /^assets\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$/.test(value) && !value.includes('..')) return true;
 if (!image && value === 'example-sources.html') return true;
 try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
function rows(items, max, check) {
 if (!Array.isArray(items) || !items.length || items.length > max) fail();
 const ids = new Set();
 for (const item of items) {
  if (!item || !string(item.id, 80) || ids.has(item.id) || !check(item)) fail();
  ids.add(item.id);
 }
}
export function validateVisualContent(family, raw) {
 if (!visualFamilies.includes(family) || !raw || !string(raw.summary, 600)) fail();
 rows(raw.sources, 4, s => string(s.label, 120) && link(s.url) && string(s.scope, 240));
 const sourceIds = new Set(raw.sources.map(s => s.id));
 const sourced = x => sourceIds.has(x.sourceId);
 if (family === 'fact-card') rows(raw.facts, 6, f => string(f.label, 80) && string(f.value, 80) && string(f.detail, 200) && sourced(f));
 if (family === 'sourced-image' && (!link(raw.image?.url, true) || !string(raw.image?.alt, 300) || !string(raw.image?.caption, 300) || !string(raw.image?.credit, 160) || !['photo','illustration'].includes(raw.image?.kind) || !sourced(raw.image))) fail();
 if (family === 'answer-timeline') rows(raw.events, 8, e => string(e.time, 80) && string(e.label, 120) && string(e.detail, 240) && ['planned','observed'].includes(e.status) && sourced(e));
 if (family === 'simple-diagram') rows(raw.nodes, 5, n => string(n.label, 80) && string(n.detail, 200) && sourced(n));
 // Return a closed shape: model-supplied HTML/styles/actions never enter the renderer.
 const result = {summary: raw.summary, sources: raw.sources.map(({id,label,url,scope}) => ({id,label,url,scope}))};
 if (family === 'fact-card') result.facts = raw.facts.map(({id,label,value,detail,sourceId}) => ({id,label,value,detail,sourceId}));
 if (family === 'sourced-image') { const {url,alt,caption,credit,kind,sourceId} = raw.image; result.image = {url,alt,caption,credit,kind,sourceId}; }
 if (family === 'answer-timeline') result.events = raw.events.map(({id,time,label,detail,status,sourceId}) => ({id,time,label,detail,status,sourceId}));
 if (family === 'simple-diagram') result.nodes = raw.nodes.map(({id,label,detail,sourceId}) => ({id,label,detail,sourceId}));
 return result;
}
