import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

const app=express();
const port=Number(process.env.PORT||4000);
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:false}:undefined}):null;
app.use(helmet());
app.use(cors({origin:(process.env.CORS_ORIGIN||"http://localhost:5173").split(",").map(x=>x.trim()),methods:["GET","POST","OPTIONS"],allowedHeaders:["Content-Type","Authorization"]}));
app.use(express.json({limit:"1mb"}));

const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many login attempts. Try again in 15 minutes."}});
function requireDb(_req,res,next){if(!pool)return res.status(503).json({error:"Database is not configured."});next()}
function requireAuth(req,res,next){
 const header=req.headers.authorization||"";
 const token=header.startsWith("Bearer ")?header.slice(7):"";
 if(!token)return res.status(401).json({error:"Authentication required."});
 if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)return res.status(503).json({error:"Authentication is not configured. Set a strong JWT_SECRET in backend/.env."});
 try{req.auth=jwt.verify(token,process.env.JWT_SECRET);next()}catch{return res.status(401).json({error:"Session expired. Please sign in again."})}
}
function requireRole(...roles){return(req,res,next)=>{if(!req.auth||!roles.includes(req.auth.role))return res.status(403).json({error:"You do not have permission to perform this action."});next()}}
function safeUser(row){return{id:row.id,username:row.username,email:row.email,displayName:row.display_name,role:row.role,active:row.active,createdAt:row.created_at}}
app.get("/api/health",async(_req,res)=>{let database="not_configured";if(pool){try{await pool.query("SELECT 1");database="connected"}catch{database="disconnected"}}res.json({ok:true,service:"recruitflow-api",version:"0.2.0",database,authentication:Boolean(process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32),now:new Date().toISOString()})});
app.get("/api",(_req,res)=>res.json({name:"RecruitFlow API",version:"0.2.0",status:"Authentication foundation"}));

app.post("/api/auth/login",loginLimiter,requireDb,async(req,res)=>{
 try{
  const identity=String(req.body?.identity||"").trim().toLowerCase();
  const password=String(req.body?.password||"");
  if(!identity||!password)return res.status(400).json({error:"Enter your username or email and password."});
  if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)return res.status(503).json({error:"Authentication is not configured. Add a JWT_SECRET of at least 32 characters to backend/.env."});
  const result=await pool.query("SELECT u.id,u.username,u.email,u.display_name,u.password_hash,u.active,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.username)= $1 OR lower(u.email)= $1 LIMIT 1",[identity]);
  const user=result.rows[0];
  if(!user||!user.active||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:"Invalid credentials or inactive account."});
  await pool.query("UPDATE users SET last_login_at=now() WHERE id=$1",[user.id]);
  const token=jwt.sign({sub:user.id,role:user.role,username:user.username},process.env.JWT_SECRET,{expiresIn:"8h",issuer:"recruitflow-api",audience:"recruitflow-platform"});
  return res.json({token,user:safeUser(user),expiresIn:28800});
 }catch(error){console.error("Login error:",error);return res.status(500).json({error:"Unable to sign in right now."})}
});
app.get("/api/auth/me",requireDb,requireAuth,async(req,res)=>{
 try{const r=await pool.query("SELECT u.id,u.username,u.email,u.display_name,u.active,rl.name AS role,u.created_at FROM users u JOIN roles rl ON rl.id=u.role_id WHERE u.id=$1",[req.auth.sub]);if(!r.rowCount||!r.rows[0].active)return res.status(401).json({error:"Account is unavailable."});res.json({user:safeUser(r.rows[0])})}catch(e){console.error(e);res.status(500).json({error:"Could not load account."})}
});
app.get("/api/auth/users",requireDb,requireAuth,requireRole("Super Admin","Admin"),async(_req,res)=>{
 try{const r=await pool.query("SELECT u.id,u.username,u.email,u.display_name,u.active,rl.name AS role,u.created_at FROM users u JOIN roles rl ON rl.id=u.role_id ORDER BY u.created_at DESC");res.json({users:r.rows.map(safeUser)})}catch(e){console.error(e);res.status(500).json({error:"Could not load users."})}
});
app.post("/api/auth/users",requireDb,requireAuth,requireRole("Super Admin","Admin"),async(req,res)=>{
 const username=String(req.body?.username||"").trim().toLowerCase(),email=String(req.body?.email||"").trim().toLowerCase(),displayName=String(req.body?.displayName||"").trim(),password=String(req.body?.password||""),role=String(req.body?.role||"");
 const allowed=["Admin","Registration Volunteer","Entry Volunteer","W1 Volunteer","W2 Volunteer","Interviewer"];
 if(!/^[a-z0-9._-]{3,30}$/.test(username))return res.status(400).json({error:"Username must be 3–30 characters (letters, numbers, dot, underscore or hyphen)."});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Enter a valid email address."});
 if(!displayName||password.length<12)return res.status(400).json({error:"Display name is required and password must contain at least 12 characters."});
 if(!allowed.includes(role))return res.status(400).json({error:"Choose a permitted staff role."});
 try{
  const hash=await bcrypt.hash(password,12);
  const r=await pool.query("INSERT INTO users(username,email,display_name,password_hash,role_id) SELECT $1,$2,$3,$4,id FROM roles WHERE name=$5 RETURNING id,username,email,display_name,active,created_at,(SELECT name FROM roles WHERE id=users.role_id) AS role",[username,email,displayName,hash,role]);
  if(!r.rowCount)return res.status(400).json({error:"Selected role does not exist in the database."});
  res.status(201).json({user:safeUser(r.rows[0])});
 }catch(e){if(e.code==="23505")return res.status(409).json({error:"That username or email is already registered."});console.error(e);res.status(500).json({error:"Could not create account."})}
});
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:"Internal server error"})});
app.listen(port,()=>console.log("RecruitFlow API listening on http://localhost:"+port));
