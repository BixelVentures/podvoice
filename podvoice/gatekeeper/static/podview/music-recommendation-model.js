// Presentation-only ordering of one already admitted source. No profile, network,
// new recommendations or command authority; returned indices address that source.
export function musicSourcePage(tracks,kind,offset=0){
 if(!['top','recent','mood','feeling','account_playlists'].includes(kind)||!Array.isArray(tracks)||tracks.length>100||!Number.isInteger(offset)||offset<0||offset%3!==0)return null;
 const trackSource=['top','recent'].includes(kind),uriPattern=trackSource?/^spotify:track:[A-Za-z0-9]{22}$/:/^spotify:playlist:[A-Za-z0-9]{22}$/;
 if(tracks.some(row=>!row||!uriPattern.test(row.uri)||typeof (row.name??row.title)!=='string'||!(row.name??row.title).length||(row.name??row.title).length>256||typeof row.artist!=='string'||row.artist.length>512))return null;
 // Keep the first exact occurrence and its opaque source index. Covers, artist
 // labels and titles are never deduplicated or treated as affinity evidence.
 const seen=new Set(),remaining=[];tracks.forEach((row,index)=>{if(!trackSource||!seen.has(row.uri)){remaining.push(index);seen.add(row.uri);}});
 const ordered=[];
 while(remaining.length){
  const page=[],artists=new Set();
  // Known exact source artist labels diversify each trio. Missing artist labels
  // stay independent; no splitting, genre/tempo/name analysis or history learner.
  if(trackSource)for(const index of remaining){const artist=tracks[index].artist;if(artist&&artists.has(artist))continue;page.push(index);if(artist)artists.add(artist);if(page.length===3)break;}
  for(const index of remaining){if(page.length===3)break;if(!page.includes(index))page.push(index);}
  ordered.push(...page);for(const index of page)remaining.splice(remaining.indexOf(index),1);
 }
 const start=offset<ordered.length?offset:0;
 return {indices:ordered.slice(start,start+3),offset:start,total:ordered.length};
}
