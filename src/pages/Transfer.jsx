import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, Input, PageHeader } from '../components';
import { walletService, familyShieldService } from '../services';

export default function Transfer() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = location.state?.prefill;

  const [recipientPhone, setRecipientPhone] = useState(prefill?.recipientPhone || '');
  const [amount, setAmount] = useState(prefill?.amount || '');
  const [note, setNote] = useState(prefill?.note || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [scamCall, setScamCall] = useState(false);
  const [shield, setShield] = useState(null);

  useEffect(() => {
    setScamCall(familyShieldService.getScamCallActive());
    familyShieldService.getStatus().then(setShield);
  }, []);

  const numAmount = Number(amount) || 0;
  const willTrigger =
    shield?.role === 'ward' && shield.threshold && numAmount >= shield.threshold;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await walletService.transfer({
        recipientPhone,
        amount: Number(amount),
        note,
      });
      if (res?.status === 'pending_review') {
        navigate(`/transfer/pending/${res.reviewId}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      {scamCall && (
        <div className="scam-call-banner">
          <span className="scam-call-dot" />
          Call in progress: "Sergeant Rahman" 47:12
        </div>
      )}
      <PageHeader title="Transfer" />

      {shield?.role === 'ward' && shield.threshold && (
        <div className="threshold-info">
          <span>🛡</span>
          <div>
            Transfers above <b>RM {shield.threshold.toLocaleString()}</b> pause for a{' '}
            <b>{shield.coolOffMinutes} min</b> guardian review.
          </div>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <Card>
          <Input
            label="Recipient phone"
            type="tel"
            placeholder="01x-xxx xxxx"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
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
          <Input
            label="Note (optional)"
            type="text"
            maxLength={80}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Card>

        {willTrigger && (
          <div className="threshold-warn">
            ⏱ This transfer will pause for guardian review ({shield.coolOffMinutes} min).
          </div>
        )}

        {prefill && (
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            New recipient: BUKIT AMAN VERIFY · MAYBANK
          </div>
        )}

        {error && <div style={{ color: 'var(--tng-danger)', marginTop: 12 }}>{error}</div>}

        <div style={{ marginTop: 20 }}>
          <Button type="submit" fullWidth loading={submitting}>
            {willTrigger ? 'Submit for guardian review' : 'Confirm transfer'}
          </Button>
        </div>
      </form>
    </div>
  );
}
