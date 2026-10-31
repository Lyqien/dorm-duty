import http from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
await pool.query('CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY,data JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
const empty={name:'我们的宿舍',members:[],turn:{trash:null,water:null},history:[]};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const valid=data=>data&&typeof data.name==='string'&&data.name.length<=40&&Array.isArray(data.members)&&data.members.length<=100&&data.members.every(m=>m&&typeof m.id==='string'&&typeof m.name==='string'&&m.name.trim()&&m.name.length<=20)&&new Set(data.members.map(m=>m.id)).size===data.members.length&&Array.isArray(data.history)&&data.history.length<=1000&&data.history.every(h=>h&&['trash','water'].includes(h.kind)&&typeof h.name==='string'&&typeof h.id==='string'&&Number.isFinite(h.time))&&data.turn;
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>250000)throw Object.assign(new Error('请求过大'),{status:413})}return JSON.parse(raw)}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/healthz'){await pool.query('SELECT 1');return send(res,200,{ok:true})}
 const match=url.pathname.match(/^\/api\/rooms(?:\/([a-zA-Z0-9-]+))?$/);
 if(match){let code=match[1];
  if(req.method==='GET'&&code){if(code==='default'){
   await pool.query('INSERT INTO rooms(code,data) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM rooms) ON CONFLICT DO NOTHING',['shared-dorm',empty]);
   const {rows}=await pool.query('SELECT code,data,version FROM rooms ORDER BY created_at,code LIMIT 1');return send(res,200,rows[0]);
  }const {rows}=await pool.query('SELECT code,data,version FROM rooms WHERE code=$1',[code]);return send(res,rows.length?200:404,rows[0]||{error:'没有找到宿舍'});}
  if(req.method==='POST'&&!code){const b=await body(req),name=String(b.name||'').trim().slice(0,40);if(!name)return send(res,400,{error:'请输入宿舍名称'});code=randomUUID().replaceAll('-','').slice(0,16);const data={...empty,name};await pool.query('INSERT INTO rooms(code,data) VALUES($1,$2)',[code,data]);return send(res,200,{code,data,version:0})}
  if(req.method==='PUT'&&code&&code!=='default'){const {data,version}=await body(req);if(!valid(data)||!Number.isInteger(version))return send(res,400,{error:'数据格式无效'});const {rows}=await pool.query('UPDATE rooms SET data=$1,version=version+1 WHERE code=$2 AND version=$3 RETURNING code,data,version',[data,code,version]);return send(res,rows.length?200:409,rows[0]||{error:'舍友刚刚更新了记录，已刷新，请重新操作'})}
  return send(res,405,{error:'不支持此操作'});
 }
 const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
 const file=files[url.pathname];if(!file)return send(res,404,{error:'页面不存在'});if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'不支持此操作'});const data=await readFile(new URL('./public/'+file[0],import.meta.url));res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){console.error('Request failed:',e.code||e.name);send(res,e.status||500,{error:e.status===413?'请求过大':'服务暂时不可用，请稍后重试'})}});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0');
process.on('SIGTERM',()=>{server.close(()=>pool.end().then(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref()});
