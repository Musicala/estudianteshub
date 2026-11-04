import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(`${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`);
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
const staged=path.resolve('../output/estudiantes-recursos-20261104/public');
await page.route('https://musicala-estudianteshub.web.app/resource-smoke',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main id="view" style="padding:16px"></main></body></html>'}));
if(!process.env.RESOURCES_LIVE) await page.route('**/src/data.js',r=>r.fulfill({contentType:'text/javascript',path:path.join(staged,'src/data.js')}));
try {
  await page.goto('https://musicala-estudianteshub.web.app/resource-smoke');
  const result=await page.evaluate(async()=>{
    const api=await import('/src/data.js');const {renderRoute}=await import('/src/views.js');
    const student={id:'resource-check',nombre:'Estudiante de Piano',area:'Música',instrument:'Piano',processes:[{arte:'Música',detalle:'Piano'}]};
    const items=await api.listResources({student});
    const render=await renderRoute('resources',{ctx:{user:{uid:'read-only-check'},studentId:student.id,student},api:{listResources:async()=>items}});
    document.querySelector('#view').innerHTML=render.html;render.afterRender();
    return {total:items.length,piano:items.filter(r=>r.especialidad==='piano').length,teoria:items.filter(r=>r.especialidad==='teoria-musical').length};
  });
  assert.equal(result.piano,402);assert.equal(result.teoria,43);
  await page.locator('#biblioGrid').getByText('Música',{exact:true}).click();
  assert.match(await page.locator('#biblioGrid').innerText(),/402 recurso/);
  assert.match(await page.locator('#biblioGrid').innerText(),/43 recurso/);
  await mkdir('tests/artifacts',{recursive:true});await page.screenshot({path:'tests/artifacts/resources-mobile.png',fullPage:true});
  console.log(JSON.stringify({realFirestoreRead:true,mobileFolders:true,...result,live:Boolean(process.env.RESOURCES_LIVE)}));
} finally {await browser.close();}
