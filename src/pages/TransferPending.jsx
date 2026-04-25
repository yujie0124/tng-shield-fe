import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, PageHeader } from '../components';
import { familyShieldService } from '../services';
import { useAuth } from '../context/AuthContext';

function fmtRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function TransferPending() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [review, setReview] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      const r = await familyShieldService.getReview(id);
      if (!mounted) return;
      setReview(r);
      setNow(Date.now());
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [review?.clarifications?.length]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await familyShieldService.addClarification(id, text);
      setText('');
      const r = await familyShieldService.getReview(id);
      setReview(r);
    } finally {
      setSending(false);
    }
  };

  if (!review) {
    return (
      <div className="page">
        <PageHeader title="Transfer" />
        <div className="muted">Review not found.</div>
      </div>
    );
  }

  if (review.status === 'blocked' || review.status === 'expired') {
    const expired = review.status === 'expired';
    return (
      <div className="page result-screen result-safe">
        <div className="result-icon result-icon-safe">✓</div>
        <h2 className="result-title">Transfer blocked safely</h2>
        <p className="result-sub">
          {expired
            ? 'Cool-off ended without a guardian decision, so we kept your money safe.'
            : 'Your guardian reviewed this transfer and blocked it.'}
          {' '}
          Your <b>RM {review.amount.toLocaleString()}</b> is safe in your wallet.
        </p>
        {review.guardianMessage && (
          <div className="result-message">
            <div className="muted" style={{ fontSize: 11 }}>Message from guardian:</div>
            <div style={{ fontStyle: 'italic', marginTop: 4 }}>"{review.guardianMessage}"</div>
          </div>
        )}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button fullWidth onClick={() => navigate('/', { replace: true })}>Back to home</Button>
          <Button variant="ghost" fullWidth onClick={() => navigate('/shield')}>View shield activity</Button>
        </div>
      </div>
    );
  }

  if (review.status === 'approved') {
    return (
      <div className="page result-screen result-safe">
        <div className="result-icon result-icon-safe">✓</div>
        <h2 className="result-title">Transfer approved</h2>
        <p className="result-sub">
          Your guardian approved your RM {review.amount.toLocaleString()} transfer.
        </p>
        {review.guardianMessage && (
          <div className="result-message">
            <div className="muted" style={{ fontSize: 11 }}>Message from guardian:</div>
            <div style={{ fontStyle: 'italic', marginTop: 4 }}>"{review.guardianMessage}"</div>
          </div>
        )}
        <Button fullWidth onClick={() => navigate('/', { replace: true })} style={{ marginTop: 20 }}>
          Back to home
        </Button>
      </div>
    );
  }

  const ends = new Date(review.coolOffEndsAt).getTime();
  const remaining = ends - now;
  const totalMs = (review.coolOffMinutes || 5) * 60 * 1000;
  const elapsedRatio = Math.min(1, Math.max(0, 1 - remaining / totalMs));
  const ai = review.aiRiskReport;

  return (
    <div className="page result-warn-page">
      <PageHeader title="Cool-off review" />

      <div className="cooloff-hero">
        <div className="cooloff-ring" style={{ '--p': elapsedRatio }}>
          <div className="cooloff-ring-inner">
            <div className="cooloff-time">{fmtRemaining(remaining)}</div>
            <div className="cooloff-time-sub">cool-off</div>
          </div>
        </div>
        <div className="cooloff-title">Hold on — {user?.shortName || 'we'} got you</div>
        <div className="cooloff-sub">
          Your guardian is reviewing this RM {review.amount.toLocaleString()} transfer.
        </div>
      </div>

      <Card>
        <div className="muted" style={{ fontSize: 11 }}>Why we paused this</div>
        <div style={{ fontWeight: 600, marginTop: 6 }}>
          {ai?.matchedScamPatternLabel ? `⚠ ${ai.matchedScamPatternLabel}` : `Above your RM ${review.thresholdAtRequest} threshold`}
        </div>
        <div style={{ marginTop: 8 }}>
          {(ai?.factors || []).slice(0, 3).map((f) => (
            <div key={f.id} className="result-flag">
              <span className={`result-flag-dot sev-${f.severity}`} />
              <span style={{ fontSize: 13 }}>{f.label}</span>
            </div>
          ))}
        </div>
      </Card>

      {ai?.matchedScamPattern === 'police_impersonation' && (
        <div className="result-card result-warn-box">
          <div className="result-warn-title">Important</div>
          <div className="result-warn-body">
            Police never ask you to transfer money to verify your identity. If someone is on
            the phone telling you to do this, it is a scam.
          </div>
        </div>
      )}

      <h2 className="section-title">Talk to your guardian</h2>
      <Card padded={false}>
        <div className="chat-window">
          {(review.clarifications || []).length === 0 && (
            <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>
              Your guardian may ask questions before deciding. Reply here.
            </div>
          )}
          {(review.clarifications || []).map((m) => (
            <div key={m.id} className={`chat-bubble chat-${m.from === 'ward' ? 'self' : 'other'}`}>
              <div className="chat-from">{m.fromName || (m.from === 'ward' ? 'You' : 'Guardian')}</div>
              <div className="chat-text">{m.text}</div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-input-row">
          <input
            className="chat-input"
            placeholder="Reply to guardian…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="chat-send" disabled={sending || !text.trim()} onClick={send}>
            ↑
          </button>
        </div>
      </Card>
    </div>
  );
}
