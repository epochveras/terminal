import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { errText } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { mode === "login" ? await login(email, password) : await register(email, password, name); }
    catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-5">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center mb-8">
          <img src="/icon-512.png" alt="Epochveras" className="w-24 h-24 rounded-2xl ev-pulse" data-testid="login-logo" />
          <p className="mt-4 text-[13px] text-[#787b86] tracking-[0.2em] uppercase">Futures Terminal</p>
        </div>
        <div className="bg-[#0c0d0f] border border-[#2a2e39] rounded-lg p-6">
          <div className="flex mb-6 border-b border-[#2a2e39]">
            {[["login", "Giriş Yap"], ["register", "Kayıt Ol"]].map(([k, l]) => (
              <button key={k} type="button" data-testid={`auth-tab-${k}`} onClick={() => { setMode(k); setErr(""); }}
                className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === k ? "text-white border-b-2 border-white" : "text-[#787b86] hover:text-[#d1d4dc]"}`}>{l}</button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div><label className="text-xs text-[#787b86]">Ad</label>
                <Input data-testid="auth-name-input" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 bg-black h-11" /></div>
            )}
            <div><label className="text-xs text-[#787b86]">E-posta</label>
              <Input data-testid="auth-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 bg-black h-11" autoComplete="email" /></div>
            <div><label className="text-xs text-[#787b86]">Şifre</label>
              <Input data-testid="auth-password-input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 bg-black h-11" autoComplete={mode === "login" ? "current-password" : "new-password"} /></div>
            {err && <p data-testid="auth-error" className="text-[13px] text-[#f23645]">{err}</p>}
            <Button type="submit" disabled={busy} data-testid={mode === "login" ? "auth-login-submit-button" : "auth-register-submit-button"}
              className="w-full h-11 bg-white hover:bg-[#d1d4dc] text-black">{busy ? "Bekleyin…" : mode === "login" ? "Giriş Yap" : "Kayıt Ol"}</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
