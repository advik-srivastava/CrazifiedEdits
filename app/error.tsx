"use client";
export default function ErrorPage({reset}:{error:Error,reset:()=>void}) {return <main className="centered"><div className="auth-panel"><span className="overline">CRAZIFIEDEDITS</span><h1>Something went wrong</h1><p className="muted">Check your database connection or try again.</p><button className="button primary" onClick={reset}>Try again</button></div></main>}
