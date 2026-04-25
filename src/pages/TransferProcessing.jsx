import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components';
import { walletService } from '../services';
import './TransferProcessing.css';

const MIN_SPINNER_MS = 1200;

export default function TransferProcessing() {
  const navigate = useNavigate();
  const location = useLocation();
  const transferReq = location.state?.transfer;

  const [phase, setPhase] = useState('checking');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const startedRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!transferReq) {
      navigate('/transfer', { replace: true });
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const startedAt = Date.now();

    (async () => {
      try {
        const res = await walletService.transfer(transferReq);
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_SPINNER_MS) {
          await new Promise((r) => setTimeout(r, MIN_SPINNER_MS - elapsed));
        }
        if (!aliveRef.current) return;

        if (res?.status === 'pending_review') {
          navigate(`/transfer/pending/${res.reviewId}`, { replace: true });
          return;
        }
        if (res?.status === 'blocked') {
          setResult(res);
          setPhase('blocked');
          return;
        }
        setResult(res);
        setPhase('approved');
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err.response?.data?.message || 'Transfer failed');
        setPhase('error');
      }
    })();

    return () => {
      aliveRef.current = false;
    };
  }, [transferReq, navigate]);

  const amountStr = Number(transferReq?.amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (phase === 'checking') {
    return (
      <div className="tp-page">
        <div className="tp-spinner" />
        <h2 className="tp-title">Checking with TNGD<sup>2</sup>…</h2>
        <p className="tp-sub">
          Verifying recipient against the watchlists with TNGD<sup>2</sup>.
        </p>
        <div className="tp-meta">
          RM {amountStr} → {transferReq?.recipientPhone}
        </div>
        <ul className="tp-steps">
          <li className="tp-step active">Recipient lookup</li>
          <li className="tp-step active">Watchlist match</li>
          <li className="tp-step active">Behaviour & risk score</li>
        </ul>
      </div>
    );
  }

  if (phase === 'approved') {
    const ai = result?.aiRiskReport;
    const aboveThreshold = result?.aboveThreshold;
    const thresholdLabel = result?.threshold
      ? `RM ${Number(result.threshold).toLocaleString()}`
      : null;
    return (
      <div className="tp-page tp-result tp-approved">
        <div className="tp-result-icon tp-icon-good">✓</div>
        <h2 className="tp-result-title">Transfer successful</h2>
        <p className="tp-result-sub">
          RM {amountStr} sent to {transferReq?.recipientPhone}.
        </p>
        {aboveThreshold && (
          <div className="tp-threshold-alert">
            <span className="tp-threshold-icon">🛡</span>
            <div className="tp-threshold-text">
              <b>Above your {thresholdLabel || 'usual'} limit.</b>{' '}
              {result?.guardianAlerted
                ? 'Your guardian has been notified with the full AI risk report.'
                : 'Saved a high-value record for your guardian to review later.'}
            </div>
          </div>
        )}
        <RiskReportCard ai={ai} variant="approved" />
        <div className="tp-result-card">
          <div className="tp-result-row">
            <span>Status</span>
            <b style={{ color: 'var(--tng-success)' }}>
              {aboveThreshold ? 'Auto-approved · guardian alerted' : 'Auto-approved'}
            </b>
          </div>
          <div className="tp-result-row">
            <span>Reference</span>
            <span className="tp-result-mono">{result?.txId || '—'}</span>
          </div>
          {transferReq?.note && (
            <div className="tp-result-row">
              <span>Note</span>
              <span>{transferReq.note}</span>
            </div>
          )}
        </div>
        <Button
          fullWidth
          onClick={() => navigate('/', { replace: true })}
          style={{ marginTop: 20 }}
        >
          Back to home
        </Button>
      </div>
    );
  }

  if (phase === 'blocked') {
    const ai = result?.aiRiskReport;
    return (
      <div className="tp-page tp-result tp-blocked">
        <div className="tp-result-icon tp-icon-bad">✕</div>
        <h2 className="tp-result-title">Transfer blocked</h2>
        <p className="tp-result-sub">
          {ai?.summary || 'This transfer was blocked for your safety.'}
        </p>
        {ai?.sources?.length > 0 && (
          <div className="tp-source-row">
            {ai.sources.map((s) => (
              <span key={s} className="tp-source-pill">
                {s}
              </span>
            ))}
          </div>
        )}
        <RiskReportCard ai={ai} variant="blocked" />
        <div className="tp-result-card">
          <div className="tp-result-row">
            <span>Amount</span>
            <b>RM {amountStr}</b>
          </div>
          <div className="tp-result-row">
            <span>Reference</span>
            <span className="tp-result-mono">{result?.txId || '—'}</span>
          </div>
        </div>
        <Button
          fullWidth
          onClick={() => navigate('/', { replace: true })}
          style={{ marginTop: 20 }}
        >
          Back to home
        </Button>
      </div>
    );
  }

  return (
    <div className="tp-page tp-result">
      <div className="tp-result-icon tp-icon-bad">!</div>
      <h2 className="tp-result-title">Transfer failed</h2>
      <p className="tp-result-sub">{error || 'Something went wrong.'}</p>
      <Button
        fullWidth
        onClick={() => navigate('/transfer', { replace: true })}
        style={{ marginTop: 20 }}
      >
        Try again
      </Button>
    </div>
  );
}

function RiskReportCard({ ai, variant }) {
  if (!ai) return null;
  const trust = typeof ai.trustScore === 'number' ? ai.trustScore : null;
  const score = typeof ai.score === 'number' ? ai.score : null;
  const level = (ai.level || 'low').toUpperCase();
  const isApproved = variant === 'approved';
  const titleText = isApproved ? 'Why TNGD² approved this' : 'Why we blocked this';

  return (
    <div className={`tp-risk-card tp-risk-${variant}`}>
      <div className="tp-risk-head">
        <div className="tp-risk-bot">🤖</div>
        <div className="tp-risk-head-text">
          <div className="tp-risk-eyebrow">AI risk report · TNGD²</div>
          <div className="tp-risk-headline">
            {isApproved ? 'Recipient verified' : 'Critical risk detected'}
          </div>
        </div>
        <div className={`tp-risk-score-pill tp-risk-pill-${variant}`}>
          <div className="tp-risk-score-num">
            {isApproved
              ? trust != null
                ? trust
                : score != null
                  ? 100 - score
                  : '—'
              : score != null
                ? score
                : '—'}
          </div>
          <div className="tp-risk-score-meta">
            <div className="tp-risk-score-of">/100</div>
            <div className="tp-risk-score-level">
              {isApproved ? 'TRUST' : `${level} RISK`}
            </div>
          </div>
        </div>
      </div>

      {ai.reasons?.length > 0 && (
        <>
          <div className="tp-risk-section-title">{titleText}</div>
          <ol className={`tp-risk-reasons tp-risk-reasons-${variant}`}>
            {ai.reasons.slice(0, 5).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </>
      )}

      {ai.recommendation && (
        <div className={`tp-risk-rec tp-risk-rec-${variant}`}>
          <div className="tp-risk-rec-label">AI recommendation</div>
          <div className="tp-risk-rec-body">{ai.recommendation}</div>
        </div>
      )}
    </div>
  );
}
