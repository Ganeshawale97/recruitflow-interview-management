import { FormEvent, useState } from "react";
import { ArrowLeft, Building2, CheckCircle2 } from "lucide-react";

const API=(import.meta.env.VITE_API_URL||"http://localhost:4000").replace(/\/$/,"");
const initial={name:"",type:"College",contactName:"",email:"",phone:"",website:"",description:""};

export default function OrganizationRegistration(){
 const [form,setForm]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(""),[submitted,setSubmitted]=useState(false);
 function update(key:keyof typeof initial,value:string){setForm(old=>({...old,[key]:value}))}
 async function submit(e:FormEvent){
  e.preventDefault();setBusy(true);setError("");
  try{
   const response=await fetch(API+"/api/public/organization-applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
   const data=await response.json().catch(()=>({error:"Unexpected server response."}));
   if(!response.ok)throw new Error(data.error||"Could not submit your application.");
   setSubmitted(true);
  }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 return <main className="org-register-screen">
  <div className="org-register-top"><a href="/"><span className="brand-mark">R</span> Recruit<span>Flow</span></a><a className="org-back-link" href="/"> <ArrowLeft size={15}/> Back to sign in</a></div>
  <section className="org-register-card">
   {submitted?<div className="org-register-success"><CheckCircle2 size={48}/><span className="eyebrow">APPLICATION RECEIVED</span><h1>Thank you for applying.</h1><p>Your organisation application has been submitted successfully. Our platform team will review the details. You will be contacted using the email address you provided.</p><div className="org-review-note"><b>What happens next?</b><br/>Your application is now pending review. An organisation workspace is not activated until approval and onboarding are complete.</div><a className="portal-primary" href="/">Return to RecruitFlow</a></div>:<>
    <div className="org-register-icon"><Building2 size={23}/></div><span className="eyebrow">JOIN THE RECRUITFLOW PLATFORM</span><h1>Register your organisation</h1><p className="org-register-intro">Tell us about your college, company or club. Applications are reviewed before workspace access is enabled.</p>
    {error&&<div className="alert error">{error}</div>}
    <form className="portal-form" onSubmit={submit}>
     <h3>Organisation details</h3>
     <div className="portal-grid">
      <label>Organisation name *<input required minLength={2} maxLength={180} value={form.name} onChange={e=>update("name",e.target.value)} placeholder="e.g. SKN IEEE Student Branch"/></label>
      <label>Organisation type *<select required value={form.type} onChange={e=>update("type",e.target.value)}><option>College</option><option>Company</option><option>Club</option><option>Other</option></select></label>
     </div>
     <label>Website (optional)<input type="url" maxLength={300} value={form.website} onChange={e=>update("website",e.target.value)} placeholder="https://example.com"/></label>
     <label>Short description (optional)<textarea rows={3} maxLength={2000} value={form.description} onChange={e=>update("description",e.target.value)} placeholder="Tell us what your organisation does."/></label>
     <h3>Primary contact</h3>
     <div className="portal-grid">
      <label>Contact person's name *<input required minLength={2} maxLength={140} value={form.contactName} onChange={e=>update("contactName",e.target.value)} placeholder="Full name"/></label>
      <label>Official email address *<input required type="email" maxLength={254} value={form.email} onChange={e=>update("email",e.target.value)} placeholder="name@organisation.com"/></label>
     </div>
     <label>Phone number *<input required type="tel" maxLength={30} value={form.phone} onChange={e=>update("phone",e.target.value)} placeholder="Contact number"/></label>
     <div className="org-review-note">Submitting this form does not create a login account. If approved, workspace setup and administrator access will be completed during onboarding.</div>
     <button className="portal-primary" type="submit" disabled={busy}>{busy?"Submitting application…":"Submit for approval"}</button>
    </form>
   </>}
  </section>
  <p className="portal-footer">RecruitFlow Platform · Organisation applications</p>
 </main>
}
