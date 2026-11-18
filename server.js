import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import {createHmac,scryptSync,timingSafeEqual,randomBytes} from "node:crypto";
import {mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";

const app=express();
app.set("trust proxy",1);
const port=Number(process.env.PORT||3000);
const origin=(process.env.SITE_ORIGIN||"").replace(/\/$/,"");
const password=process.env.ADMIN_PASSWORD||"";
const secret=process.env.SESSION_SECRET||"";
const salt=process.env.VISITOR_SALT||"";
const dbFile=process.env.DB_PATH||"/data/analytics.sqlite";
if(!origin.startsWith("https://")||password.length<16||secret.length<32||salt.length<32)throw Error("Missing secure analytics configuration");
mkdirSync(dirname(resolve(dbFile)),{recursive:true});
const db=new Database(dbFile);
db.pragma("journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts TEXT NOT NULL,visitor TEXT NOT NULL,session TEXT NOT NULL,type TEXT NOT NULL,path TEXT NOT NULL,referrer TEXT NOT NULL DEFAULT '',campaign TEXT NOT NULL DEFAULT '',device TEXT NOT NULL DEFAULT 'unknown',duration INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS events_ts ON events(ts);CREATE INDEX IF NOT EXISTS events_type_ts ON events(type,ts)");
const insert=db.prepare("INSERT INTO events(ts,visitor,session,type,path,referrer,campaign,device,duration) VALUES(?,?,?,?,?,?,?,?,?)");
const h=(v,key)=>createHmac("sha256",key).update(String(v)).digest("hex");
const hash=v=>h(v,salt).slice(0,24);
const allowed=new Set(["page_view","session_start","engaged","manual_select","assistant_open","assistant_generate","course_added","conflict_check","timetable_preview","questionnaire_click","questionnaire_confirm","export_attempt","export_success","export_blocked","app_error"]);
const short=(v,n=150)=>typeof v==="string"?v.slice(0,n):"";
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:"cross-origin"}}));
app.use(express.json({limit:"12kb",type:["application/json","text/plain"]}));
app.get("/health",(_,res)=>res.send("ok"));
app.get("/tracker.js",(_,res)=>res.type("application/javascript").set("Access-Control-Allow-Origin",origin).send(TRACKER));
app.get("/site-consent.js",(_,res)=>res.set("Cache-Control","no-store").type("application/javascript").sendFile(resolve("public/site-consent.js")));
app.get("/site-consent.css",(_,res)=>res.set("Cache-Control","no-store").type("text/css").sendFile(resolve("public/preview-consent.css")));
const cors=(req,res,next)=>{if(req.get("origin")!==origin)return res.sendStatus(403);res.set("Access-Control-Allow-Origin",origin);res.set("Vary","Origin");next()};
app.options("/api/track",cors,(_,res)=>res.set({"Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}).sendStatus(204));
app.post("/api/track",rateLimit({windowMs:60000,limit:120,standardHeaders:"draft-7",legacyHeaders:false}),cors,(req,res)=>{
 const x=req.body||{};
 if(!allowed.has(x.type)||! /^[a-zA-Z0-9_-]{12,80}$/.test(x.visitor||"")||! /^[a-zA-Z0-9_-]{12,80}$/.test(x.session||""))return res.sendStatus(400);
 const ua=req.get("user-agent")||"";
 const device=/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)?"tablet":/Mobile|iPhone|Android/i.test(ua)?"mobile":"desktop";
 insert.run(new Date().toISOString(),hash(x.visitor),hash(x.session),x.type,short(x.path,200).split("?")[0].split("#")[0],short(x.referrer,200),short(x.campaign,80),device,Math.min(3600000,Math.max(0,Number(x.duration)||0)));
 return res.sendStatus(204);
});
const passSalt=randomBytes(16),passHash=scryptSync(password,passSalt,64);
function validPass(v){if(typeof v!=="string"||v.length>256)return false;return timingSafeEqual(scryptSync(v,passSalt,64),passHash)}
function auth(req,res,next){
 const token=(req.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("admin_session="))?.slice(14)||"";
 const [expires,sig]=token.split(".");
 if(!/^\d{13}$/.test(expires||"")||!/^[0-9a-f]{64}$/.test(sig||"")||Number(expires)<Date.now()||!timingSafeEqual(Buffer.from(sig),Buffer.from(h(expires,secret))))return res.status(401).json({error:"unauthorized"});
 next();
}
app.post("/api/admin/login",rateLimit({windowMs:900000,limit:8,standardHeaders:"draft-7",legacyHeaders:false}),(req,res)=>{
 const requestOrigin=req.get("origin");if(requestOrigin&&requestOrigin!==`https://${req.get("host")}`)return res.sendStatus(403);
 if(!validPass(req.body?.password))return res.status(401).json({error:"invalid password"});
 const expires=String(Date.now()+28800000);
 res.cookie("admin_session",expires+"."+h(expires,secret),{httpOnly:true,secure:true,sameSite:"strict",maxAge:28800000,path:"/"});
 res.json({ok:true});
});
app.post("/api/admin/logout",auth,(req,res)=>{res.clearCookie("admin_session",{path:"/"}).json({ok:true})});
app.get("/api/admin/me",auth,(_,res)=>res.json({ok:true}));
const period=req=>new Date(Date.now()-Math.min(180,Math.max(1,Number(req.query.days)||7))*86400000).toISOString();
app.get("/api/admin/overview",auth,(req,res)=>{
 const since=period(req);
 const summary=db.prepare("SELECT COUNT(CASE WHEN type='page_view' THEN 1 END) views, COUNT(DISTINCT CASE WHEN type='page_view' THEN visitor END) visitors,COUNT(DISTINCT session) sessions,COUNT(CASE WHEN type='questionnaire_click' THEN 1 END) questionnaireClicks,COUNT(CASE WHEN type='export_success' THEN 1 END) exports,COUNT(CASE WHEN type='assistant_generate' THEN 1 END) recommendations,ROUND(COALESCE(AVG(CASE WHEN type='engaged' AND duration>0 THEN duration END),0)/1000) avgEngagedSeconds FROM events WHERE ts>=?").get(since);
 const daily=db.prepare("SELECT substr(ts,1,10) day,COUNT(CASE WHEN type='page_view' THEN 1 END) views,COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? GROUP BY substr(ts,1,10) ORDER BY day").all(since);
 const actions=db.prepare("SELECT type,COUNT(*) count FROM events WHERE ts>=? GROUP BY type ORDER BY count DESC").all(since);
 const devices=db.prepare("SELECT device,COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND type='page_view' GROUP BY device").all(since);
 const sources=db.prepare("SELECT CASE WHEN campaign!='' THEN '推广: '||campaign WHEN referrer='' THEN '直接访问或未知' ELSE referrer END source,COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND type='page_view' GROUP BY source ORDER BY visitors DESC LIMIT 15").all(since);
 const funnel=["page_view","manual_select","timetable_preview","questionnaire_click","export_success"].map(type=>({type,visitors:db.prepare("SELECT COUNT(DISTINCT visitor) n FROM events WHERE ts>=? AND type=?").get(since,type).n}));
 res.json({summary,daily,actions,devices,sources,funnel});
});
app.get("/api/admin/events",auth,(req,res)=>res.json({events:db.prepare("SELECT ts,visitor,session,type,path,device,duration FROM events WHERE ts>=? ORDER BY ts DESC LIMIT 150").all(period(req))}));
app.get("/api/admin/export.csv",auth,(req,res)=>{
 const rows=db.prepare("SELECT ts,visitor,session,type,path,referrer,campaign,device,duration FROM events WHERE ts>=? ORDER BY ts DESC LIMIT 10000").all(period(req));
 const cols=["ts","visitor","session","type","path","referrer","campaign","device","duration"];
 const cell=v=>'"'+String(v??"").replace(/^[=+@-]/,"'").replaceAll('"','""')+'"';
 res.set({"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=analytics.csv","cache-control":"no-store"}).send("\ufeff"+[cols.join(","),...rows.map(row=>cols.map(col=>cell(row[col])).join(","))].join("\r\n"));
});
app.get(["/","/admin"],(_,res)=>res.sendFile(resolve("public/admin.html")));
app.get("/admin.js",(_,res)=>res.sendFile(resolve("public/admin.js")));
app.get("/admin.css",(_,res)=>res.sendFile(resolve("public/admin.css")));
setInterval(()=>db.prepare("DELETE FROM events WHERE ts < ?").run(new Date(Date.now()-Math.min(730,Math.max(7,Number(process.env.RETENTION_DAYS)||180))*86400000).toISOString()),21600000).unref();
const TRACKER=`(()=>{let a=document.currentScript?.src;if(!a)return;let api=new URL('/api/track',a).href;let v;try{v=localStorage.getItem('course_analytics_v');if(!v){v=crypto.randomUUID();localStorage.setItem('course_analytics_v',v)}}catch{v=crypto.randomUUID()}let s=crypto.randomUUID();function track(type,extra={}){fetch(api,{method:'POST',mode:'cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({visitor:v,session:s,type,path:location.pathname,referrer:document.referrer.split('?')[0].slice(0,200),...extra}),keepalive:true,credentials:'omit'}).catch(()=>{})}window.CourseAnalytics={track};track('session_start');track('page_view');let t=Date.now();addEventListener('pagehide',()=>track('engaged',{duration:Date.now()-t}),{once:true});document.addEventListener('click',e=>{let el=e.target.closest?.('[data-analytics-event]');if(el)track(el.dataset.analyticsEvent)},true)})();`;
app.listen(port,"0.0.0.0",()=>console.log("Analytics listening on "+port));
