import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";

const {Pool}=pg;
const app=express();
const PORT=Number(process.env.PORT||3000);
const JWT_SECRET=process.env.JWT_SECRET||"change-this-secret-before-production";
const pool=process.env.DATABASE_URL?new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false
}):null;

app.use(cors());
app.use(express.json({limit:"10mb"}));

function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  try{req.user=jwt.verify(token,JWT_SECRET);next()}catch(e){return res.status(401).json({error:"Authentication required"})}
}
function dbRequired(req,res,next){
  if(!pool)return res.status(503).json({error:"DATABASE_URL is not configured"});
  next();
}

app.get("/api/health",async(req,res)=>{
  let database="not-configured";
  if(pool){try{await pool.query("SELECT 1");database="connected"}catch(e){database="error"}}
  res.json({service:"RecruitFlow API 5.0",status:"ok",database});
});

app.post("/api/auth/login",dbRequired,async(req,res)=>{
  const {username,password}=req.body||{};
  if(!username||!password)return res.status(400).json({error:"Username and password are required"});
  const {rows}=await pool.query("SELECT id,username,display_name,password_hash,role,active FROM users WHERE username=$1",[String(username).toLowerCase()]);
  const u=rows[0];
  if(!u||!u.active||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Invalid credentials"});
  const token=jwt.sign({id:u.id,username:u.username,role:u.role,name:u.display_name},JWT_SECRET,{expiresIn:"12h"});
  res.json({token,user:{id:u.id,username:u.username,role:u.role,name:u.display_name}});
});

app.get("/api/state",auth,dbRequired,async(req,res)=>{
  const c=await pool.query("SELECT * FROM candidates ORDER BY created_at");
  const n=await pool.query("SELECT n.*,c.candidate_id FROM notifications n JOIN candidates c ON c.id=n.candidate_id ORDER BY n.created_at DESC LIMIT 500");
  const p=await pool.query("SELECT domain,interviewer_user_id,active FROM panels");
  res.json({candidates:c.rows,notifications:n.rows,panels:p.rows});
});

app.put("/api/state",auth,dbRequired,async(req,res)=>{
  const {candidates=[],notifications=[]}=req.body||{};
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    for(const c of candidates){
      const choices=JSON.stringify(c.choices||[]);
      await client.query(
        `INSERT INTO candidates(candidate_id,name,email,phone,branch,year,skills,choices,status,checked_in_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(candidate_id) DO UPDATE SET
         name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,branch=EXCLUDED.branch,
         year=EXCLUDED.year,skills=EXCLUDED.skills,choices=EXCLUDED.choices,status=EXCLUDED.status,
         checked_in_at=EXCLUDED.checked_in_at`,
        [c.id,c.name||"",c.email||"",c.phone||"",c.branch||"",c.year||"",c.skills||"",choices,c.status||"Registered",c.checkedInAt||null]
      );
    }
    for(const n of notifications){
      const cr=await client.query("SELECT id FROM candidates WHERE candidate_id=$1",[n.candidateId]);
      if(!cr.rows[0])continue;
      await client.query(
        `INSERT INTO notifications(id,candidate_id,type,message,read_at,created_at)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET read_at=EXCLUDED.read_at,message=EXCLUDED.message,type=EXCLUDED.type`,
        [String(n.id).replace(/[^0-9]/g,"").slice(-9)||Date.now(),cr.rows[0].id,n.type||"General Announcement",n.message||"",n.read?n.createdAt:null,n.createdAt||new Date().toISOString()]
      );
    }
    await client.query("COMMIT");
    res.json({ok:true,savedCandidates:candidates.length,savedNotifications:notifications.length});
  }catch(e){
    await client.query("ROLLBACK");
    res.status(500).json({error:"Sync failed",detail:e.message});
  }finally{client.release()}
});

app.listen(PORT,()=>console.log(`RecruitFlow API 5.0 running on port ${PORT}`));
