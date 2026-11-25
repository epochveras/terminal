
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null checking, false = logged out

  useEffect(() => {
    if (!localStorage.getItem("ev_token")) return setUser(false);

    api.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch((e) => {
        if (e?.response?.status === 401) {
          localStorage.removeItem("ev_token");
          setUser(false);
        } else {
          setUser(JSON.parse(localStorage.getItem("ev_user") || "false"));
        }
      });
  }, []);

  const done = (data) => {
    localStorage.setItem("ev_token", data.token);
    localStorage.setItem("ev_user", JSON.stringify(data.user));
    setUser(data.user);
  };

  const login = async (email, password) =>
    done((await api.post("/auth/login", { email, password })).data);

  const register = async (email, password, name) =>
    done((await api.post("/auth/register", { email, password, name })).data);

  const logout = () => {
    localStorage.removeItem("ev_token");
    localStorage.removeItem("ev_user");
    localStorage.removeItem("ev_ws");
    setUser(false);
  };

  return (
    <Ctx.Provider value={{ user, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}
