import { create } from 'zustand';

// Theme: 'dark' (home) | 'light'. Persisted + applied as a class on <html> so
// the CSS variables in index.css switch the whole app. index.html sets the
// initial class before paint to avoid a flash.
const read = () => { try { return localStorage.getItem('av_theme') || 'dark'; } catch { return 'dark'; } };
const applyTheme = (t) => {
  const el = document.documentElement;
  el.classList.remove('dark', 'light');
  el.classList.add(t);
  try { localStorage.setItem('av_theme', t); } catch { /* ignore */ }
};

export const useUiStore = create((set, get) => ({
  theme: read(),
  cmdOpen: false,                                   // command palette (⌘K)
  setTheme: (t) => { applyTheme(t); set({ theme: t }); },
  toggleTheme: () => { const t = get().theme === 'dark' ? 'light' : 'dark'; applyTheme(t); set({ theme: t }); },
  setCmdOpen: (v) => set({ cmdOpen: v }),
}));
