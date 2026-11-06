const fs=require('fs'),path=require('path');const {chromium}=require(path.resolve(__dirname,'../../../node_modules/playwright'))
const [base,size]=process.argv.slice(2);const TASKS='/workspaces/ws_01/tasks'
const src=fs.readFileSync(path.join(__dirname,'e2e.cjs'),'utf8')
const seed=new Function('base','TASKS',`${src.slice(src.indexOf('async function seed'),src.indexOf('const OBSERVE'))}; return seed`)(base,TASKS)
;(async()=>{const b=await chromium.launch();const c=await b.newContext();const p=await c.newPage();await seed(p,Number(size))
await p.goto(`${base}${TASKS}?view=gantt&from=2026-09-14`);await p.waitForSelector('[aria-label="일정 표"]',{timeout:60000})
const counts=new Map();p.on('request',r=>{if(r.url().includes('/api/')){const k=r.method()+' '+new URL(r.url()).pathname.replace(/\/(tk|ap|mt|mb)_[^/]+/g,'/:id');counts.set(k,(counts.get(k)??0)+1)}})
await p.getByRole('radio',{name:'보드'}).or(p.getByRole('tab',{name:'보드'})).or(p.getByRole('button',{name:'보드'})).first().click()
await p.waitForSelector('[aria-label="시작 전"]',{timeout:120000});await p.waitForTimeout(2000);console.log([...counts]);await b.close()})()
