import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, PageHeader } from '../components';
import { walletService } from '../services';

const QUICK_AMOUNTS = [10, 30, 50, 100, 200, 500];
const METHODS = [
  { id: 'fpx', label: 'FPX Online Banking' },
  { id: 'card', label: 'Debit / Credit Card' },
];

export default function Reload() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('fpx');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      await walletService.reload(value, method);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Reload failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Reload" />
      <form onSubmit={onSubmit}>
        <Card>
          <Input
            label="Amount (RM)"
            type="number"
            inputMode="decimal"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {QUICK_AMOUNTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(String(v))}
                style={{
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  background: amount === String(v) ? 'var(--tng-blue)' : 'var(--tng-blue-bg)',
                  color: amount === String(v) ? '#fff' : 'var(--tng-blue)',
                  fontWeight: 600,
                }}
              >
                RM {v}
              </button>
            ))}
          </div>
        </Card>

        <h2 className="section-title">Payment Method</h2>
        <Card padded={false}>
          {METHODS.map((m) => (
            <label
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderBottom: '1px solid var(--tng-border)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="method"
                value={m.id}
                checked={method === m.id}
                onChange={(e) => setMethod(e.target.value)}
                style={{ accentColor: 'var(--tng-blue)' }}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </Card>

        {error && <div style={{ color: 'var(--tng-danger)', marginTop: 12 }}>{error}</div>}

        <div style={{ marginTop: 20 }}>
          <Button type="submit" fullWidth loading={submitting}>
            Reload Now
          </Button>
        </div>
      </form>
    </div>
  );
}
