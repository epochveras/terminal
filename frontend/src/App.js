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
  const [lastErr, setLastErr] = useState("");

  useEffect(() => {
    let alive = true;
    const ping = () =>
      api
        .get("/health", { timeout: 12000 })
        .then(() => {
          if (alive) setOk(true);
        })
        .catch((err) => {
          if (alive) {
            const code = err?.response?.status ? `HTTP ${err.response.status}` : "";
            const msg = err?.message || "Network Error";
            setLastErr(code ? `${code} (${msg})` : msg);
            setTries((t) => t + 1);
            setTimeout(ping, 2500);
          }
        });

    ping();
    return () => {
      alive = false;
    };
  }, []);

  if (!ok) {
    return (
      <Splash
        text={
          tries > 1
            ? `Sunucu uyanıyor, veriler yükleniyor…${lastErr ? ` [${lastErr}]` : ""}`
            : "Veriler yükleniyor…"
        }
      />
    );
  }

  return children;
}

function Guard({ children }) {
  const { user } = useAuth();
  if (user === null) return <Splash text="Oturum kontrol ediliyor…" />;
  return user ? children : <Navigate to="/login" replace />;
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return <Splash text="Oturum kontrol ediliyor…" />;
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
