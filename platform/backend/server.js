import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pg from "pg";
const app=express();const port=Number(process.env.PORT||4000);
app.use(helmet());app.use(cors({origin:process.env.CORS_ORIGIN?.split(",")||["http://localhost:5173"]}));app.use(express.json({limit:"1mb"}));
let pool=null;if(process.env.DATABASE_URL){pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:false}:undefined});}
app.get("/api/health",async(_req,res)=>{let database="not_configured";if(pool){try{await pool.query("SELECT 1");database="connected"}catch{database="disconnected"}}res.json({ok:true,service:"recruitflow-api",version:"0.1.0",database,now:new Date().toISOString()})});
app.get("/api",(_req,res)=>res.json({name:"RecruitFlow API",version:"0.1.0",status:"Phase 1 foundation"}));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:"Internal server error"})});
app.listen(port,()=>console.log("RecruitFlow API listening on http://localhost:"+port));
