import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const app=express(),port=Number(process.env.PORT||4000);
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:false}:undefined}):null;
app.use(helmet());app.use(cors({origin:(process.env.CORS_ORIGIN||"http://localhost:5173").split(",").map(x=>x.trim()),methods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"],allowedHeaders:["Content-Type","Authorization"]}));app.use(express.json({limit:"15mb"}));
const uploadDirectory=path.resolve(process.cwd(),"uploads");
app.use("/uploads",(req,res,next)=>{res.setHeader("Cross-Origin-Resource-Policy","cross-origin");next()},express.static(uploadDirectory,{fallthrough:false,maxAge:"7d",immutable:true}));
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many login attempts. Try again in 15 minutes."}});
const DOMAINS=["AI","Cybersecurity","Healthcare","Web Development","App Development","Robotics","SpaceTech","Blockchain","IoT","Design","Management"];
function requireDb(_req,res,next){if(!pool)return res.status(503).json({error:"Database is not configured."});next()}
function requireAuth(req,res,next){const h=req.headers.authorization||"",t=h.startsWith("Bearer ")?h.slice(7):"";if(!t)return res.status(401).json({error:"Authentication required."});if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)return res.status(503).json({error:"Authentication is not configured."});try{req.auth=jwt.verify(t,process.env.JWT_SECRET,{issuer:"recruitflow-api",audience:"recruitflow-platform"});if(req.auth.role==="Organization Admin"&&req.path!=="/api/auth/me"&&!req.path.startsWith("/api/organization/"))return res.status(403).json({error:"This workspace feature is not enabled yet. Your organisation data remains protected."});next()}catch{return res.status(401).json({error:"Session expired. Please sign in again."})}}
function requireRole(...roles){return async(req,res,next)=>{try{if(!req.auth)return res.status(401).json({error:"Authentication required."});const q=await pool.query("SELECT u.active,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1",[req.auth.sub]);if(!q.rowCount||!q.rows[0].active)return res.status(401).json({error:"Account is unavailable."});req.auth.role=q.rows[0].role;if(!roles.includes(req.auth.role))return res.status(403).json({error:"Your current account role ("+req.auth.role+") is not permitted to perform this action."});next()}catch(e){console.error(e);res.status(500).json({error:"Could not verify account permissions."})}}}
function safeUser(r){return{id:r.id,username:r.username,email:r.email,displayName:r.display_name,role:r.role,active:r.active,createdAt:r.created_at}}

async function requirePlatformOwner(req,res,next){
 try{
  const q=await pool.query("SELECT 1 FROM platform_owners WHERE user_id=$1",[req.auth.sub]);
  if(!q.rowCount)return res.status(403).json({error:"Platform Owner access required."});
  next();
 }catch(e){console.error(e);res.status(500).json({error:"Could not verify Platform Owner access."})}
}

const organizationApplicationLimiter=rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many applications from this connection. Please try again later."}});
app.post("/api/public/organization-applications",requireDb,organizationApplicationLimiter,async(req,res)=>{
 const b=req.body||{};
 const name=String(b.name||"").trim(),type=String(b.type||"").trim(),contactName=String(b.contactName||"").trim(),email=String(b.email||"").trim().toLowerCase(),phone=String(b.phone||"").trim(),website=String(b.website||"").trim(),description=String(b.description||"").trim();
 const allowedTypes=["College","Company","Club","Other"];
 if(name.length<2||name.length>180||!allowedTypes.includes(type)||contactName.length<2||contactName.length>140||!/^\S+@\S+\.\S+$/.test(email)||phone.replace(/\D/g,"").length<8||phone.length>30||description.length>2000)return res.status(400).json({error:"Complete the required fields with valid contact details. Description must be under 2,000 characters."});
 if(website){try{const u=new URL(website);if(!["http:","https:"].includes(u.protocol)||website.length>300)throw new Error("invalid")}catch{return res.status(400).json({error:"Enter a valid website URL beginning with http:// or https://."})}}
 try{
  const duplicate=await pool.query("SELECT id,status FROM organization_applications WHERE lower(email)=lower($1) AND status='pending' LIMIT 1",[email]);
  if(duplicate.rowCount)return res.status(409).json({error:"An application from this email is already awaiting review."});
  const q=await pool.query("INSERT INTO organization_applications(name,organization_type,contact_name,email,phone,website,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at",[name,type,contactName,email,phone,website||null,description||null]);
  res.status(201).json({message:"Your organisation application has been submitted for review.",applicationId:q.rows[0].id,submittedAt:q.rows[0].created_at});
 }catch(e){console.error(e);res.status(500).json({error:"Could not submit your application. Please try again."})}
});
app.get("/api/platform/organization-applications",requireDb,requireAuth,requirePlatformOwner,async(req,res)=>{
 try{
  const status=String(req.query.status||"pending");
  if(!["pending","approved","rejected","all"].includes(status))return res.status(400).json({error:"Invalid application filter."});
  const q=await pool.query("SELECT id,name,organization_type,contact_name,email,phone,website,description,status,organization_id,reviewed_at,created_at FROM organization_applications WHERE ($1='all' OR status=$1) ORDER BY created_at DESC LIMIT 200",[status]);
  res.json({applications:q.rows});
 }catch(e){console.error(e);res.status(500).json({error:"Could not load organisation applications."})}
});
app.patch("/api/platform/organization-applications/:id",requireDb,requireAuth,requirePlatformOwner,async(req,res)=>{
 const decision=String(req.body?.decision||"");
 if(!["approve","reject"].includes(decision))return res.status(400).json({error:"Choose approve or reject."});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const a=await client.query("SELECT * FROM organization_applications WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!a.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Application not found."})}
  if(a.rows[0].status!=="pending"){await client.query("ROLLBACK");return res.status(409).json({error:"This application has already been reviewed."})}
  let organization=null;
  if(decision==="approve"){
   const base=a.rows[0].name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70)||"organization";
   const slug=base+"-"+String(a.rows[0].id).slice(0,8);
   const created=await client.query("INSERT INTO organizations(name,slug,status,branding) VALUES($1,$2,'active',$3::jsonb) RETURNING id,name,slug,status",[a.rows[0].name,slug,JSON.stringify({organizationType:a.rows[0].organization_type,contactName:a.rows[0].contact_name,contactEmail:a.rows[0].email,contactPhone:a.rows[0].phone,website:a.rows[0].website,description:a.rows[0].description})]);
   organization=created.rows[0];
  }
  const updated=await client.query("UPDATE organization_applications SET status=$2,organization_id=$3,reviewed_at=now(),reviewed_by=$4 WHERE id=$1 RETURNING id,status,organization_id,reviewed_at",[req.params.id,decision==="approve"?"approved":"rejected",organization?.id||null,req.auth.sub]);
  await client.query("COMMIT");
  res.json({application:updated.rows[0],organization,message:decision==="approve"?"Application approved. The organisation record has been created; workspace access will be enabled in a later onboarding phase.":"Application rejected."});
 }catch(e){await client.query("ROLLBACK");console.error(e);res.status(500).json({error:"Could not review organisation application."})}finally{client.release()}
});

const organizationInviteLimiter=rateLimit({windowMs:60*60*1000,limit:10,standardHeaders:"draft-8",legacyHeaders:false});
app.post("/api/platform/organizations/:id/invitations",requireDb,requireAuth,requirePlatformOwner,async(req,res)=>{
 const email=String(req.body?.email||"").trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Enter a valid administrator email."});
 try{const org=await pool.query("SELECT id,name,status FROM organizations WHERE id=$1",[req.params.id]);if(!org.rowCount)return res.status(404).json({error:"Organisation not found."});if(org.rows[0].status!=="active")return res.status(409).json({error:"Only active organisations can receive administrator invitations."});const raw=randomBytes(32).toString("hex"),hash=createHash("sha256").update(raw).digest("hex");await pool.query("INSERT INTO organization_admin_invitations(organization_id,email,token_hash,expires_at,created_by) VALUES($1,$2,$3,now()+interval '72 hours',$4)",[req.params.id,email,hash,req.auth.sub]);res.status(201).json({invitationUrl:(process.env.APP_ORIGIN||"http://localhost:5173")+"/?accept-organization-invite="+raw,expiresInHours:72,organization:org.rows[0].name})}catch(e){console.error(e);res.status(500).json({error:"Could not create administrator invitation."})}
});
app.post("/api/public/organization-invitations/accept",requireDb,organizationInviteLimiter,async(req,res)=>{
 const token=String(req.body?.token||""),username=String(req.body?.username||"").trim().toLowerCase(),displayName=String(req.body?.displayName||"").trim(),password=String(req.body?.password||"");
 if(!/^[a-f0-9]{64}$/.test(token)||!/^[a-z0-9._-]{3,30}$/.test(username)||displayName.length<2||displayName.length>140||password.length<12)return res.status(400).json({error:"Enter a valid username, full name and password of at least 12 characters."});
 const hash=createHash("sha256").update(token).digest("hex"),client=await pool.connect();
 try{await client.query("BEGIN");const inv=await client.query("SELECT i.*,o.name AS organization_name,o.status AS organization_status FROM organization_admin_invitations i JOIN organizations o ON o.id=i.organization_id WHERE i.token_hash=$1 FOR UPDATE",[hash]);if(!inv.rowCount||inv.rows[0].accepted_at||new Date(inv.rows[0].expires_at)<new Date()||inv.rows[0].organization_status!=="active"){await client.query("ROLLBACK");return res.status(400).json({error:"Invitation is invalid, expired, already used or organisation inactive."})}const role=await client.query("SELECT id FROM roles WHERE name='Organization Admin'");if(!role.rowCount)throw new Error("Organization Admin role is not configured.");const ph=await bcrypt.hash(password,12);const user=await client.query("INSERT INTO users(username,email,display_name,password_hash,role_id) VALUES($1,$2,$3,$4,$5) RETURNING id,username,email,display_name,active,created_at",[username,inv.rows[0].email,displayName,ph,role.rows[0].id]);const orgRole=await client.query("SELECT id FROM organization_roles WHERE organization_id=$1 AND role_key='organization_admin'",[inv.rows[0].organization_id]);if(!orgRole.rowCount)throw new Error("Organisation administrator role is missing.");await client.query("INSERT INTO organization_memberships(organization_id,user_id,organization_role_id,status) VALUES($1,$2,$3,'active')",[inv.rows[0].organization_id,user.rows[0].id,orgRole.rows[0].id]);await client.query("UPDATE organization_admin_invitations SET accepted_at=now() WHERE id=$1",[inv.rows[0].id]);await client.query("COMMIT");res.status(201).json({message:"Administrator account created. Sign in to continue.",organization:inv.rows[0].organization_name,user:{...user.rows[0],role:"Organization Admin"}})}catch(e){await client.query("ROLLBACK");if(e.code==="23505")return res.status(409).json({error:"That username or email already has an account."});console.error(e);res.status(500).json({error:"Could not activate administrator account."})}finally{client.release()}
});


app.post("/api/organization/logo",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 const dataUrl=String(req.body?.imageData||"");
 const match=dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/);
 if(!match)return res.status(400).json({error:"Choose a PNG, JPG or WEBP image."});
 const buffer=Buffer.from(match[2],"base64");
 if(!buffer.length||buffer.length>10*1024*1024)return res.status(413).json({error:"Logo image must be 10 MB or smaller."});
 const signatures={png:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),jpeg:Buffer.from([0xff,0xd8,0xff]),webp:Buffer.from("RIFF")};
 const ext=match[1],sig=signatures[ext];
 if(ext==="webp"?(buffer.length<12||!buffer.subarray(0,4).equals(sig)||buffer.toString("ascii",8,12)!=="WEBP"):!buffer.subarray(0,sig.length).equals(sig))return res.status(400).json({error:"The image file contents do not match its format."});
 try{
  const member=await pool.query("SELECT o.id FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active' LIMIT 1",[req.auth.sub]);
  if(!member.rowCount)return res.status(403).json({error:"Active organisation membership is required."});
  await mkdir(uploadDirectory,{recursive:true});
  const filename=randomUUID()+"."+({png:"png",jpeg:"jpg",webp:"webp"}[ext]);
  await writeFile(path.join(uploadDirectory,filename),buffer,{flag:"wx"});
  const logoUrl="/uploads/"+filename;
  const updated=await pool.query("UPDATE organizations SET logo_url=$2,updated_at=now() WHERE id=$1 RETURNING logo_url",[member.rows[0].id,logoUrl]);
  res.status(201).json({logoUrl:updated.rows[0].logo_url,message:"Organisation logo uploaded."});
 }catch(e){console.error(e);res.status(500).json({error:"Could not upload organisation logo."})}
});

app.patch("/api/organization/settings",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 const b=req.body||{},name=String(b.name||"").trim(),logoUrl=String(b.logoUrl||"").trim(),primaryColor=String(b.primaryColor||"").trim(),secondaryColor=String(b.secondaryColor||"").trim();
 const welcomeMessage=String(b.welcomeMessage||"").trim(),footerText=String(b.footerText||"").trim(),contactEmail=String(b.contactEmail||"").trim().toLowerCase(),contactPhone=String(b.contactPhone||"").trim(),website=String(b.website||"").trim();
 if(name.length<2||name.length>180)return res.status(400).json({error:"Organisation name must be between 2 and 180 characters."});
 for(const [label,color] of [["Primary",primaryColor],["Secondary",secondaryColor]])if(!/^#[0-9a-fA-F]{6}$/.test(color))return res.status(400).json({error:label+" colour must be a six-digit HEX value."});
 if(logoUrl&&!logoUrl.startsWith("/uploads/")){try{const u=new URL(logoUrl);if(!["http:","https:"].includes(u.protocol)||logoUrl.length>500)throw new Error("invalid")}catch{return res.status(400).json({error:"Enter a valid logo URL or upload a logo image."})}}if(website){try{const u=new URL(website);if(!["http:","https:"].includes(u.protocol)||website.length>500)throw new Error("invalid")}catch{return res.status(400).json({error:"Enter a valid website URL beginning with http:// or https://."})}}
 if(welcomeMessage.length>500||footerText.length>240||contactEmail.length>254||contactPhone.length>30)return res.status(400).json({error:"One or more branding fields exceed the allowed length."});
 if(contactEmail&&!/^\S+@\S+\.\S+$/.test(contactEmail))return res.status(400).json({error:"Enter a valid contact email."});
 if(website&&logoUrl&&website===logoUrl)return res.status(400).json({error:"Website and logo URL must be different."});
 try{
  const q=await pool.query("UPDATE organizations o SET name=$2,logo_url=NULLIF($3,''),primary_color=$4,secondary_color=$5,branding=COALESCE(o.branding,'{}'::jsonb)||$6::jsonb,updated_at=now() FROM organization_memberships m WHERE o.id=m.organization_id AND m.user_id=$1 AND m.status='active' AND o.status='active' RETURNING o.id,o.name,o.slug,o.status,o.logo_url,o.primary_color,o.secondary_color,o.branding,o.created_at",[req.auth.sub,name,logoUrl,primaryColor,secondaryColor,JSON.stringify({welcomeMessage,footerText,contactEmail,contactPhone,website})]);
  if(!q.rowCount)return res.status(403).json({error:"Active organisation membership is required."});
  res.json({organization:q.rows[0],message:"Organisation branding saved."});
 }catch(e){console.error(e);res.status(500).json({error:"Could not save organisation settings."})}
});


async function activeOrganizationForUser(userId){
 const q=await pool.query("SELECT o.id,o.name,o.slug,o.status FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active' LIMIT 1",[userId]);
 return q.rows[0]||null;
}
function validateEventConfig(body){
 const name=String(body?.name||"").trim(),slug=String(body?.slug||"").trim().toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-|-$/g,""),description=String(body?.description||"").trim();
 if(name.length<3||name.length>180||slug.length<3||slug.length>90||description.length>2000)throw new Error("Enter an event name, valid URL slug and description under 2,000 characters.");
 const domains=Array.isArray(body?.domains)?body.domains:[];
 if(!domains.length||domains.length>30)throw new Error("Add between 1 and 30 interview domains.");
 const cleanDomains=[],seen=new Set();
 for(const item of domains){
  const domainName=String(item?.name||"").trim(),key=domainName.toLowerCase();
  if(domainName.length<2||domainName.length>100||seen.has(key))throw new Error("Domain names must be unique and between 2 and 100 characters.");
  seen.add(key);
  const panels=Array.isArray(item?.panels)?item.panels:[domainName+" Panel"],cleanPanels=[],panelSeen=new Set();
  if(!panels.length||panels.length>15)throw new Error("Each domain needs between 1 and 15 panels.");
  for(const raw of panels){const p=String(raw||"").trim(),pk=p.toLowerCase();if(p.length<2||p.length>120||panelSeen.has(pk))throw new Error("Panel names must be unique within a domain and between 2 and 120 characters.");panelSeen.add(pk);cleanPanels.push(p)}
  cleanDomains.push({name:domainName,panels:cleanPanels});
 }
 const allowedTypes=["text","email","phone","number","textarea","select","checkbox"];
 const fields=Array.isArray(body?.registrationFields)?body.registrationFields:[];
 if(fields.length>30)throw new Error("You can add up to 30 custom registration fields.");
 const cleanFields=[],fieldKeys=new Set();
 for(const f of fields){const label=String(f?.label||"").trim(),key=String(f?.key||label.toLowerCase().replace(/[^a-z0-9]+/g,"_")).trim().toLowerCase(),type=String(f?.type||"text");if(label.length<2||label.length>100||!/^[a-z][a-z0-9_]{0,49}$/.test(key)||fieldKeys.has(key)||!allowedTypes.includes(type))throw new Error("Custom registration fields need a valid unique key, label and supported field type.");fieldKeys.add(key);const options=Array.isArray(f?.options)?f.options.map(x=>String(x).trim()).filter(Boolean).slice(0,20):[];if(type==="select"&&(!options.length||options.some(x=>x.length>100)))throw new Error("Select fields need 1–20 options of at most 100 characters.");cleanFields.push({key,label,type,required:Boolean(f?.required),options})}
 return {name,slug,description,domains:cleanDomains,registrationFields:cleanFields,startsAt:body?.startsAt||null,endsAt:body?.endsAt||null};
}
app.get("/api/organization/events",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 try{const org=await activeOrganizationForUser(req.auth.sub);if(!org)return res.status(403).json({error:"Active organisation membership is required."});const q=await pool.query("SELECT e.id,e.name,e.slug,e.description,e.status,e.starts_at,e.ends_at,e.registration_fields,e.created_at,(SELECT count(*)::int FROM candidates c WHERE c.event_id=e.id) AS candidate_count,(SELECT count(*)::int FROM domains d WHERE d.event_id=e.id AND d.active=true) AS domain_count,(SELECT count(*)::int FROM panels p WHERE p.event_id=e.id AND p.active=true) AS panel_count FROM recruitment_events e WHERE e.organization_id=$1 ORDER BY e.created_at DESC",[org.id]);res.json({events:q.rows,organization:org})}catch(e){console.error(e);res.status(500).json({error:"Could not load organisation events."})}
});
app.post("/api/organization/events",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 let cfg;try{cfg=validateEventConfig(req.body)}catch(e){return res.status(400).json({error:e.message})}
 if(cfg.startsAt&&cfg.endsAt&&new Date(cfg.endsAt)<=new Date(cfg.startsAt))return res.status(400).json({error:"End date must be after start date."});
 const duplicateSlug=await pool.query("SELECT id FROM recruitment_events WHERE lower(slug)=lower($1) LIMIT 1",[cfg.slug]);if(duplicateSlug.rowCount)return res.status(409).json({error:"The URL slug \""+cfg.slug+"\" is already used by an existing event (including legacy events). Choose a completely different slug."});
 const client=await pool.connect();
 try{await client.query("BEGIN");const org=await client.query("SELECT o.id FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active' FOR UPDATE OF o",[req.auth.sub]);if(!org.rowCount){await client.query("ROLLBACK");return res.status(403).json({error:"Active organisation membership is required."})}
 const event=await client.query("INSERT INTO recruitment_events(organization_id,name,slug,description,status,starts_at,ends_at,registration_fields) VALUES($1,$2,$3,$4,'draft',$5,$6,$7::jsonb) RETURNING id,name,slug,description,status,starts_at,ends_at,registration_fields,created_at",[org.rows[0].id,cfg.name,cfg.slug,cfg.description,cfg.startsAt,cfg.endsAt,JSON.stringify(cfg.registrationFields)]);
 for(const d of cfg.domains){const domain=await client.query("INSERT INTO domains(event_id,name) VALUES($1,$2) RETURNING id,name",[event.rows[0].id,d.name]);for(const panelName of d.panels)await client.query("INSERT INTO panels(event_id,domain_id,name) VALUES($1,$2,$3)",[event.rows[0].id,domain.rows[0].id,panelName])}
 await client.query("COMMIT");res.status(201).json({event:event.rows[0],domains:cfg.domains});
 }catch(e){await client.query("ROLLBACK");if(e.code==="23505"){console.error("Recruitment event unique constraint:",e.constraint,e.detail);return res.status(409).json({error:e.constraint?.toLowerCase().includes("slug")?"That event URL slug is already in use. Choose another.":"A domain or panel with a conflicting name already exists for this event. Check the domain and panel names, then try again."})}console.error(e);res.status(500).json({error:"Could not create recruitment event."})}finally{client.release()}
});
app.get("/api/organization/events/:id/config",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 try{const org=await activeOrganizationForUser(req.auth.sub);if(!org)return res.status(403).json({error:"Active organisation membership is required."});const e=await pool.query("SELECT id,name,slug,description,status,starts_at,ends_at,registration_fields FROM recruitment_events WHERE id=$1 AND organization_id=$2",[req.params.id,org.id]);if(!e.rowCount)return res.status(404).json({error:"Event not found in this organisation."});const d=await pool.query("SELECT d.id,d.name,COALESCE(json_agg(json_build_object('id',p.id,'name',p.name,'active',p.active)) FILTER(WHERE p.id IS NOT NULL),'[]'::json) AS panels FROM domains d LEFT JOIN panels p ON p.domain_id=d.id AND p.event_id=d.event_id WHERE d.event_id=$1 GROUP BY d.id ORDER BY d.name",[req.params.id]);res.json({event:e.rows[0],domains:d.rows})}catch(e){console.error(e);res.status(500).json({error:"Could not load event configuration."})}
});
app.patch("/api/organization/events/:id/config",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 let cfg;try{cfg=validateEventConfig(req.body)}catch(e){return res.status(400).json({error:e.message})}
 if(cfg.startsAt&&cfg.endsAt&&new Date(cfg.endsAt)<=new Date(cfg.startsAt))return res.status(400).json({error:"End date must be after start date."});
 const client=await pool.connect();
 try{await client.query("BEGIN");const org=await client.query("SELECT o.id FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active' LIMIT 1",[req.auth.sub]);if(!org.rowCount){await client.query("ROLLBACK");return res.status(403).json({error:"Active organisation membership is required."})}
 const current=await client.query("SELECT id FROM recruitment_events WHERE id=$1 AND organization_id=$2 FOR UPDATE",[req.params.id,org.rows[0].id]);if(!current.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Event not found in this organisation."})}
 const counts=await client.query("SELECT (SELECT count(*) FROM candidates WHERE event_id=$1)::int AS candidates,(SELECT count(*) FROM interviews i JOIN candidates c ON c.id=i.candidate_id WHERE c.event_id=$1)::int AS interviews",[req.params.id]);if(counts.rows[0].candidates||counts.rows[0].interviews){await client.query("ROLLBACK");return res.status(409).json({error:"Event structure is locked after candidate registration or interviews begin. You can still update event details and registration fields before registrations."})}
 const updated=await client.query("UPDATE recruitment_events SET name=$2,slug=$3,description=$4,starts_at=$5,ends_at=$6,registration_fields=$7::jsonb,updated_at=now() WHERE id=$1 RETURNING id,name,slug,description,status,starts_at,ends_at,registration_fields",[req.params.id,cfg.name,cfg.slug,cfg.description,cfg.startsAt,cfg.endsAt,JSON.stringify(cfg.registrationFields)]);
 await client.query("DELETE FROM panel_assignments WHERE panel_id IN (SELECT id FROM panels WHERE event_id=$1)",[req.params.id]);await client.query("DELETE FROM panels WHERE event_id=$1",[req.params.id]);await client.query("DELETE FROM domains WHERE event_id=$1",[req.params.id]);
 for(const d of cfg.domains){const domain=await client.query("INSERT INTO domains(event_id,name) VALUES($1,$2) RETURNING id",[req.params.id,d.name]);for(const panelName of d.panels)await client.query("INSERT INTO panels(event_id,domain_id,name) VALUES($1,$2,$3)",[req.params.id,domain.rows[0].id,panelName])}
 await client.query("COMMIT");res.json({event:updated.rows[0],message:"Event configuration saved."});
 }catch(e){await client.query("ROLLBACK");if(e.code==="23505")return res.status(409).json({error:"That event slug is already in use or names are duplicated."});console.error(e);res.status(500).json({error:"Could not save event configuration."})}finally{client.release()}
});
app.patch("/api/organization/events/:id/status",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 const status=String(req.body?.status||"");if(!["draft","open","live","completed","archived"].includes(status))return res.status(400).json({error:"Invalid event status."});
 try{const org=await activeOrganizationForUser(req.auth.sub);if(!org)return res.status(403).json({error:"Active organisation membership is required."});const q=await pool.query("UPDATE recruitment_events SET status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,name,slug,status",[req.params.id,org.id,status]);if(!q.rowCount)return res.status(404).json({error:"Event not found in this organisation."});res.json({event:q.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not update event status."})}
});

app.get("/api/organization/workspace",requireDb,requireAuth,async(req,res)=>{
 if(req.auth.role!=="Organization Admin")return res.status(403).json({error:"Organisation administrator access required."});
 try{const q=await pool.query("SELECT o.id,o.name,o.slug,o.status,o.logo_url,o.primary_color,o.secondary_color,o.branding,o.created_at,(SELECT count(*)::int FROM recruitment_events e WHERE e.organization_id=o.id) AS events,(SELECT count(*)::int FROM organization_memberships m WHERE m.organization_id=o.id AND m.status='active') AS staff,(SELECT count(*)::int FROM recruitment_events e JOIN candidates c ON c.event_id=e.id WHERE e.organization_id=o.id) AS candidates FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active' LIMIT 1",[req.auth.sub]);if(!q.rowCount)return res.status(403).json({error:"Organisation membership is inactive."});res.json({organization:q.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not load organisation workspace."})}
});
app.get("/api/platform/overview",requireDb,requireAuth,requirePlatformOwner,async(_req,res)=>{
 try{
  const [orgs,events,users,candidates,pending]=await Promise.all([
   pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status='active')::int AS active,count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='suspended')::int AS suspended FROM organizations"),
   pool.query("SELECT count(*)::int AS total FROM recruitment_events"),
   pool.query("SELECT count(*)::int AS total FROM users"),
   pool.query("SELECT count(*)::int AS total FROM candidates"),
   pool.query("SELECT id,name,slug,status,created_at FROM organizations WHERE status='pending' ORDER BY created_at ASC LIMIT 10")
  ]);
  res.json({organizations:orgs.rows[0],events:events.rows[0].total,users:users.rows[0].total,candidates:candidates.rows[0].total,pendingOrganizations:pending.rows});
 }catch(e){console.error(e);res.status(500).json({error:"Could not load platform overview."})}
});
app.get("/api/platform/organizations",requireDb,requireAuth,requirePlatformOwner,async(_req,res)=>{
 try{
  const q=await pool.query("SELECT o.id,o.name,o.slug,o.status,o.logo_url,o.primary_color,o.secondary_color,o.created_at,(SELECT count(*)::int FROM recruitment_events e WHERE e.organization_id=o.id) AS events,(SELECT count(*)::int FROM organization_memberships m WHERE m.organization_id=o.id AND m.status='active') AS staff,(SELECT count(*)::int FROM candidates c JOIN recruitment_events e ON e.id=c.event_id WHERE e.organization_id=o.id) AS candidates FROM organizations o ORDER BY o.created_at ASC");
  res.json({organizations:q.rows});
 }catch(e){console.error(e);res.status(500).json({error:"Could not load organisations."})}
});
app.patch("/api/platform/organizations/:id/status",requireDb,requireAuth,requirePlatformOwner,async(req,res)=>{
 const status=String(req.body?.status||"");
 if(!["pending","active","suspended"].includes(status))return res.status(400).json({error:"Invalid organisation status."});
 try{
  const q=await pool.query("UPDATE organizations SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,name,slug,status",[req.params.id,status]);
  if(!q.rowCount)return res.status(404).json({error:"Organisation not found."});
  res.json({organization:q.rows[0]});
 }catch(e){console.error(e);res.status(500).json({error:"Could not update organisation status."})}
});

const admin=["Super Admin","Admin"];
app.get("/api/health",async(_req,res)=>{let database="not_configured";if(pool){try{await pool.query("SELECT 1");database="connected"}catch{database="disconnected"}}res.json({ok:true,service:"recruitflow-api",version:"0.7.0",database,authentication:Boolean(process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32),now:new Date().toISOString()})});
app.get("/api",(_req,res)=>res.json({name:"RecruitFlow API",version:"0.7.0",status:"Automatic panel dispatch"}));
app.post("/api/auth/login",loginLimiter,requireDb,async(req,res)=>{try{const identity=String(req.body?.identity||"").trim().toLowerCase(),password=String(req.body?.password||"");if(!identity||!password)return res.status(400).json({error:"Enter your username or email and password."});if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)return res.status(503).json({error:"Authentication is not configured. Set JWT_SECRET in backend/.env."});const q=await pool.query("SELECT u.id,u.username,u.email,u.display_name,u.password_hash,u.active,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.username)=$1 OR lower(u.email)=$1 LIMIT 1",[identity]);const u=q.rows[0];if(!u||!u.active||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Invalid credentials or inactive account."});await pool.query("UPDATE users SET last_login_at=now() WHERE id=$1",[u.id]);const token=jwt.sign({sub:u.id,role:u.role,username:u.username},process.env.JWT_SECRET,{expiresIn:"8h",issuer:"recruitflow-api",audience:"recruitflow-platform"});const owner=await pool.query("SELECT 1 FROM platform_owners WHERE user_id=$1",[u.id]);res.json({token,user:{...safeUser(u),role:owner.rowCount?"Platform Owner":u.role},expiresIn:28800})}catch(e){console.error(e);res.status(500).json({error:"Unable to sign in right now."})}});
app.get("/api/auth/me",requireDb,requireAuth,async(req,res)=>{try{const q=await pool.query("SELECT u.id,u.username,u.email,u.display_name,u.active,rl.name AS role,u.created_at FROM users u JOIN roles rl ON rl.id=u.role_id WHERE u.id=$1",[req.auth.sub]);if(!q.rowCount||!q.rows[0].active)return res.status(401).json({error:"Account is unavailable."});const owner=await pool.query("SELECT 1 FROM platform_owners WHERE user_id=$1",[req.auth.sub]);res.json({user:{...safeUser(q.rows[0]),role:owner.rowCount?"Platform Owner":q.rows[0].role}})}catch(e){console.error(e);res.status(500).json({error:"Could not load account."})}});
app.get("/api/auth/users",requireDb,requireAuth,requireRole(...admin),async(_req,res)=>{try{const q=await pool.query("SELECT u.id,u.username,u.email,u.display_name,u.active,rl.name AS role,u.created_at FROM users u JOIN roles rl ON rl.id=u.role_id ORDER BY u.created_at DESC");res.json({users:q.rows.map(safeUser)})}catch(e){console.error(e);res.status(500).json({error:"Could not load users."})}});
app.post("/api/auth/users",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{const username=String(req.body?.username||"").trim().toLowerCase(),email=String(req.body?.email||"").trim().toLowerCase(),displayName=String(req.body?.displayName||"").trim(),password=String(req.body?.password||""),role=String(req.body?.role||"");const allowed=["Admin","Registration Volunteer","Entry Volunteer","W1 Volunteer","W2 Volunteer","Interviewer"];if(!/^[a-z0-9._-]{3,30}$/.test(username))return res.status(400).json({error:"Username must be 3–30 characters (letters, numbers, dot, underscore or hyphen)."});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Enter a valid email address."});if(!displayName||password.length<12)return res.status(400).json({error:"Display name is required and password must contain at least 12 characters."});if(!allowed.includes(role))return res.status(400).json({error:"Choose a permitted staff role."});try{const hash=await bcrypt.hash(password,12);const q=await pool.query("INSERT INTO users(username,email,display_name,password_hash,role_id) SELECT $1,$2,$3,$4,id FROM roles WHERE name=$5 RETURNING id,username,email,display_name,active,created_at,(SELECT name FROM roles WHERE id=users.role_id) AS role",[username,email,displayName,hash,role]);if(!q.rowCount)return res.status(400).json({error:"Selected role does not exist."});res.status(201).json({user:safeUser(q.rows[0])})}catch(e){if(e.code==="23505")return res.status(409).json({error:"That username or email is already registered."});console.error(e);res.status(500).json({error:"Could not create account."})}});
app.patch("/api/auth/users/:id",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{const {active,role}=req.body||{};if(typeof active!=="boolean"&&typeof role!=="string")return res.status(400).json({error:"Provide an active status or role."});if(req.params.id===req.auth.sub&&active===false)return res.status(400).json({error:"You cannot deactivate your own signed-in account."});const allowed=["Admin","Registration Volunteer","Entry Volunteer","W1 Volunteer","W2 Volunteer","Interviewer"];if(role&&!allowed.includes(role))return res.status(400).json({error:"Invalid staff role."});if(role==="Admin"&&req.auth.role!=="Super Admin")return res.status(403).json({error:"Only a Super Admin can grant Admin access."});try{const q=await pool.query("UPDATE users u SET active=COALESCE($2,u.active),role_id=COALESCE((SELECT id FROM roles WHERE name=$3),u.role_id) WHERE u.id=$1 AND NOT (u.username='admin' AND $2=false) RETURNING u.id,u.username,u.email,u.display_name,u.active,u.created_at,(SELECT name FROM roles WHERE id=u.role_id) AS role",[req.params.id,typeof active==="boolean"?active:null,role||null]);if(!q.rowCount)return res.status(404).json({error:"User not found or protected primary account."});res.json({user:safeUser(q.rows[0])})}catch(e){console.error(e);res.status(500).json({error:"Could not update account."})}});
app.get("/api/events",requireDb,requireAuth,async(_req,res)=>{try{const q=await pool.query("SELECT e.id,e.name,e.slug,e.status,e.starts_at,e.ends_at,e.created_at,(SELECT count(*)::int FROM candidates c WHERE c.event_id=e.id) AS candidate_count,(SELECT count(*)::int FROM panels p WHERE p.event_id=e.id) AS panel_count FROM recruitment_events e ORDER BY e.created_at DESC");res.json({events:q.rows})}catch(e){console.error(e);res.status(500).json({error:"Could not load events."})}});
app.post("/api/events",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{const name=String(req.body?.name||"").trim(),slug=String(req.body?.slug||"").trim().toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-|-$/g,""),startsAt=req.body?.startsAt||null,endsAt=req.body?.endsAt||null;if(name.length<3||name.length>180||slug.length<3)return res.status(400).json({error:"Enter an event name (3–180 characters) and a valid event slug."});if(startsAt&&endsAt&&new Date(endsAt)<=new Date(startsAt))return res.status(400).json({error:"End date must be after the start date."});const client=await pool.connect();try{await client.query("BEGIN");const q=await client.query("INSERT INTO recruitment_events(name,slug,status,starts_at,ends_at) VALUES($1,$2,'draft',$3,$4) RETURNING *",[name,slug,startsAt,endsAt]);const event=q.rows[0];for(const domain of DOMAINS){const d=await client.query("INSERT INTO domains(event_id,name) VALUES($1,$2) RETURNING id",[event.id,domain]);await client.query("INSERT INTO panels(event_id,domain_id,name) VALUES($1,$2,$3)",[event.id,d.rows[0].id,domain+" Panel"])}const role=await client.query("SELECT role_id FROM users WHERE id=$1",[req.auth.sub]);if(role.rowCount)await client.query("INSERT INTO event_users(event_id,user_id,assigned_role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[event.id,req.auth.sub,role.rows[0].role_id]);await client.query("COMMIT");res.status(201).json({event:{...event,panel_count:DOMAINS.length,candidate_count:0},domains:DOMAINS})}catch(e){await client.query("ROLLBACK");if(e.code==="23505")return res.status(409).json({error:"An event with that slug already exists."});console.error(e);res.status(500).json({error:"Could not create event."})}finally{client.release()}});
app.patch("/api/events/:id/status",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{const status=String(req.body?.status||"");if(!["draft","open","live","completed","archived"].includes(status))return res.status(400).json({error:"Invalid event status."});try{const q=await pool.query("UPDATE recruitment_events SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,name,slug,status,starts_at,ends_at",[req.params.id,status]);if(!q.rowCount)return res.status(404).json({error:"Event not found."});res.json({event:q.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not update event."})}});
app.get("/api/events/:id/team",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{try{const q=await pool.query("SELECT u.id,u.username,u.email,u.display_name,u.active,r.name AS role FROM event_users eu JOIN users u ON u.id=eu.user_id JOIN roles r ON r.id=eu.assigned_role_id WHERE eu.event_id=$1 ORDER BY u.display_name",[req.params.id]);res.json({team:q.rows.map(safeUser)})}catch(e){console.error(e);res.status(500).json({error:"Could not load event team."})}});
app.post("/api/events/:id/team",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{const userId=String(req.body?.userId||""),role=String(req.body?.role||"");const allowed=["Admin","Registration Volunteer","Entry Volunteer","W1 Volunteer","W2 Volunteer","Interviewer"];if(!allowed.includes(role))return res.status(400).json({error:"Choose a valid event role."});try{const exists=await pool.query("SELECT id FROM recruitment_events WHERE id=$1",[req.params.id]);if(!exists.rowCount)return res.status(404).json({error:"Event not found."});const q=await pool.query("INSERT INTO event_users(event_id,user_id,assigned_role_id) SELECT $1,u.id,r.id FROM users u JOIN roles r ON r.name=$3 WHERE u.id=$2 AND u.active ON CONFLICT(event_id,user_id) DO UPDATE SET assigned_role_id=EXCLUDED.assigned_role_id RETURNING user_id",[req.params.id,userId,role]);if(!q.rowCount)return res.status(400).json({error:"Active user or role not found."});res.status(201).json({message:"Team member assigned to event."})}catch(e){console.error(e);res.status(500).json({error:"Could not assign team member."})}});
app.delete("/api/events/:id/team/:userId",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{try{await pool.query("DELETE FROM event_users WHERE event_id=$1 AND user_id=$2",[req.params.id,req.params.userId]);res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"Could not remove team member."})}});
app.get("/api/events/:id/panels",requireDb,requireAuth,async(req,res)=>{try{const q=await pool.query("SELECT p.id,p.name,p.status,p.active,d.name AS domain,(SELECT json_agg(json_build_object('id',u.id,'name',u.display_name,'username',u.username)) FROM panel_assignments pa JOIN users u ON u.id=pa.interviewer_id WHERE pa.panel_id=p.id AND pa.active=true) AS interviewers FROM panels p JOIN domains d ON d.id=p.domain_id WHERE p.event_id=$1 ORDER BY d.name",[req.params.id]);res.json({panels:q.rows})}catch(e){console.error(e);res.status(500).json({error:"Could not load panels."})}});
app.put("/api/events/:id/panels/:panelId/assignment",requireDb,requireAuth,requireRole(...admin),async(req,res)=>{
 const interviewerId=String(req.body?.interviewerId||"");
 if(!interviewerId)return res.status(400).json({error:"Choose an interviewer."});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const panel=await client.query("SELECT id FROM panels WHERE id=$1 AND event_id=$2 AND active=true",[req.params.panelId,req.params.id]);
  if(!panel.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active panel not found in this event."})}
  const person=await client.query("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.active=true AND r.name='Interviewer'",[interviewerId]);
  if(!person.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Choose an active user with the Interviewer role."})}
  const busy=await client.query("SELECT 1 FROM interviews WHERE panel_id=$1 AND status='in_progress' LIMIT 1",[req.params.panelId]);
  if(busy.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:"This panel has an interview in progress. Try again after it is completed."})}
  const current=await client.query("SELECT pa.panel_id,p.name FROM panel_assignments pa JOIN panels p ON p.id=pa.panel_id WHERE pa.interviewer_id=$1 AND pa.active=true AND p.event_id=$2 FOR UPDATE",[interviewerId,req.params.id]);
  if(current.rows.some(x=>x.panel_id===req.params.panelId)){await client.query("COMMIT");return res.json({ok:true,message:"This interviewer is already assigned to this panel."})}
  if(current.rowCount){
   const oldPanelIds=current.rows.map(x=>x.panel_id);
   await client.query("UPDATE candidates c SET status=CASE WHEN pc.volunteer_role='W1 Volunteer' THEN 'waiting_1' ELSE 'waiting_2' END FROM panel_calls pc WHERE pc.candidate_id=c.id AND pc.panel_id=ANY($1::uuid[]) AND pc.status IN ('pending','sent') AND c.status='called_to_panel'",[oldPanelIds]);
   await client.query("UPDATE panel_calls SET status='cancelled' WHERE panel_id=ANY($1::uuid[]) AND status IN ('pending','sent')",[oldPanelIds]);
   await client.query("UPDATE panel_assignments SET active=false WHERE interviewer_id=$1 AND panel_id=ANY($2::uuid[]) AND active=true",[interviewerId,oldPanelIds]);
  }
  await client.query("INSERT INTO panel_assignments(panel_id,interviewer_id,active) VALUES($1,$2,true)",[req.params.panelId,interviewerId]);
  await client.query("INSERT INTO audit_logs(event_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'interviewer_panel_assigned','panel',$3,$4::jsonb)",[req.params.id,req.auth.sub,req.params.panelId,JSON.stringify({interviewerId,previousPanels:current.rows.map(x=>x.name)})]);
  await client.query("COMMIT");
  await dispatchNextForEvent(req.params.id);
  res.json({ok:true,message:"Interviewer assigned. A panel can now have multiple interviewers; this interviewer is assigned to only one panel in this event."});
 }catch(e){await client.query("ROLLBACK");console.error("Panel assignment failed:",e);res.status(500).json({error:"Could not assign interviewer: "+(e.code||"database error")})}finally{client.release()}
});

const registrationRoles=["Super Admin","Admin","Registration Volunteer"];

app.get("/api/public/events/:slug",requireDb,async(req,res)=>{
 try{
  const e=await pool.query("SELECT e.id,e.name,e.slug,e.description,e.registration_fields,o.name AS organization_name,o.logo_url,o.primary_color,o.secondary_color,o.branding FROM recruitment_events e JOIN organizations o ON o.id=e.organization_id WHERE e.slug=$1 AND e.status IN ('open','live') AND o.status='active'",[String(req.params.slug).toLowerCase()]);
  if(!e.rowCount)return res.status(404).json({error:"Registration is not available for this event."});
  const d=await pool.query("SELECT id,name FROM domains WHERE event_id=$1 AND active=true ORDER BY name",[e.rows[0].id]);
  const row=e.rows[0];res.json({event:{id:row.id,name:row.name,slug:row.slug,description:row.description,registrationFields:row.registration_fields||[],organization:{name:row.organization_name,logoUrl:row.logo_url,primaryColor:row.primary_color,secondaryColor:row.secondary_color,branding:row.branding||{}}},domains:d.rows});
 }catch(err){console.error(err);res.status(500).json({error:"Could not load registration details."})}
});
app.post("/api/public/events/:slug/candidates",requireDb,async(req,res)=>{
 const b=req.body||{},name=String(b.name||"").trim(),email=String(b.email||"").trim().toLowerCase(),phone=String(b.phone||"").trim().replace(/[\s()-]/g,""),college=String(b.college||"").trim(),branch=String(b.branch||"").trim(),academicYear=String(b.academicYear||"").trim(),rollNumber=String(b.rollNumber||"").trim(),skills=String(b.skills||"").trim(),githubUrl=String(b.githubUrl||"").trim(),linkedinUrl=String(b.linkedinUrl||"").trim(),portfolioUrl=String(b.portfolioUrl||"").trim(),motivation=String(b.motivation||"").trim(),preferences=Array.isArray(b.preferences)?b.preferences.slice(0,4):[];
 if(name.length<2||name.length>160||!/^\\S+@\\S+\\.\\S+$/.test(email)||phone.length<8||phone.length>20||!college||!branch||!academicYear)return res.status(400).json({error:"Complete all required personal and academic details with a valid email and phone number."});
 if(preferences.length<1||new Set(preferences).size!==preferences.length)return res.status(400).json({error:"Choose between 1 and 4 different domain preferences in priority order."});
 for(const url of [githubUrl,linkedinUrl,portfolioUrl])if(url){try{const parsed=new URL(url);if(parsed.protocol!=="https:"||url.length>500)throw new Error("invalid")}catch{return res.status(400).json({error:"Portfolio links must be valid HTTPS URLs."})}}
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const ev=await client.query("SELECT e.id,e.registration_fields FROM recruitment_events e JOIN organizations o ON o.id=e.organization_id WHERE e.slug=$1 AND e.status IN ('open','live') AND o.status='active' FOR SHARE OF e",[String(req.params.slug).toLowerCase()]);
  if(!ev.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Registration is not available for this event."})}
  const fieldDefs=Array.isArray(ev.rows[0].registration_fields)?ev.rows[0].registration_fields:[];
  const answers=b.customAnswers&&typeof b.customAnswers==="object"&&!Array.isArray(b.customAnswers)?b.customAnswers:{};
  const cleanAnswers={};
  for(const field of fieldDefs){
   const value=answers[field.key];let normalized=value;
   if(field.type==="checkbox")normalized=Boolean(value);
   else if(typeof value==="string")normalized=value.trim();
   else if(value==null)normalized="";
   else normalized=String(value);
   if(field.required&&(normalized===""||normalized===false)) {await client.query("ROLLBACK");return res.status(400).json({error:"Please complete the required field: "+field.label})}
   if(typeof normalized==="string"&&normalized.length>2000){await client.query("ROLLBACK");return res.status(400).json({error:"The answer for "+field.label+" is too long."})}
   if(field.type==="select"&&normalized!==""&&!(field.options||[]).includes(normalized)){await client.query("ROLLBACK");return res.status(400).json({error:"Choose a valid option for "+field.label})}
   cleanAnswers[field.key]=normalized;
  }
  const valid=await client.query("SELECT id FROM domains WHERE event_id=$1 AND active=true AND id=ANY($2::uuid[])",[ev.rows[0].id,preferences]);
  if(valid.rowCount!==preferences.length){await client.query("ROLLBACK");return res.status(400).json({error:"One or more selected domains are not available for this event."})}
  const code="RF-"+new Date().getFullYear()+"-"+randomBytes(4).toString("hex").toUpperCase();
  const c=await client.query("INSERT INTO candidates(event_id,candidate_code,name,email,phone,college,branch,academic_year,roll_number,skills,github_url,linkedin_url,portfolio_url,motivation,custom_answers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb) RETURNING id,candidate_code,name",[ev.rows[0].id,code,name,email,phone,college,branch,academicYear,rollNumber||null,skills||null,githubUrl||null,linkedinUrl||null,portfolioUrl||null,motivation||null,JSON.stringify(cleanAnswers)]);
  for(let i=0;i<preferences.length;i++)await client.query("INSERT INTO candidate_preferences(candidate_id,domain_id,priority) VALUES($1,$2,$3)",[c.rows[0].id,preferences[i],i+1]);
  await client.query("COMMIT");res.status(201).json({candidateId:c.rows[0].candidate_code,name:c.rows[0].name,message:"Registration completed successfully."});
 }catch(err){await client.query("ROLLBACK");if(err.code==="23505")return res.status(409).json({error:"This email address or phone number is already registered for this event."});console.error(err);res.status(500).json({error:"Could not complete registration. Please try again."})}finally{client.release()}
});
app.post("/api/public/track",requireDb,async(req,res)=>{const code=String(req.body?.candidateId||"").trim().toUpperCase(),email=String(req.body?.email||"").trim().toLowerCase();if(!code||!email)return res.status(400).json({error:"Enter your Candidate ID and registered email."});try{const q=await pool.query("SELECT c.candidate_code,c.name,c.status,e.name AS event_name,c.created_at FROM candidates c JOIN recruitment_events e ON e.id=c.event_id WHERE upper(c.candidate_code)=$1 AND lower(c.email)=$2",[code,email]);if(!q.rowCount)return res.status(404).json({error:"No matching application was found. Check your details and try again."});res.json({application:q.rows[0]})}catch(err){console.error(err);res.status(500).json({error:"Could not retrieve application status."})}});
app.get("/api/events/:id/candidates",requireDb,requireAuth,requireRole(...registrationRoles),async(req,res)=>{const search=String(req.query.search||"").trim().slice(0,100),status=String(req.query.status||"").trim();try{const q=await pool.query("SELECT c.id,c.candidate_code,c.name,c.email,c.phone,c.college,c.branch,c.academic_year,c.skills,c.github_url,c.linkedin_url,c.portfolio_url,c.motivation,c.custom_answers,c.status,c.created_at,COALESCE((SELECT json_agg(json_build_object('domain',d.name,'priority',cp.priority) ORDER BY cp.priority) FROM candidate_preferences cp JOIN domains d ON d.id=cp.domain_id WHERE cp.candidate_id=c.id),'[]'::json) AS preferences FROM candidates c WHERE c.event_id=$1 AND ($2='' OR c.status=$2) AND ($3='' OR c.name ILIKE '%'||$3||'%' OR c.email ILIKE '%'||$3||'%' OR c.candidate_code ILIKE '%'||$3||'%' OR c.phone ILIKE '%'||$3||'%') ORDER BY c.created_at DESC LIMIT 500",[req.params.id,status,search]);res.json({candidates:q.rows})}catch(err){console.error(err);res.status(500).json({error:"Could not load candidates."})}});



async function ensurePanelCallTable(){
 await pool.query(`CREATE TABLE IF NOT EXISTS panel_calls(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_id UUID NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,panel_id UUID NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
 volunteer_role VARCHAR(30) NOT NULL CHECK(volunteer_role IN ('W1 Volunteer','W2 Volunteer')),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','started','completed','cancelled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),sent_at TIMESTAMPTZ,started_at TIMESTAMPTZ,completed_at TIMESTAMPTZ
 )`);
 await pool.query("ALTER TABLE panel_calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()");
 await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS one_open_call_per_candidate ON panel_calls(candidate_id) WHERE status IN ('pending','sent')");
 await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS one_open_call_per_panel ON panel_calls(panel_id) WHERE status IN ('pending','sent')");
}
async function repairCandidateStatuses(eventId){
 // Older builds could leave a candidate in 'interviewed' after only one domain.
 // Reconcile their state from the actual interview records before attempting dispatch.
 await pool.query("UPDATE candidates c SET status='waiting_2' WHERE c.event_id=$1 AND c.status='interviewed' AND EXISTS(SELECT 1 FROM candidate_preferences cp WHERE cp.candidate_id=c.id AND NOT EXISTS(SELECT 1 FROM interviews i WHERE i.candidate_id=c.id AND i.domain_id=cp.domain_id AND i.status IN ('completed','absent'))) AND NOT EXISTS(SELECT 1 FROM interviews i WHERE i.candidate_id=c.id AND i.status='in_progress')",[eventId]);
}
async function dispatchNextForEvent(eventId){
 await ensurePanelCallTable();
 const panels=await pool.query("SELECT p.id,p.domain_id FROM panels p JOIN panel_assignments pa ON pa.panel_id=p.id AND pa.active=true JOIN users u ON u.id=pa.interviewer_id AND u.active WHERE p.event_id=$1 AND p.active=true AND NOT EXISTS(SELECT 1 FROM interviews i WHERE i.panel_id=p.id AND i.status='in_progress') AND NOT EXISTS(SELECT 1 FROM panel_calls pc WHERE pc.panel_id=p.id AND pc.status IN ('pending','sent')) ORDER BY p.name",[eventId]);
 let created=0;
 for(const panel of panels.rows){
  const candidate=await pool.query("SELECT c.id,c.status FROM candidates c JOIN candidate_preferences cp ON cp.candidate_id=c.id AND cp.priority=(SELECT min(cp2.priority) FROM candidate_preferences cp2 WHERE cp2.candidate_id=c.id AND NOT EXISTS(SELECT 1 FROM interviews i WHERE i.candidate_id=c.id AND i.domain_id=cp2.domain_id AND i.status IN ('in_progress','completed'))) AND cp.domain_id=$2 WHERE c.event_id=$1 AND c.status IN ('waiting_1','waiting_2') AND NOT EXISTS(SELECT 1 FROM panel_calls pc WHERE pc.candidate_id=c.id AND pc.status IN ('pending','sent')) ORDER BY CASE c.status WHEN 'waiting_1' THEN 0 ELSE 1 END,c.checked_in_at NULLS LAST,c.created_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED",[eventId,panel.domain_id]);
  if(!candidate.rowCount)continue;
  const role=candidate.rows[0].status==='waiting_1'?'W1 Volunteer':'W2 Volunteer';
  try{
   const call=await pool.query("INSERT INTO panel_calls(event_id,candidate_id,panel_id,volunteer_role) VALUES($1,$2,$3,$4) RETURNING id",[eventId,candidate.rows[0].id,panel.id,role]);
   await pool.query("UPDATE candidates SET status='called_to_panel' WHERE id=$1",[candidate.rows[0].id]);
   await pool.query("INSERT INTO audit_logs(event_id,action,entity_type,entity_id,details) VALUES($1,'panel_auto_assigned','candidate',$2,$3)",[eventId,candidate.rows[0].id,JSON.stringify({panelId:panel.id,callId:call.rows[0].id,volunteerRole:role})]);
   created++;
  }catch(e){if(e.code!=="23505")throw e}
 }
 return created;
}

const opsRoles=["Super Admin","Admin","Entry Volunteer","W1 Volunteer","W2 Volunteer","Interviewer"];

app.get("/api/events/:id/panel-calls",requireDb,requireAuth,requireRole("Super Admin","Admin","W1 Volunteer","W2 Volunteer"),async(req,res)=>{try{await ensurePanelCallTable();const q=await pool.query("SELECT pc.id,pc.status,pc.volunteer_role,pc.created_at,c.id AS candidate_id,c.candidate_code,c.name,c.branch,p.id AS panel_id,p.name AS panel_name,d.name AS domain,cp.priority FROM panel_calls pc JOIN candidates c ON c.id=pc.candidate_id JOIN panels p ON p.id=pc.panel_id JOIN domains d ON d.id=p.domain_id LEFT JOIN candidate_preferences cp ON cp.candidate_id=c.id AND cp.domain_id=d.id WHERE pc.event_id=$1 AND pc.status IN ('pending','sent') AND ($2='Admin' OR $2='Super Admin' OR pc.volunteer_role=$2) ORDER BY pc.created_at",[req.params.id,req.auth.role]);res.json({calls:q.rows})}catch(e){console.error(e);res.status(500).json({error:"Could not load panel notifications."})}});
app.post("/api/events/:id/panel-calls/:callId/confirm-sent",requireDb,requireAuth,requireRole("Super Admin","Admin","W1 Volunteer","W2 Volunteer"),async(req,res)=>{try{await ensurePanelCallTable();const q=await pool.query("UPDATE panel_calls SET status='sent',sent_at=now() WHERE id=$1 AND event_id=$2 AND status='pending' AND ($3 IN ('Super Admin','Admin') OR volunteer_role=$3) RETURNING id,candidate_id,panel_id,status,sent_at",[req.params.callId,req.params.id,req.auth.role]);if(!q.rowCount)return res.status(409).json({error:"Notification is no longer pending or is assigned to another volunteer role."});await pool.query("INSERT INTO audit_logs(event_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'participant_sent_to_panel','panel_call',$3,$4)",[req.params.id,req.auth.sub,q.rows[0].id,JSON.stringify({candidateId:q.rows[0].candidate_id,panelId:q.rows[0].panel_id})]);res.json({call:q.rows[0],message:"Participant marked as sent to the assigned panel."})}catch(e){console.error(e);res.status(500).json({error:"Could not confirm participant dispatch."})}});

app.get("/api/events/:id/queue",requireDb,requireAuth,requireRole(...opsRoles),async(req,res)=>{try{await repairCandidateStatuses(req.params.id);await dispatchNextForEvent(req.params.id);await ensurePanelCallTable();const q=await pool.query("SELECT c.id,c.candidate_code,c.name,c.college,c.branch,c.academic_year,c.status,c.checked_in_at,c.created_at,(SELECT pc.panel_id FROM panel_calls pc WHERE pc.candidate_id=c.id AND pc.status IN ('pending','sent','started') LIMIT 1) AS assigned_panel_id,(SELECT p.name FROM panel_calls pc JOIN panels p ON p.id=pc.panel_id WHERE pc.candidate_id=c.id AND pc.status IN ('pending','sent','started') LIMIT 1) AS assigned_panel_name,COALESCE((SELECT json_agg(json_build_object('domain',d.name,'priority',cp.priority) ORDER BY cp.priority) FROM candidate_preferences cp JOIN domains d ON d.id=cp.domain_id WHERE cp.candidate_id=c.id),'[]'::json) AS preferences,COALESCE((SELECT json_agg(json_build_object('id',i.id,'status',i.status,'domain',d.name,'panel',p.name) ORDER BY i.created_at DESC) FROM interviews i JOIN domains d ON d.id=i.domain_id JOIN panels p ON p.id=i.panel_id WHERE i.candidate_id=c.id),'[]'::json) AS interviews FROM candidates c WHERE c.event_id=$1 AND c.status IN ('registered','waiting_1','waiting_2','called_to_panel','interviewing','interviewed','withdrawn') AND ($2::boolean=false OR EXISTS(SELECT 1 FROM panel_calls pc JOIN panel_assignments pa ON pa.panel_id=pc.panel_id AND pa.active=true WHERE pc.candidate_id=c.id AND pa.interviewer_id=$3 AND pc.status IN ('pending','sent','started')) OR EXISTS(SELECT 1 FROM interviews ix WHERE ix.candidate_id=c.id AND ix.interviewer_id=$3 AND ix.status='in_progress') OR (c.status IN ('waiting_1','waiting_2') AND EXISTS(SELECT 1 FROM candidate_preferences cp JOIN panels p ON p.domain_id=cp.domain_id AND p.event_id=c.event_id JOIN panel_assignments pa ON pa.panel_id=p.id AND pa.active=true AND pa.interviewer_id=$3 WHERE cp.candidate_id=c.id AND cp.priority=(SELECT MIN(cp2.priority) FROM candidate_preferences cp2 WHERE cp2.candidate_id=c.id AND NOT EXISTS(SELECT 1 FROM interviews done WHERE done.candidate_id=c.id AND done.domain_id=cp2.domain_id AND done.status IN ('in_progress','completed'))) AND NOT EXISTS(SELECT 1 FROM panel_calls openpc WHERE openpc.candidate_id=c.id AND openpc.panel_id=p.id AND openpc.status IN ('pending','sent','started'))))) ORDER BY CASE c.status WHEN 'waiting_2' THEN 1 WHEN 'waiting_1' THEN 2 WHEN 'registered' THEN 3 WHEN 'interviewing' THEN 4 ELSE 5 END,c.checked_in_at NULLS LAST,c.created_at",[req.params.id,req.auth.role==="Interviewer",req.auth.sub]);res.json({queue:q.rows})}catch(e){console.error(e);res.status(500).json({error:"Could not load live queue."})}});
app.post("/api/events/:id/candidates/:candidateId/check-in",requireDb,requireAuth,requireRole("Super Admin","Admin","Entry Volunteer"),async(req,res)=>{try{const q=await pool.query("UPDATE candidates SET status='waiting_1',checked_in_at=COALESCE(checked_in_at,now()) WHERE id=$1 AND event_id=$2 AND status='registered' RETURNING id,candidate_code,status,checked_in_at",[req.params.candidateId,req.params.id]);if(!q.rowCount)return res.status(409).json({error:"Candidate not found or already checked in."});await pool.query("INSERT INTO audit_logs(event_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'candidate_checked_in','candidate',$3,$4)",[req.params.id,req.auth.sub,q.rows[0].id,JSON.stringify({candidateCode:q.rows[0].candidate_code})]);await dispatchNextForEvent(req.params.id);res.json({candidate:q.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not check in candidate."})}});
app.patch("/api/events/:id/candidates/:candidateId/room",requireDb,requireAuth,requireRole("Super Admin","Admin","W1 Volunteer","W2 Volunteer"),async(req,res)=>{const room=String(req.body?.room||"");if(!["waiting_1","waiting_2"].includes(room))return res.status(400).json({error:"Choose a valid waiting room."});try{const from=room==="waiting_2"?"waiting_1":"waiting_2";const q=await pool.query("UPDATE candidates SET status=$3 WHERE id=$1 AND event_id=$2 AND status=$4 RETURNING id,candidate_code,status",[req.params.candidateId,req.params.id,room,from]);if(!q.rowCount)return res.status(409).json({error:"Candidate is not in the expected previous room."});await pool.query("INSERT INTO audit_logs(event_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'candidate_moved_room','candidate',$3,$4)",[req.params.id,req.auth.sub,q.rows[0].id,JSON.stringify({room})]);res.json({candidate:q.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not move candidate."})}});
app.post("/api/events/:id/candidates/:candidateId/interviews/start",requireDb,requireAuth,requireRole("Super Admin","Admin","Interviewer"),async(req,res)=>{const panelId=String(req.body?.panelId||"");if(!panelId)return res.status(400).json({error:"Choose your panel."});const client=await pool.connect();try{await client.query("BEGIN");const p=await client.query("SELECT p.id,p.domain_id FROM panels p WHERE p.id=$1 AND p.event_id=$2 AND p.active=true",[panelId,req.params.id]);if(!p.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Panel not found."})}const assigned=await client.query("SELECT 1 FROM panel_assignments WHERE panel_id=$1 AND interviewer_id=$2 AND active=true",[panelId,req.auth.sub]);if(req.auth.role==="Interviewer"&&!assigned.rowCount){await client.query("ROLLBACK");return res.status(403).json({error:"You are not assigned to this panel."})}const c=await client.query("SELECT id,status FROM candidates WHERE id=$1 AND event_id=$2 FOR UPDATE",[req.params.candidateId,req.params.id]);if(!c.rowCount||!["waiting_1","waiting_2","called_to_panel"].includes(c.rows[0].status)){await client.query("ROLLBACK");return res.status(409).json({error:"Candidate must be checked in and waiting before an interview."})}const call=await client.query("SELECT id FROM panel_calls WHERE candidate_id=$1 AND panel_id=$2 AND status='sent' FOR UPDATE",[req.params.candidateId,panelId]);if(!call.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:"The volunteer must confirm that the participant has been sent to this assigned panel first."})}const next=await client.query("SELECT cp.domain_id,d.name,cp.priority FROM candidate_preferences cp JOIN domains d ON d.id=cp.domain_id WHERE cp.candidate_id=$1 AND NOT EXISTS(SELECT 1 FROM interviews i WHERE i.candidate_id=cp.candidate_id AND i.domain_id=cp.domain_id AND i.status IN ('in_progress','completed')) ORDER BY cp.priority LIMIT 1",[req.params.candidateId]);if(!next.rowCount||next.rows[0].domain_id!==p.rows[0].domain_id){await client.query("ROLLBACK");return res.status(409).json({error:"Follow domain preference order. Next domain: "+(next.rows[0]?.name||"all preferences completed")})}const interviewer=req.auth.role==="Interviewer"?{rows:[{interviewer_id:req.auth.sub}]}:await client.query("SELECT interviewer_id FROM panel_assignments WHERE panel_id=$1 AND active=true ORDER BY assigned_at DESC LIMIT 1",[panelId]);const q=await client.query("INSERT INTO interviews(candidate_id,panel_id,domain_id,interviewer_id,status,started_at) VALUES($1,$2,$3,$4,'in_progress',now()) RETURNING *",[req.params.candidateId,panelId,p.rows[0].domain_id,interviewer.rows[0]?.interviewer_id||req.auth.sub]);await client.query("UPDATE candidates SET status='interviewing' WHERE id=$1",[req.params.candidateId]);await client.query("UPDATE panel_calls SET status='started',started_at=now() WHERE candidate_id=$1 AND panel_id=$2 AND status='sent'",[req.params.candidateId,panelId]);await client.query("COMMIT");res.status(201).json({interview:q.rows[0]})}catch(e){await client.query("ROLLBACK");if(e.code==="23505")return res.status(409).json({error:"The panel or candidate already has an interview in progress."});console.error(e);res.status(500).json({error:"Could not start interview."})}finally{client.release()}});
app.post("/api/events/:id/interviews/:interviewId/complete",requireDb,requireAuth,requireRole("Super Admin","Admin","Interviewer"),async(req,res)=>{const b=req.body||{},scores=["technical","communication","problemSolving","domainKnowledge"].map(k=>Number(b[k]));if(scores.some(x=>!Number.isInteger(x)||x<0||x>10))return res.status(400).json({error:"Enter all four scores between 0 and 10."});const feedback=String(b.feedback||"").trim().slice(0,5000);const client=await pool.connect();try{await client.query("BEGIN");const interview=await client.query("SELECT i.id,i.candidate_id,i.interviewer_id,i.status FROM interviews i JOIN panels p ON p.id=i.panel_id WHERE i.id=$1 AND p.event_id=$2 FOR UPDATE",[req.params.interviewId,req.params.id]);if(!interview.rowCount||interview.rows[0].status!=="in_progress"){await client.query("ROLLBACK");return res.status(404).json({error:"Active interview not found."})}if(req.auth.role==="Interviewer"&&interview.rows[0].interviewer_id!==req.auth.sub){await client.query("ROLLBACK");return res.status(403).json({error:"Only the assigned interviewer can complete this interview."})}const total=scores.reduce((a,b)=>a+b,0);const q=await client.query("UPDATE interviews SET status='completed',completed_at=now(),technical=$2,communication=$3,problem_solving=$4,domain_knowledge=$5,total_score=$6,feedback=$7 WHERE id=$1 RETURNING id,total_score,status",[req.params.interviewId,...scores,total,feedback||null]);const next=await client.query("SELECT d.name,cp.priority FROM candidate_preferences cp JOIN domains d ON d.id=cp.domain_id WHERE cp.candidate_id=$1 AND NOT EXISTS(SELECT 1 FROM interviews i WHERE i.candidate_id=cp.candidate_id AND i.domain_id=cp.domain_id AND i.status IN ('in_progress','completed')) ORDER BY cp.priority LIMIT 1",[interview.rows[0].candidate_id]);const nextStatus=next.rowCount?"waiting_2":"interviewed";await client.query("UPDATE panel_calls SET status='completed',completed_at=now() WHERE candidate_id=$1 AND status='started'",[interview.rows[0].candidate_id]);await client.query("UPDATE candidates SET status=$2 WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM interviews WHERE candidate_id=$1 AND status='in_progress' AND id<>$3)",[interview.rows[0].candidate_id,nextStatus,req.params.interviewId]);await client.query("COMMIT");await dispatchNextForEvent(req.params.id);res.json({interview:q.rows[0],nextDomain:next.rows[0]?.name||null,nextPriority:next.rows[0]?.priority||null,allPreferencesCompleted:!next.rowCount})}catch(e){await client.query("ROLLBACK");console.error(e);res.status(500).json({error:"Could not complete interview."})}finally{client.release()}});


app.post("/api/events/:id/candidates/:candidateId/withdraw-remaining",requireDb,requireAuth,requireRole("Super Admin","Admin","W2 Volunteer"),async(req,res)=>{
 await ensurePanelCallTable();
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  // Replace any older CHECK constraint on interviews.status so 'absent' is valid.
  const checks=await client.query("SELECT conname FROM pg_constraint WHERE conrelid='interviews'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%'");
  for(const row of checks.rows) await client.query('ALTER TABLE interviews DROP CONSTRAINT "'+String(row.conname).replace(/"/g,'""')+'"');
  await client.query("ALTER TABLE interviews ADD CONSTRAINT interviews_status_check CHECK(status IN ('scheduled','in_progress','completed','cancelled','absent'))");
  const candidate=await client.query("SELECT id,status FROM candidates WHERE id=$1 AND event_id=$2 FOR UPDATE",[req.params.candidateId,req.params.id]);
  if(!candidate.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Candidate not found in this event."})}
  if(["interviewed","withdrawn"].includes(candidate.rows[0].status)){await client.query("ROLLBACK");return res.status(409).json({error:"This participant has already completed or exited the interview process."})}
  if(req.auth.role==="W2 Volunteer"&&!["waiting_2","called_to_panel"].includes(candidate.rows[0].status)){await client.query("ROLLBACK");return res.status(403).json({error:"W2 volunteers can process exits only from Waiting Room 2 or its assigned panel."})}
  if(req.auth.role==="W2 Volunteer"&&candidate.rows[0].status==="called_to_panel"){
   const roleCheck=await client.query("SELECT 1 FROM panel_calls pc WHERE pc.candidate_id=$1 AND pc.event_id=$2 AND pc.status IN ('pending','sent') AND (pc.volunteer_role='W2 Volunteer' OR EXISTS(SELECT 1 FROM interviews done WHERE done.candidate_id=pc.candidate_id AND done.status='completed')) LIMIT 1",[req.params.candidateId,req.params.id]);
   if(!roleCheck.rowCount){await client.query("ROLLBACK");return res.status(403).json({error:"This participant is not in your Waiting Room 2 dispatch queue."})}
  }
  const active=await client.query("SELECT 1 FROM interviews WHERE candidate_id=$1 AND status='in_progress' LIMIT 1",[req.params.candidateId]);
  if(active.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:"An interview is currently in progress. Complete it before processing the exit."})}
  const pending=await client.query("SELECT cp.domain_id,p.id AS panel_id FROM candidate_preferences cp JOIN panels p ON p.domain_id=cp.domain_id AND p.event_id=$2 WHERE cp.candidate_id=$1 AND NOT EXISTS(SELECT 1 FROM interviews i WHERE i.candidate_id=$1 AND i.domain_id=cp.domain_id AND i.status IN ('completed','absent'))",[req.params.candidateId,req.params.id]);
  for(const item of pending.rows){
   await client.query("INSERT INTO interviews(candidate_id,panel_id,domain_id,status,feedback,completed_at) VALUES($1,$2,$3,'absent','Participant exited before attending this domain interview.',now())",[req.params.candidateId,item.panel_id,item.domain_id]);
  }
  await client.query("UPDATE panel_calls SET status='cancelled',updated_at=now() WHERE candidate_id=$1 AND status IN ('pending','sent')",[req.params.candidateId]);
  await client.query("UPDATE candidates SET status='withdrawn' WHERE id=$1",[req.params.candidateId]);
  await client.query("INSERT INTO audit_logs(event_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'candidate_withdrew_remaining_interviews','candidate',$3,$4::jsonb)",[req.params.id,req.auth.sub,req.params.candidateId,JSON.stringify({absentDomains:pending.rowCount,processedByRole:req.auth.role})]);
  await client.query("COMMIT");
  await dispatchNextForEvent(req.params.id);
  res.json({ok:true,message:"Participant exit recorded. Completed scores were preserved and remaining interviews were marked absent.",absentCount:pending.rowCount});
 }catch(e){await client.query("ROLLBACK");console.error("Participant withdrawal failed:",e);res.status(500).json({error:"Could not record participant exit: "+(e.message||e.code||"database error")})}finally{client.release()}
});
app.get("/api/events/:id/candidates/:candidateId/progress",requireDb,requireAuth,requireRole("Super Admin","Admin","Registration Volunteer","Entry Volunteer","W1 Volunteer","W2 Volunteer","Interviewer"),async(req,res)=>{try{const c=await pool.query("SELECT id,candidate_code,name,status FROM candidates WHERE id=$1 AND event_id=$2",[req.params.candidateId,req.params.id]);if(!c.rowCount)return res.status(404).json({error:"Candidate not found."});const q=await pool.query("SELECT cp.priority,d.id AS domain_id,d.name AS domain,COALESCE(i.status,'pending') AS interview_status,i.total_score,i.technical,i.communication,i.problem_solving,i.domain_knowledge,i.feedback,i.completed_at,p.name AS panel FROM candidate_preferences cp JOIN domains d ON d.id=cp.domain_id LEFT JOIN LATERAL(SELECT * FROM interviews WHERE candidate_id=cp.candidate_id AND domain_id=cp.domain_id ORDER BY created_at DESC LIMIT 1)i ON true LEFT JOIN panels p ON p.id=i.panel_id WHERE cp.candidate_id=$1 ORDER BY cp.priority",[req.params.candidateId]);const completed=q.rows.filter(x=>x.interview_status==='completed');const ranked=[...completed].sort((a,b)=>(Number(b.total_score)||0)-(Number(a.total_score)||0)||a.priority-b.priority);res.json({candidate:c.rows[0],domains:q.rows,completedCount:completed.length,totalPreferences:q.rowCount,finalDomain:ranked[0]?.domain||null,finalScore:ranked[0]?.total_score??null,finalRanking:ranked.map((x,i)=>({rank:i+1,domain:x.domain,priority:x.priority,score:x.total_score}))})}catch(e){console.error(e);res.status(500).json({error:"Could not load candidate interview progress."})}});

const reportRoles=["Super Admin","Admin","Registration Volunteer"];
async function buildSelectionRows(eventId){
 const q=await pool.query("WITH pref AS (SELECT c.id,c.candidate_code,c.name,c.email,c.college,c.branch,c.academic_year,c.status AS candidate_status,c.created_at,count(cp.domain_id)::int AS preference_count FROM candidates c LEFT JOIN candidate_preferences cp ON cp.candidate_id=c.id WHERE c.event_id=$1 GROUP BY c.id), scored AS (SELECT cp.candidate_id,count(i.id) FILTER(WHERE i.status='completed')::int AS completed_count,round(avg(i.total_score) FILTER(WHERE i.status='completed'),2) AS average_score,max(i.total_score) FILTER(WHERE i.status='completed') AS best_score,(array_agg(d.name ORDER BY i.total_score DESC NULLS LAST,cp.priority) FILTER(WHERE i.status='completed'))[1] AS strongest_domain FROM candidate_preferences cp JOIN domains d ON d.id=cp.domain_id JOIN candidates c ON c.id=cp.candidate_id LEFT JOIN interviews i ON i.candidate_id=cp.candidate_id AND i.domain_id=cp.domain_id WHERE c.event_id=$1 GROUP BY cp.candidate_id) SELECT pref.*,COALESCE(scored.completed_count,0) AS completed_count,scored.average_score,scored.best_score,scored.strongest_domain,CASE WHEN pref.candidate_status='withdrawn' THEN 'Withdrawn - remaining domains absent' WHEN COALESCE(scored.completed_count,0)<pref.preference_count THEN 'Pending interviews' WHEN scored.average_score>=28 THEN 'Shortlist for review' WHEN scored.average_score>=24 THEN 'Committee review' ELSE 'Further review' END AS recommendation FROM pref LEFT JOIN scored ON scored.candidate_id=pref.id ORDER BY scored.average_score DESC NULLS LAST,pref.name ASC",[eventId]);
 return q.rows;
}
app.get("/api/events/:id/selection",requireDb,requireAuth,requireRole(...reportRoles),async(req,res)=>{
 try{const e=await pool.query("SELECT id FROM recruitment_events WHERE id=$1",[req.params.id]);if(!e.rowCount)return res.status(404).json({error:"Event not found."});res.json({candidates:await buildSelectionRows(req.params.id)});}
 catch(e){console.error(e);res.status(500).json({error:"Could not build selection review."})}
});
app.get("/api/events/:id/analytics",requireDb,requireAuth,requireRole(...reportRoles),async(req,res)=>{
 try{
  const e=await pool.query("SELECT id,name,status FROM recruitment_events WHERE id=$1",[req.params.id]);if(!e.rowCount)return res.status(404).json({error:"Event not found."});
  const summary=await pool.query("SELECT count(*)::int AS total_candidates,count(*) FILTER(WHERE status='registered')::int AS registered,count(*) FILTER(WHERE status='waiting_1')::int AS waiting_1,count(*) FILTER(WHERE status='waiting_2')::int AS waiting_2,count(*) FILTER(WHERE status='interviewing')::int AS interviewing,count(*) FILTER(WHERE status='interviewed')::int AS interviewed FROM candidates WHERE event_id=$1",[req.params.id]);
  const domains=await pool.query("SELECT d.name AS domain,count(i.id)::int AS completed_interviews,round(avg(i.total_score),2) AS average_score,count(DISTINCT i.candidate_id)::int AS candidates_assessed FROM domains d LEFT JOIN interviews i ON i.domain_id=d.id AND i.status='completed' WHERE d.event_id=$1 GROUP BY d.id,d.name ORDER BY d.name",[req.params.id]);
  const rows=await buildSelectionRows(req.params.id);
  res.json({event:e.rows[0],summary:summary.rows[0],domains:domains.rows,recommendations:{shortlist:rows.filter(x=>x.recommendation==="Shortlist for review").length,committeeReview:rows.filter(x=>x.recommendation==="Committee review").length,furtherReview:rows.filter(x=>x.recommendation==="Further review").length,pending:rows.filter(x=>x.recommendation==="Pending interviews").length}});
 }catch(e){console.error(e);res.status(500).json({error:"Could not load event analytics."})}
});
app.get("/api/events/:id/reports/candidates.csv",requireDb,requireAuth,requireRole(...reportRoles),async(req,res)=>{
 try{
  const rows=await buildSelectionRows(req.params.id);
  const headers=["Candidate ID","Name","Email","College","Branch","Academic Year","Candidate Status","Completed Interviews","Preference Count","Average Score","Best Score","Strongest Domain","Recommendation"];
  const esc=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
  const csv=[headers,...rows.map(x=>[x.candidate_code,x.name,x.email,x.college,x.branch,x.academic_year,x.candidate_status,x.completed_count,x.preference_count,x.average_score,x.best_score,x.strongest_domain,x.recommendation])].map(row=>row.map(esc).join(",")).join("\r\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="recruitflow-candidates.csv"');res.send("\uFEFF"+csv);
 }catch(e){console.error(e);res.status(500).json({error:"Could not export candidate report."})}
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:"Internal server error"})});
app.listen(port,()=>console.log("RecruitFlow API listening on http://localhost:"+port));
