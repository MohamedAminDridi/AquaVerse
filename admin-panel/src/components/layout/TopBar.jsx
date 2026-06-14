import { useAuthStore }  from '../../store/authStore';
import { useAlertStore }  from '../../store/alertStore';
import { useUiStore }     from '../../store/uiStore';
import { useNavigate, Link } from 'react-router-dom';

export default function TopBar({ navOpen = true, onToggleNav }) {
  const { user, logout } = useAuthStore();
  const unreadCount      = useAlertStore(s => s.unreadCount);
  const theme            = useUiStore(s => s.theme);
  const toggleTheme      = useUiStore(s => s.toggleTheme);
  const nav = useNavigate();

  const handleLogout = () => { logout(); nav('/login'); };
  const iconBtn = 'w-9 h-9 grid place-items-center rounded-lg text-lg leading-none transition-colors';

  return (
    <header className="relative z-10 px-5 py-2.5 flex items-center justify-between"
      style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(14px)' }}>
      <div className="flex items-center gap-3">
        <button onClick={onToggleNav} title={navOpen ? 'Hide menu' : 'Show menu'} className={iconBtn}
          style={{ color: 'var(--text-dim)' }}>{navOpen ? '⮜' : '☰'}</button>
        <div className="hidden sm:flex items-center gap-2 text-[11px] mono text-mute">
          <span className="w-1.5 h-1.5 rounded-full os-live" style={{ background: '#34d399', color: '#34d399' }} />
          SYSTEM ONLINE
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* theme toggle */}
        <button onClick={toggleTheme} title="Toggle theme" className={iconBtn}
          style={{ color: 'var(--text-dim)', background: 'var(--panel)' }}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* alerts */}
        <Link to="/alerts" className={`relative ${iconBtn}`} style={{ color: 'var(--text-dim)', background: 'var(--panel)' }}>
          <span>🔔</span>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 text-white text-[9px] font-bold px-1 rounded-full min-w-[15px] text-center leading-tight"
              style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.6)' }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <div className="flex items-center gap-2 pl-1">
          <div className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold"
            style={{ background: 'rgba(34,211,238,0.15)', color: 'var(--accent)', border: '1px solid var(--border-2)' }}>
            {(user?.name || 'A').charAt(0).toUpperCase()}
          </div>
          <span className="text-sm hidden md:block" style={{ color: 'var(--text-dim)' }}>{user?.name || 'Admin'}</span>
        </div>
        <button onClick={handleLogout}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
          Logout
        </button>
      </div>
    </header>
  );
}
