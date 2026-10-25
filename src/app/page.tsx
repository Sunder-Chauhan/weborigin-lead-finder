"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { Building2, CheckCircle2, Download, Filter, Linkedin, Mail, Phone, Plus, Search, ShieldCheck, Trash2, Upload, Users, WandSparkles } from "lucide-react";

type Lead = {
  id: string; name: string; title: string; company: string; industry: string; city: string;
  email: string; phone: string; linkedin: string; status: "New" | "Contacted" | "Interested" | "Converted";
  source: string; emailSource?: string; phoneSource?: string;
};
const DEMO: Lead[] = [
  { id:"demo-1", name:"Aarav Mehta", title:"Marketing Director", company:"Northstar Events", industry:"Events", city:"Delhi", email:"", phone:"", linkedin:"", status:"New", source:"Illustrative demo" },
  { id:"demo-2", name:"Priya Kapoor", title:"People Operations Lead", company:"Brightlane Tech", industry:"Technology", city:"Gurugram", email:"", phone:"", linkedin:"", status:"Contacted", source:"Illustrative demo" },
  { id:"demo-3", name:"Kabir Singh", title:"Founder", company:"Studio Meridian", industry:"Design", city:"Mumbai", email:"", phone:"", linkedin:"", status:"Interested", source:"Illustrative demo" }
];
const emptyForm = { name:"", title:"", company:"", industry:"", city:"", linkedin:"", email:"", phone:"" };
const newId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
const cleanUrl = (value:string) => value.trim().replace(/\/$/, "");
const isLinkedInUrl = (value:string) => /^https?:\/\/(www\.)?linkedin\.com\/(in|pub)\/[a-z0-9_%.-]+\/?$/i.test(value.trim());

export default function Home() {
  const [leads,setLeads] = useState<Lead[]>(DEMO);
  const [loaded,setLoaded] = useState(false);
  const [query,setQuery] = useState("");
  const [status,setStatus] = useState("All statuses");
  const [showAdd,setShowAdd] = useState(false);
  const [form,setForm] = useState(emptyForm);
  const [profileUrl,setProfileUrl] = useState("");
  const [lookupNotice,setLookupNotice] = useState("Paste a LinkedIn profile URL. Contact discovery uses your configured server-side provider; none is called until you submit.");
  const [lookupLoading,setLookupLoading] = useState(false);
  const [notice,setNotice] = useState("Demo mode: sample records are illustrative and saved locally in this browser.");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("weborigin-leads-v1");
      if (saved) setLeads(JSON.parse(saved) as Lead[]);
    } catch { setNotice("Could not read saved leads. The demo data is available in memory."); }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) {
      try { localStorage.setItem("weborigin-leads-v1", JSON.stringify(leads)); }
      catch { setNotice("Browser storage is full or unavailable. Export your leads to keep a backup."); }
    }
  }, [leads, loaded]);

  const filtered = useMemo(() => leads.filter(l => {
    const h = [l.name,l.title,l.company,l.industry,l.city,l.email,l.phone,l.linkedin].join(" ").toLowerCase();
    return h.includes(query.toLowerCase()) && (status === "All statuses" || l.status === status);
  }), [leads,query,status]);

  function saveLead(event?:FormEvent) {
    event?.preventDefault();
    const url = cleanUrl(form.linkedin);
    if (!form.name.trim() && !url) { setNotice("Enter a name or LinkedIn profile URL."); return; }
    if (url && !isLinkedInUrl(url)) { setNotice("Enter a valid linkedin.com/in/... or linkedin.com/pub/... profile URL."); return; }
    if (url && leads.some(l => cleanUrl(l.linkedin).toLowerCase() === url.toLowerCase())) { setNotice("This profile URL is already saved."); return; }
    const lead:Lead = { ...form, id:newId(), name:form.name.trim() || "Profile to research", linkedin:url, status:"New", source:"Manual entry" };
    setLeads(p => [lead,...p]); setForm(emptyForm); setShowAdd(false);
    setNotice("Lead saved locally. Contact enrichment has not been run.");
  }

  async function runLookup(event:FormEvent) {
    event.preventDefault();
    const url = cleanUrl(profileUrl);
    if (!isLinkedInUrl(url)) { setLookupNotice("Enter a LinkedIn profile URL in the format linkedin.com/in/username."); return; }

    let targetId = leads.find(l => cleanUrl(l.linkedin).toLowerCase() === url.toLowerCase())?.id;
    if (!targetId) {
      targetId = newId();
      const newLead:Lead = { ...emptyForm, id:targetId, name:"Profile to research", linkedin:url, status:"New", source:"Lookup queued" };
      setLeads(p => [newLead,...p]);
      setNotice("Profile saved to the lead list.");
    }

    setLookupLoading(true);
    setLookupNotice("Searching the configured contact provider. If a source has no match, we will report that rather than guess.");
    try {
      const response = await fetch("/api/lookup", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ linkedinUrl:url })
      });
      const result = await response.json() as {
        status?: string; message?: string;
        lead?: { fullName?:string; company?:string; title?:string; email?:string; phone?:string; emailSource?:string; phoneSource?:string };
      };
      if (!response.ok) {
        setLookupNotice(result.message || "Contact lookup is unavailable. Check the provider setup.");
        return;
      }
      const found = result.lead ?? {};
      setLeads(prev => prev.map(l => cleanUrl(l.linkedin).toLowerCase() === url.toLowerCase() ? ({
        ...l,
        name:found.fullName || l.name,
        company:found.company || l.company,
        title:found.title || l.title,
        email:found.email || l.email,
        phone:found.phone || l.phone,
        emailSource:found.emailSource || l.emailSource,
        phoneSource:found.phoneSource || l.phoneSource,
        source:(found.email || found.phone) ? "Tomba enrichment API" : l.source
      }) : l));
      setLookupNotice(result.message || "Lookup completed.");
    } catch {
      setLookupNotice("Could not reach the lookup service. Your profile remains saved, and no contact was fabricated.");
    } finally {
      setLookupLoading(false);
    }
  }

  function importCsv(file:File) {
    Papa.parse<Record<string,unknown>>(file, { header:true, skipEmptyLines:true, complete:({data}) => {
      const mapped:Lead[] = data.map(row => {
        const get = (...keys:string[]) => {
          const key = Object.keys(row).find(x => keys.includes(x.toLowerCase().trim()));
          return key ? String(row[key] ?? "").trim() : "";
        };
        const rawStatus = get("status");
        const validStatus = ["New","Contacted","Interested","Converted"].includes(rawStatus) ? rawStatus as Lead["status"] : "New";
        return { id:newId(), name:get("name","full name"), title:get("title","job title","designation"), company:get("company","company name"), industry:get("industry"), city:get("city","location"), email:get("email","work email","professional email"), phone:get("phone","business phone","mobile"), linkedin:get("linkedin","linkedin url","profile url"), status:validStatus, source:"CSV import", emailSource:get("email source"), phoneSource:get("phone source") };
      }).filter(l => l.name || l.linkedin || l.email || l.phone);
      setLeads(prev => {
        const urls = new Set(prev.map(l => cleanUrl(l.linkedin).toLowerCase()).filter(Boolean));
        const fresh = mapped.filter(l => !l.linkedin || !urls.has(cleanUrl(l.linkedin).toLowerCase()));
        return [...fresh,...prev];
      });
      setNotice("CSV import completed. Check the rows and sources before using imported contacts.");
    }, error:(error) => setNotice("CSV import failed: " + error.message) });
  }
  function onFile(event:ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) importCsv(file); event.target.value = ""; }
  function exportCsv() {
    const csv = Papa.unparse(filtered.map(({id,...l}) => l));
    const blob = new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href=url; a.download="weborigin-leads.csv"; a.click(); URL.revokeObjectURL(url);
  }
  const stats = [
    {label:"Total leads",value:leads.length,Icon:Users},
    {label:"New leads",value:leads.filter(l=>l.status==="New").length,Icon:Building2},
    {label:"Emails saved",value:leads.filter(l=>!!l.email).length,Icon:Mail},
    {label:"Phones saved",value:leads.filter(l=>!!l.phone).length,Icon:Phone}
  ];

  return <main className="container">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">W</div><div><div className="brand-title">WebOrigin <span style={{color:"var(--accent)"}}>Lead Finder</span></div><div className="brand-sub">Professional contact discovery workspace</div></div></div>
      <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
        <label className="btn btn-secondary"><Upload size={16}/> Import CSV<input hidden type="file" accept=".csv,text/csv" onChange={onFile}/></label>
        <button className="btn" onClick={()=>setShowAdd(v=>!v)}><Plus size={16}/> Add lead</button>
      </div>
    </header>

    <section className="card lookup">
      <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div><div className="pill"><ShieldCheck size={14}/> Free-source-first design</div><h1 style={{fontSize:"clamp(24px,4vw,36px)",letterSpacing:"-1.1px",margin:"15px 0 7px"}}>Find and organize professional contacts.</h1><p className="section-subtitle" style={{maxWidth:760}}>Start with a LinkedIn profile URL, manage leads, and keep every email or phone tied to its source. The current build manages profiles; enrichment must be connected separately.</p></div>
        <WandSparkles size={28} color="var(--accent)"/>
      </div>
      <form className="lookup-row" onSubmit={runLookup}>
        <input className="field" value={profileUrl} onChange={e=>setProfileUrl(e.target.value)} placeholder="https://www.linkedin.com/in/username/" aria-label="LinkedIn profile URL"/>
        <button className="btn" type="submit" disabled={lookupLoading}><Search size={16}/> {lookupLoading ? "Searching…" : "Find contacts"}</button>
      </form>
      <div className="notice warning"><CheckCircle2 size={17} style={{flex:"none",marginTop:1}}/><div>{lookupNotice}</div></div>
    </section>

    <section className="stats">{stats.map(({label,value,Icon})=><div className="stat" key={label}><div className="stat-icon"><Icon size={20}/></div><div><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div></div>)}</section>

    {showAdd && <section className="card" style={{marginBottom:20}}><h2 className="section-title">Add a lead</h2><p className="section-subtitle">Save a lead or import contact details from a source you are authorized to use.</p><form onSubmit={saveLead}><div className="grid-form">{([
      ["name","Full name"],["title","Job title"],["company","Company"],["industry","Industry"],["city","City / location"],["linkedin","LinkedIn profile URL"],["email","Professional email"],["phone","Business phone"]
    ] as const).map(([key,label])=><input key={key} className="field" placeholder={label} value={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))}/>)}</div><div style={{display:"flex",gap:9,marginTop:13}}><button className="btn" type="submit">Save lead</button><button className="btn btn-secondary" type="button" onClick={()=>setShowAdd(false)}>Cancel</button></div></form></section>}

    <section className="card">
      <div className="toolbar"><div><h2 className="section-title">Lead database</h2><p className="section-subtitle">Search, filter, import, export, and maintain source attribution.</p></div><button className="btn btn-secondary" onClick={exportCsv}><Download size={16}/> Export CSV</button></div>
      <div className="searchbar" style={{marginBottom:16}}>
        <div style={{position:"relative",flex:"1 1 240px"}}><Search size={16} style={{position:"absolute",left:12,top:14,color:"var(--muted)"}}/><input className="field" style={{paddingLeft:38}} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, company, email, phone..."/></div>
        <div style={{position:"relative",minWidth:175}}><Filter size={15} style={{position:"absolute",left:11,top:14,color:"var(--muted)"}}/><select className="field" style={{paddingLeft:32}} value={status} onChange={e=>setStatus(e.target.value)}>{["All statuses","New","Contacted","Interested","Converted"].map(s=><option key={s}>{s}</option>)}</select></div>
      </div>
      <div className="table-wrap"><table><thead><tr>{["Lead","Company","Location","Email & phone","Status","Source",""].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
        {filtered.map(l=><tr key={l.id}>
          <td><div style={{fontWeight:750}}>{l.name || "Unnamed lead"}</div><div className="sub">{l.title || "Title not provided"}</div>{l.linkedin && <a href={l.linkedin} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:7,fontSize:12,color:"var(--accent)",textDecoration:"none"}}><Linkedin size={12}/> Profile</a>}</td>
          <td><div>{l.company || "—"}</div><div className="sub">{l.industry || "—"}</div></td>
          <td>{l.city || "—"}</td>
          <td><div>{l.email || "Email not found"}</div><div className="sub">{l.emailSource ? "Source: "+l.emailSource : ""}</div><div style={{marginTop:7}}>{l.phone || "Phone not found"}</div><div className="sub">{l.phoneSource ? "Source: "+l.phoneSource : ""}</div></td>
          <td><select className="field status-select" aria-label={"Status for "+l.name} value={l.status} onChange={e=>setLeads(p=>p.map(x=>x.id===l.id?{...x,status:e.target.value as Lead["status"]}:x))}>{["New","Contacted","Interested","Converted"].map(s=><option key={s}>{s}</option>)}</select></td>
          <td className="muted">{l.source}</td>
          <td><button className="btn-danger" aria-label={"Delete "+l.name} onClick={()=>setLeads(p=>p.filter(x=>x.id!==l.id))}><Trash2 size={16}/></button></td>
        </tr>)}
      </tbody></table>{filtered.length===0 && <div style={{textAlign:"center",padding:32,color:"var(--muted)"}}>No matching leads. Import a CSV or add a profile above.</div>}</div>
      <div className="notice"><CheckCircle2 size={17} style={{flex:"none",marginTop:1}}/><div>{notice}</div></div>
    </section>

    <footer className="footer">MVP status: lead management and CSV workflows are implemented; contact enrichment and Supabase persistence are not connected yet. This build does not scrape restricted LinkedIn data, bypass provider quotas, or invent contact details. Browser-local data is not shared across devices—export CSV backups before clearing browser storage.</footer>
  </main>;
}
