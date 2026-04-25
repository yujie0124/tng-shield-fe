import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Input } from '../components';
import { useAuth } from '../context/AuthContext';
import './Login.css';

const DEMO_ACCOUNTS = [
  {
    label: 'Fatimah',
    sub: 'Elderly ward · 68',
    phone: '0123456789',
    pin: '111111',
    badge: '👵',
  },
  {
    label: 'Danial',
    sub: 'Child ward · 12',
    phone: '0111234567',
    pin: '333333',
    badge: '🧒',
  },
  {
    label: 'Ahmad',
    sub: 'Guardian (parent / son)',
    phone: '0198765432',
    pin: '222222',
    badge: '🛡️',
  },
];

export default function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(phone, pin);
      const redirect = location.state?.from?.pathname || '/';
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    }
  };

  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="login-logo">🛡</div>
        <h1>TNG Family Shield</h1>
        <p className="muted">Set up a Guardian for the people you love.</p>
      </div>

      <form onSubmit={onSubmit} className="login-form">
        <Input
          label="Phone number"
          type="tel"
          placeholder="01x-xxx xxxx"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <Input
          label="PIN"
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
        />
        {error && <div className="login-error">{error}</div>}
        <Button type="submit" fullWidth loading={loading}>
          Log in
        </Button>
      </form>

      <div className="login-demo">
        <div className="login-demo-title">Try a demo account</div>
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.phone}
            type="button"
            className="login-demo-row"
            onClick={() => {
              setPhone(a.phone);
              setPin(a.pin);
            }}
          >
            <span className="login-demo-badge">{a.badge}</span>
            <span style={{ flex: 1 }}>
              <b>{a.label}</b>
              <div className="muted" style={{ fontSize: 11 }}>{a.sub}</div>
            </span>
            <span className="muted" style={{ fontSize: 11 }}>{a.phone}</span>
          </button>
        ))}
      </div>

      <p className="login-foot muted">
        New here? <a href="#">Create an account</a>
      </p>
    </div>
  );
}
