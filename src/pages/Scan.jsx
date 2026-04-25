import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, PageHeader } from '../components';
import { walletService } from '../services';

export default function Scan() {
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await walletService.pay({ merchantId, amount: Number(amount) });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Scan & Pay" />

      <Card padded={false} className="" >
        <div
          style={{
            aspectRatio: '1 / 1',
            background: 'linear-gradient(135deg, #001b3d, #003a7a)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-md)',
            position: 'relative',
          }}
        >
          <div style={{ textAlign: 'center', opacity: 0.85 }}>
            <div style={{ fontSize: 48 }}>⌖</div>
            <div style={{ fontSize: 13 }}>Camera preview placeholder</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
              (wire up @zxing/browser or html5-qrcode)
            </div>
          </div>
        </div>
      </Card>

      <h2 className="section-title">Or pay manually</h2>
      <form onSubmit={onSubmit}>
        <Card>
          <Input
            label="Merchant ID"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            placeholder="e.g. MERCH-12345"
            required
          />
          <Input
            label="Amount (RM)"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Card>

        {error && <div style={{ color: 'var(--tng-danger)', marginTop: 12 }}>{error}</div>}

        <div style={{ marginTop: 20 }}>
          <Button type="submit" fullWidth loading={submitting}>
            Pay
          </Button>
        </div>
      </form>
    </div>
  );
}
