import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, PageHeader } from '../components';
import { familyShieldService } from '../services';

function fmtRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

const SUGGESTED_FOR = {
  police_impersonation: [
    "Mama, who told you to send this money?",
    "Please hang up the phone now. I'm calling you.",
    "Police never ask you to transfer money to verify your IC.",
  ],
  child_impulse_purchase: [
    "Hey buddy, what's this for?",
    "Remember our weekly limit — let's pick a smaller pack.",
    "Let's discuss when I'm home.",
  ],
  default: [
    "Are you sure about this transfer?",
    "Who asked you to send this money?",
    "I'll call you in 1 minute.",
  ],
};

function aiSuggestedAction(level) {
  switch (level) {
    case 'critical':
      return {
        action: 'block',
        label: 'Block transfer',
        verb: 'Block immediately',
        tone: 'danger',
        icon: '⛔',
        rationale: "Risk score is critical — don't release the funds.",
      };
    case 'high':
      return {
        action: 'call',
        label: 'Call ward to verify',
        verb: 'Call ward first',
        tone: 'warn',
        icon: '📞',
        rationale: 'High risk — confirm with the ward by voice before deciding.',
      };
    case 'medium':
      return {
        action: 'call',
        label: 'Call ward to verify',
        verb: 'Call ward first',
        tone: 'warn',
        icon: '📞',
        rationale: 'Looks suspicious — a quick call should clear it up.',
      };
    case 'low':
    default:
      return {
        action: 'approve',
        label: 'Approve',
        verb: 'Safe to approve',
        tone: 'safe',
        icon: '✓',
        rationale: 'No major red flags detected.',
      };
  }
}

export default function ShieldReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [decideMessage, setDecideMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
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

  const send = async (preset) => {
    const body = preset || text;
    if (!body.trim()) return;
    setSending(true);
    try {
      await familyShieldService.addClarification(id, body);
      if (!preset) setText('');
      const r = await familyShieldService.getReview(id);
      setReview(r);
    } finally {
      setSending(false);
    }
  };

  const decide = async (decision) => {
    setSubmitting(true);
    try {
      const r = await familyShieldService.decideReview(
        id,
        decision,
        decideMessage || (decision === 'block' ? 'Blocked by guardian' : 'Approved by guardian'),
      );
      setDone(r);
    } finally {
      setSubmitting(false);
    }
  };

  if (!review) {
    return (
      <div className="page">
        <PageHeader title="Review" />
        <div className="muted">Review not found.</div>
      </div>
    );
  }

  if (done) {
    const blocked = done.status === 'blocked';
    return (
      <div className="page result-screen result-safe">
        <div className="result-icon result-icon-safe">✓</div>
        <h2 className="result-title">
          {blocked ? 'Transfer blocked' : 'Transfer approved'}
        </h2>
        <p className="result-sub">
          {blocked
            ? `You just protected RM ${done.amount.toLocaleString()} of ${review.fromShortName || review.fromName}'s money.`
            : `RM ${done.amount.toLocaleString()} sent to ${done.recipientName || done.recipientPhone}.`}
        </p>
        {blocked && (
          <Card>
            <div className="muted" style={{ fontSize: 11 }}>Suggested next step</div>
            <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              {review.fromShortName || review.fromName} may still be on the call with the
              scammer. Call now to make sure they hang up.
            </div>
          </Card>
        )}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button fullWidth onClick={() => navigate('/shield', { replace: true })}>
            📞 Call {review.fromShortName || review.fromName} now
          </Button>
          <Button variant="ghost" fullWidth onClick={() => navigate('/', { replace: true })}>
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  const ai = review.aiRiskReport || {};
  const ends = new Date(review.coolOffEndsAt).getTime();
  const remaining = ends - now;
  const totalMs = (review.coolOffMinutes || 5) * 60 * 1000;
  const elapsedRatio = Math.min(1, Math.max(0, 1 - remaining / totalMs));
  const suggested = SUGGESTED_FOR[ai.matchedScamPattern] || SUGGESTED_FOR.default;
  const suggestion = aiSuggestedAction(ai.level);
  const wardShortName = review.fromShortName || review.fromName;
  const wardPhone = review.fromPhone;

  const callWard = () => {
    if (wardPhone) {
      window.location.href = `tel:${wardPhone}`;
    }
    // log the call as a clarification so it shows in the chat history
    familyShieldService
      .addClarification(id, `📞 Called ${wardShortName} to verify`)
      .then(() => familyShieldService.getReview(id))
      .then((r) => r && setReview(r))
      .catch(() => {});
  };

  return (
    <div className="page">
      <PageHeader title={`Review · ${review.fromShortName || review.fromName}`} />

      <div className="review-hero">
        <div className="review-hero-left">
          <div className="muted" style={{ fontSize: 11 }}>Amount</div>
          <div className="review-amount">RM {review.amount.toLocaleString()}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>To</div>
          <div className="review-recipient">
            {review.recipientName || review.recipientPhone}
            {review.recipientName && (
              <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                {review.recipientPhone}
              </div>
            )}
          </div>
          {review.note && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>
              "{review.note}"
            </div>
          )}
        </div>
        <div className="review-hero-right">
          <CoolOffRing remaining={remaining} ratio={elapsedRatio} />
        </div>
      </div>

      <div className={`ai-decision ai-decision-${suggestion.tone}`}>
        <div className="ai-decision-icon-wrap">
          <div className="ai-decision-icon">{suggestion.icon}</div>
          <div className="ai-decision-bot">🤖</div>
        </div>
        <div className="ai-decision-body">
          <div className="ai-decision-label">AI suggested decision</div>
          <div className="ai-decision-action">{suggestion.verb}</div>
          <div className="ai-decision-reason">{ai.recommendation || suggestion.rationale}</div>
        </div>
      </div>

      <h2 className="section-title">🤖 AI Risk Report</h2>
      <Card>
        <div className={`risk-summary risk-${ai.level || 'low'}`}>
          <div className="risk-summary-row">
            <RiskScoreGauge score={ai.score ?? 0} level={ai.level || 'low'} />
            <div style={{ flex: 1 }}>
              <div className="risk-level-tag">
                {(ai.level || 'low').toUpperCase()} RISK
              </div>
              {ai.matchedScamPatternLabel && (
                <div className="risk-pattern">⚠ {ai.matchedScamPatternLabel}</div>
              )}
              <div className="risk-summary-text">{ai.summary || 'No summary.'}</div>
            </div>
          </div>
        </div>

        <div className="risk-factors">
          <div className="muted" style={{ fontSize: 11, margin: '12px 0 6px' }}>
            Risk factors detected
          </div>
          {(ai.factors || []).map((f) => (
            <div key={f.id} className={`risk-factor sev-${f.severity}`}>
              <div className="risk-factor-bar">
                <div
                  className="risk-factor-fill"
                  style={{ width: `${Math.min(100, (f.weight || 0) * 2.5)}%` }}
                />
              </div>
              <div className="risk-factor-text">
                <div className="risk-factor-label">{f.label}</div>
                <div className="risk-factor-meta">
                  {f.severity?.toUpperCase()} · weight {f.weight}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="risk-recommendation">
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
            AI recommendation
          </div>
          <div>{ai.recommendation}</div>
        </div>
      </Card>

      <h2 className="section-title">
        💬 Clarify with {review.fromShortName || review.fromName}
      </h2>
      <Card padded={false}>
        <div className="chat-window">
          {(review.clarifications || []).length === 0 && (
            <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>
              Ask before deciding. The cool-off gives you time to confirm with the family member.
            </div>
          )}
          {(review.clarifications || []).map((m) => (
            <div
              key={m.id}
              className={`chat-bubble chat-${m.from === 'guardian' ? 'self' : 'other'}`}
            >
              <div className="chat-from">{m.fromName || (m.from === 'guardian' ? 'You' : 'Ward')}</div>
              <div className="chat-text">{m.text}</div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="chat-suggested">
          {suggested.map((s) => (
            <button
              key={s}
              className="chat-suggested-chip"
              onClick={() => send(s)}
              disabled={sending}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="chat-input-row">
          <input
            className="chat-input"
            placeholder={`Ask ${review.fromShortName || 'them'} something…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="chat-send" disabled={sending || !text.trim()} onClick={() => send()}>
            ↑
          </button>
        </div>
      </Card>

      <h2 className="section-title">Decide</h2>
      <Card>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          Final message to {review.fromShortName || review.fromName}
        </div>
        <textarea
          value={decideMessage}
          onChange={(e) => setDecideMessage(e.target.value)}
          rows={2}
          placeholder={
            ai.matchedScamPattern === 'police_impersonation'
              ? 'Mama, this is a scam. I\'m calling you now.'
              : 'Optional message…'
          }
          style={{
            width: '100%',
            border: '1px solid var(--tng-border)',
            borderRadius: 10,
            padding: 10,
            outline: 'none',
            resize: 'vertical',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      </Card>

      <div className="decide-stack">
        <button
          className={`decide-btn decide-btn-call ${suggestion.action === 'call' ? 'decide-btn-recommended' : ''}`}
          onClick={callWard}
          disabled={submitting || !wardPhone}
        >
          {suggestion.action === 'call' && (
            <span className="decide-ai-badge">🤖 AI suggests</span>
          )}
          <span className="decide-btn-icon">📞</span>
          <span className="decide-btn-text">
            <span className="decide-btn-title">Call {wardShortName}</span>
            <span className="decide-btn-sub">
              {wardPhone ? `Verify by phone · ${wardPhone}` : 'No phone on file'}
            </span>
          </span>
        </button>

        <div className="decide-row">
          <button
            className={`decide-btn decide-btn-block ${suggestion.action === 'block' ? 'decide-btn-recommended' : ''}`}
            onClick={() => decide('block')}
            disabled={submitting}
          >
            {suggestion.action === 'block' && (
              <span className="decide-ai-badge">🤖 AI</span>
            )}
            <span className="decide-btn-icon">⛔</span>
            <span className="decide-btn-title">Decline</span>
          </button>
          <button
            className={`decide-btn decide-btn-approve ${suggestion.action === 'approve' ? 'decide-btn-recommended' : ''}`}
            onClick={() => decide('approve')}
            disabled={submitting}
          >
            {suggestion.action === 'approve' && (
              <span className="decide-ai-badge">🤖 AI</span>
            )}
            <span className="decide-btn-icon">✓</span>
            <span className="decide-btn-title">Approve</span>
          </button>
        </div>
      </div>
      <div className="muted" style={{ textAlign: 'center', fontSize: 11, marginTop: 8 }}>
        Ward's funds stay frozen until you decide. Cool-off ends in {fmtRemaining(remaining)}.
      </div>
    </div>
  );
}

function CoolOffRing({ remaining, ratio }) {
  return (
    <div className="cooloff-ring cooloff-ring-sm" style={{ '--p': ratio }}>
      <div className="cooloff-ring-inner">
        <div className="cooloff-time">{fmtRemaining(remaining)}</div>
        <div className="cooloff-time-sub">cool-off</div>
      </div>
    </div>
  );
}

function RiskScoreGauge({ score, level }) {
  return (
    <div className={`risk-gauge risk-${level}`}>
      <div className="risk-gauge-num">{score}</div>
      <div className="risk-gauge-of">/100</div>
    </div>
  );
}
