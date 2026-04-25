import { useNavigate } from 'react-router-dom';
import { Button, Card, PageHeader } from '../components';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="page">
      <PageHeader title="Profile" showBack={false} />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--tng-blue)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            {(user?.name || 'U').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>{user?.name || 'User'}</div>
            <div className="muted" style={{ fontSize: 13 }}>{user?.phone || '—'}</div>
          </div>
        </div>
      </Card>

      <h2 className="section-title">Account</h2>
      <Card padded={false}>
        {['Personal information', 'Security & PIN', 'Linked accounts', 'Notifications'].map((label, i, arr) => (
          <div
            key={label}
            style={{
              padding: '14px 16px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--tng-border)' : 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{label}</span>
            <span className="muted">›</span>
          </div>
        ))}
      </Card>

      <div style={{ marginTop: 20 }}>
        <Button variant="danger" fullWidth onClick={onLogout}>
          Log out
        </Button>
      </div>
    </div>
  );
}
