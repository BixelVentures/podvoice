'use strict';
// Draws the Vejr hero's decorations (public/assets/weather/*.svg, a masked 60 KB vector each) once as 2× WebP for
// the HA panel (src/panel/panel.css). WebKit rasterizes those SVGs again on every repaint of the hero, which costs a
// 50–70 ms frame when Vejr comes in; a bitmap of the same pixels is only composited. Run after changing an SVG:
//   node podview/build/raster-weather.cjs   (uses the browser journeys' Playwright Chromium)
const path=require('node:path');
const fs=require('node:fs/promises');
const playwright=require(path.join(__dirname,'../../tests/browser/node_modules/playwright'));
// Displayed size in CSS px (ui-kit.css, #weather-view>.weather-current::before).
const ART={'weather-cloud':[470,360],'weather-sun':[380,300],'weather-rain':[380,300],'weather-snow':[380,300],
 'weather-fog':[380,300],'weather-storm':[380,300]};
(async()=>{
 const browser=await playwright.chromium.launch();const page=await browser.newPage();
 const dir=path.join(__dirname,'../public/assets/weather');
 await fs.mkdir(path.join(dir,'raster'),{recursive:true});
 for(const [name,[width,height]] of Object.entries(ART)){
  const svg=await fs.readFile(path.join(dir,`${name}.svg`),'utf8');
  const data=await page.evaluate(async({svg,width,height})=>{
   const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));
   await image.decode();
   const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
   const context=canvas.getContext('2d');
   // background-size W×H with the image's own aspect: CSS draws it stretched to exactly that box.
   context.drawImage(image,0,0,width*2,height*2);
   return canvas.toDataURL('image/webp',0.92);
  },{svg,width,height});
  await fs.writeFile(path.join(dir,'raster',`${name}.webp`),Buffer.from(data.split(',')[1],'base64'));
  console.log(name);
 }
 await browser.close();
})();
