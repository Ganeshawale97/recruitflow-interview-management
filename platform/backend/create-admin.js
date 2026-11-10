import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
const {Pool}=pg;
const required=["DATABASE_URL","BOOTSTRAP_ADMIN_USERNAME","BOOTSTRAP_ADMIN_EMAIL","BOOTSTRAP_ADMIN_NAME","BOOTSTRAP_ADMIN_PASSWORD"];
const missing=required.filter(k=>!process.env[k]);
if(missing.length){console.error("Missing environment variables:",missing.join(", "));process.exit(1)}
const password=process.env.BOOTSTRAP_ADMIN_PASSWORD;
if(password.length<12){console.error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.");process.exit(1)}
const username=process.env.BOOTSTRAP_ADMIN_USERNAME.trim().toLowerCase();
const email=process.env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:false}:undefined});
try{
 const existing=await pool.query("SELECT id FROM users WHERE lower(username)=$1 OR lower(email)=$2",[username,email]);
 if(existing.rowCount){console.error("An account with that username or email already exists. No changes made.");process.exitCode=1}
 else{
  const hash=await bcrypt.hash(password,12);
  const result=await pool.query("INSERT INTO users(username,email,display_name,password_hash,role_id) SELECT $1,$2,$3,$4,id FROM roles WHERE name='Super Admin' RETURNING id,username,email",[username,email,process.env.BOOTSTRAP_ADMIN_NAME.trim(),hash]);
  if(!result.rowCount)throw new Error("Super Admin role is missing. Run schema.sql first.");
  console.log("Initial administrator created:",result.rows[0].username);
  console.log("Sign in at http://localhost:5173. Keep your password private.");
 }
}catch(error){console.error("Admin setup failed:",error.message);process.exitCode=1}
finally{await pool.end()}
