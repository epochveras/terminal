import { api } from "./api";

let ac = null;
export function unlockAudio() {
  try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); } catch {}
}
export function playAlarm() {
  try {
    unlockAudio(); if (!ac) return;
    const t0 = ac.currentTime;
    [0, 0.22, 0.44, 0.9, 1.12, 1.34].forEach((d, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = i % 3 === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(ac.destination); o.start(t0 + d); o.stop(t0 + d + 0.2);
    });
  } catch {}
}

const decodeKey = (v) => {
  const pad = "=".repeat((4 - (v.length % 4)) % 4);
  const bin = atob((v + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function enablePush(ask = true) {
  if (!pushSupported()) throw new Error("Bu tarayıcı push bildirimi desteklemiyor (iOS'ta uygulamayı ana ekrana ekleyin)");
  const perm = ask ? await Notification.requestPermission() : Notification.permission;
  if (perm !== "granted") throw new Error("Bildirim izni verilmedi");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { data } = await api.get("/push/public-key");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(data.publicKey) });
  }
  const j = sub.toJSON();
  await api.post("/push/subscribe", { endpoint: j.endpoint, keys: j.keys });
  return true;
}
