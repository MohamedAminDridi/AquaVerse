import { NavLink }       from 'react-router-dom';
import { useAlertStore } from '../../store/alertStore';

const links = [
  { to: '/twin',       label: 'AquaVerse',    icon: '🌊'  },
  { to: '/dashboard',  label: 'Dashboard',    icon: '▦'  },
  { to: '/farms',      label: 'Farms',        icon: '🗺'  },
  { to: '/gateways',   label: 'Gateways',     icon: '📡'  },
  { to: '/nodes',      label: 'Nodes',        icon: '🔌'  },
  { to: '/alerts',     label: 'Alerts',       icon: '🔔', badge: true },
  { to: '/analytics',  label: 'Analytics',    icon: '📊'  },
  
  { to: '/users',      label: 'Users',        icon: '👥'  },
  { to: '/ota',        label: 'OTA Updates',  icon: '☁'  },
  { to: '/settings',   label: 'Settings',     icon: '⚙'  },
];

export default function Sidebar() {
  const unreadCount = useAlertStore(s => s.unreadCount);

  return (
    <aside className="relative z-10 w-56 flex flex-col" style={{ background: 'var(--panel-2)', borderRight: '1px solid var(--border)', backdropFilter: 'blur(14px)' }}>
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-lg">🌊</span>
        <span className="font-bold text-sm tracking-wide" style={{ color: 'var(--text)' }}>Aqua<span style={{ color: 'var(--accent)' }}>Verse</span></span>
      </div>
      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {links.map(l => (
          <NavLink key={l.to} to={l.to}
            className="group flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all relative"
            style={({ isActive }) => ({
              color: isActive ? 'var(--text)' : 'var(--text-dim)',
              background: isActive ? 'var(--panel)' : 'transparent',
              boxShadow: isActive ? 'inset 2px 0 0 var(--accent)' : 'none',
            })}>
            <span className="text-base">{l.icon}</span>
            <span className="flex-1">{l.label}</span>
            {l.badge && unreadCount > 0 && (
              <span className="text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none"
                style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.6)' }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 text-[10px] text-mute mono" style={{ borderTop: '1px solid var(--border)' }}>AQUAVERSE OS · v2</div>
    </aside>
  );
}
