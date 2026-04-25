import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { familyShieldService } from '../services';
import './BottomNav.css';

const TABS = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/scan', label: 'Pay', icon: '⌖' },
  { to: '/shield', label: 'Shield', icon: '⛨' },
  { to: '/history', label: 'History', icon: '☰' },
  { to: '/profile', label: 'Profile', icon: '☺' },
];

export default function BottomNav() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const s = await familyShieldService.getStatus();
        if (!mounted) return;
        // Only guardians get the "pending review" badge — wards see their
        // own cool-off banner on Home, not a notification badge.
        if (s?.role === 'guardian') {
          setPendingCount((s.pending || []).length);
        } else {
          setPendingCount(0);
        }
      } catch {
        // ignore
      }
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="bottom-nav-icon-wrap">
            <span className="bottom-nav-icon">{t.icon}</span>
            {t.to === '/shield' && pendingCount > 0 && (
              <span className="bottom-nav-badge">{pendingCount}</span>
            )}
          </span>
          <span className="bottom-nav-label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
