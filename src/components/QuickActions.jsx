import { useNavigate } from 'react-router-dom';
import './QuickActions.css';

const ACTIONS = [
  { key: 'transfer', label: 'Transfer', icon: '↗', path: '/transfer' },
  { key: 'reload', label: 'Reload', icon: '＋', path: '/reload' },
  { key: 'history', label: 'History', icon: '☰', path: '/history' },
];

export default function QuickActions() {
  const navigate = useNavigate();
  return (
    <div className="quick-actions">
      {ACTIONS.map((a) => (
        <button key={a.key} className="quick-action" onClick={() => navigate(a.path)}>
          <span className="quick-action-icon">{a.icon}</span>
          <span className="quick-action-label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
