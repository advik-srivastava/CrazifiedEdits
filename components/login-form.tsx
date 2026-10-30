"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
export function LoginForm({denied=false}:{denied?:boolean}){
  const router=useRouter();
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");
  const [visible,setVisible]=useState(false);const [error,setError]=useState(denied?"That account isn't authorised to manage CrazifiedEdits. Sign in with the studio admin account.":"");const [loading,setLoading]=useState(false);
  async function login(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError("");setLoading(true);
    try {
      const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if(!url||!key)throw new Error("Supabase is not configured. See README.md.");
      const supabase=createBrowserClient(url,key);
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw new Error("Unable to sign in. Check the admin email and password.");
      router.replace("/admin");router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"Unable to sign in.");}finally{setLoading(false);}
  }
  return <form className="login-form" onSubmit={login}><div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required/></div><div className="field"><label htmlFor="password">Password</label><div className="password-wrap"><input id="password" type={visible?"text":"password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e=>setPassword(e.target.value)} required/><button type="button" className="show-password" aria-label={visible?"Hide password":"Show password"} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></div>{error&&<div className="login-error" role="alert">{error}</div>}<button className="button primary login-submit" type="submit" disabled={loading}>{loading?"Signing in...":"Sign in to workspace"}<ArrowRight size={18}/></button><div className="login-footnote"><ShieldCheck size={15}/>Only the approved admin account can make changes</div></form>;
}
