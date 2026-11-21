export const Splash = ({ text = "Veriler yükleniyor…", overlay = false }) => (
  <div data-testid="loading-splash" className={`${overlay ? "absolute inset-0 z-20 bg-black/85" : "fixed inset-0 z-50 bg-black"} flex flex-col items-center justify-center gap-5`}>
    <div className="relative">
      <div className="absolute inset-0 rounded-3xl bg-white/10 blur-2xl ev-pulse" />
      <img src="/icon-5122.png" alt="Epochveras" className={`${overlay ? "w-20 h-20" : "w-28 h-28"} relative rounded-3xl object-contain ev-pulse`} />
    </div>
    <div className="flex items-center gap-2 text-[13px] text-[#b2b5be] tracking-wide">
      <span className="ev-dot" /><span className="ev-dot" style={{ animationDelay: ".15s" }} /><span className="ev-dot" style={{ animationDelay: ".3s" }} />
      <span className="ml-1" data-testid="loading-text">{text}</span>
    </div>
  </div>
);
