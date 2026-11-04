'use strict';
// Shared test-only environment; never imported by the shipped application.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const runtimeRoot=path.resolve(process.env.PODVIEW_TEST_RUNTIME_ROOT||root);
const python=process.env.PODVIEW_TEST_PYTHON||'python3';
let artifacts;
function pythonEnv(extra={}){
 const search=[path.join(runtimeRoot,'podvoice'),runtimeRoot,path.join(runtimeRoot,'tests')];
 if(process.env.PODVIEW_TEST_EXTRA_PYTHONPATH)search.push(process.env.PODVIEW_TEST_EXTRA_PYTHONPATH);
 return {...process.env,...extra,PYTHONPATH:search.join(path.delimiter)};
}
function browserOptions(){
 const options={headless:true};
 const requested=process.env.PODVIEW_TEST_CHROMIUM;
 if(requested){if(!fs.existsSync(requested))throw new Error('PODVIEW_TEST_CHROMIUM does not exist');options.executablePath=requested;}
 else if(process.platform==='darwin'){
  const mac='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if(fs.existsSync(mac))options.executablePath=mac;
 }
 return options;
}
function artifactDir(){
 if(!artifacts){
  if(process.env.PODVIEW_TEST_ARTIFACT_DIR){artifacts=path.resolve(process.env.PODVIEW_TEST_ARTIFACT_DIR);fs.mkdirSync(artifacts,{recursive:true});}
  else artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'podview-actual-proof-'));
 }
 return artifacts;
}
module.exports={root,runtimeRoot,python,pythonEnv,browserOptions,artifactDir};
