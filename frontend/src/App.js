import { useEffect, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Splash } from "@/components/Splash";
import Login from "@/pages/Login";
import Terminal from "@/pages/Terminal";

// Wait for backend to be awake; keep retrying while showing the logo
function BackendGate({ children }) {
  const [ok, setOk] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let alive = true;
    const ping = () => api.get("/health", { timeout: 8000 }).then(() => alive && setOk(true)).catch(() => { if (alive) { setTries((t) => t + 1); setTimeout(ping, 2500); } });
    ping();
    return () => { alive = false; };
  }, []);
  if (!ok) return <Splash text={tries > 1 ? "Sunucu uyanıyor, veriler yükleniyor…" : "Veriler yükleniyor…"} />;
  return children;
}

function Guard({ children }) {
  const { user } = useAuth();
  if (user === null) return <Splash />;
  return user ? children : <Navigate to="/login" replace />;
}
function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return <Splash />;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <BackendGate>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/*" element={<Guard><Terminal /></Guard>} />
          </Routes>
        </BrowserRouter>
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </AuthProvider>
    </BackendGate>
  );
}
