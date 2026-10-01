import express from "express";
import cors from "cors";
import pg from "pg";

const {Pool}=pg;
const app=express();
app.use(cors());
app.use(express.json());

const pool=process.env.DATABASE_URL ? new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==="production" ? {rejectUnauthorized:false}:false
}) : null;

app.get("/api/health",async(req,res)=>{
  let database="not-configured";
  if(pool){try{await pool.query("SELECT 1");database="connected"}catch(e){database="error"}}
  res.json({service:"RecruitFlow API",status:"ok",database});
});

app.get("/api/candidates",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"DATABASE_URL is not configured"});
  const {rows}=await pool.query("SELECT * FROM candidates ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/candidates",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"DATABASE_URL is not configured"});
  const {candidate_id,name,email,phone,branch,year,skills,choices}=req.body;
  if(!candidate_id||!name)return res.status(400).json({error:"candidate_id and name are required"});
  const {rows}=await pool.query(
    "INSERT INTO candidates(candidate_id,name,email,phone,branch,year,skills,choices) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [candidate_id,name,email||"",phone||"",branch||"",year||"",skills||"",JSON.stringify(choices||[])]
  );
  res.status(201).json(rows[0]);
});

app.get("/api/panels",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"DATABASE_URL is not configured"});
  const {rows}=await pool.query("SELECT * FROM panels ORDER BY domain");
  res.json(rows);
});

app.listen(process.env.PORT||3000,()=>console.log("RecruitFlow API running"));
