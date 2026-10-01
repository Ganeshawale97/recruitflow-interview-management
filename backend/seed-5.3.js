import pg from "pg";
import bcrypt from "bcryptjs";
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false});
const users=[
 ["admin","Administrator",process.env.ADMIN_PASSWORD||"change-admin-password","Admin"],
 ["entry","Entry Volunteer",process.env.ENTRY_PASSWORD||"change-entry-password","Entry Volunteer"],
 ["w1","W1 Volunteer",process.env.W1_PASSWORD||"change-w1-password","W1 Volunteer"],
 ["w2","W2 Volunteer",process.env.W2_PASSWORD||"change-w2-password","W2 Volunteer"],
 ["interviewer","Interviewer",process.env.INTERVIEWER_PASSWORD||"change-interviewer-password","Interviewer"]
];
for(const [username,name,password,role] of users){
 const hash=await bcrypt.hash(password,12);
 await pool.query(`INSERT INTO users(username,display_name,password_hash,role,active) VALUES($1,$2,$3,$4,true)
 ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,active=true`,
 [username,name,hash,role]);
}
console.log("RecruitFlow users seeded. Set strong environment passwords before production.");
await pool.end();
