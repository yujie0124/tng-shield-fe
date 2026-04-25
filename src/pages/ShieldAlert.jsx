import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, PageHeader } from '../components';
import { familyShieldService } from '../services';

export default function ShieldAlert() {
  const { wardId, txId } = useParams();
  const navigate = useNavigate();
  const [alert, setAlert] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let mounted = true;
    familyShieldService.getWardAlert({ wardId, txId }).then((a) => {
      if (!mounted) return;
      if (!a) setNotFound(true);
      else setAlert(a);
    });
    return () => {
      mounted = false;
    };
  }, [wardId, txId]);

  if (notFound) {
    return (
      <div className="page">
        <PageHeader title="Shield alert" />
        <div className="muted">Alert not found.</div>
        <div style={{ marginTop: 16 }}>
          <Button fullWidth onClick={() => navigate('/shield', { replace: true })}>
            Back to Shield
          </Button>
        </div>
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="page">
        <PageHeader title="Shield alert" />
        <div className="muted">Loading…</div>
      </div>
    );
  }

  const ai = alert.aiRiskReport || {};
  const isBlock = alert.kind === 'auto_block';
  const variant = isBlock ? 'blocked' : 'approved';
  const titleText = isBlock ? 'Why TNGD² blocked this' : 'Why TNGD² approved this';
  const wardName = alert.ward?.name || 'Ward';
  const recipientLabel = alert.recipientName || alert.recipientPhone || 'Recipient';
  const trust = typeof ai.trustScore === 'number' ? ai.trustScore : null;
  const score = typeof ai.score === 'number' ? ai.score : null;
  const level = (ai.level || 'low').toUpperCase();
  const decidedAt = alert.decidedAt ? new Date(alert.decidedAt) : null;

  return (
    <div className="page">
      <PageHeader
        title={isBlock ? 'Auto-blocked transfer' : 'High-value transfer'}
      />

      <div
        className={`tp-risk-card tp-risk-${variant}`}
        style={{ marginTop: 8 }}
      >
        <div className="tp-risk-head">
          <div className="tp-risk-bot">🤖</div>
          <div className="tp-risk-head-text">
            <div className="tp-risk-eyebrow">AI risk report · TNGD²</div>
            <div className="tp-risk-headline">
              {isBlock ? 'Critical risk detected' : 'Recipient verified'}
            </div>
          </div>
          <div className={`tp-risk-score-pill tp-risk-pill-${variant}`}>
            <div className="tp-risk-score-num">
              {isBlock
                ? score != null
                  ? score
                  : '—'
                : trust != null
                  ? trust
                  : score != null
                    ? 100 - score
                    : '—'}
            </div>
            <div className="tp-risk-score-meta">
              <div className="tp-risk-score-of">/100</div>
              <div className="tp-risk-score-level">
                {isBlock ? `${level} RISK` : 'TRUST'}
              </div>
            </div>
          </div>
        </div>

        {ai.reasons?.length > 0 && (
          <>
            <div className="tp-risk-section-title">{titleText}</div>
            <ol className={`tp-risk-reasons tp-risk-reasons-${variant}`}>
              {ai.reasons.slice(0, 6).map((r, i) => (
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

      <Card>
        <div className="muted" style={{ fontSize: 11 }}>Ward</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{wardName}</div>

        <div className="muted" style={{ fontSize: 11 }}>Recipient</div>
        <div style={{ fontWeight: 600 }}>{recipientLabel}</div>
        {alert.recipientName && alert.recipientPhone && (
          <div className="muted" style={{ fontSize: 12 }}>
            {alert.recipientPhone}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Amount</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              RM {alert.amount.toLocaleString()}
            </div>
          </div>
          {alert.threshold && (
            <div style={{ textAlign: 'right' }}>
              <div className="muted" style={{ fontSize: 11 }}>Threshold</div>
              <div style={{ fontWeight: 600 }}>
                RM {alert.threshold.toLocaleString()}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Status</div>
            <div
              style={{
                fontWeight: 600,
                color: isBlock ? 'var(--tng-danger)' : 'var(--tng-success)',
              }}
            >
              {isBlock ? 'Auto-blocked' : 'Auto-approved'}
            </div>
          </div>
          {decidedAt && (
            <div style={{ textAlign: 'right' }}>
              <div className="muted" style={{ fontSize: 11 }}>When</div>
              <div style={{ fontWeight: 600 }}>
                {decidedAt.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          What this means
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          {isBlock
            ? `TNGD² blocked this transfer automatically because the recipient was flagged as high-risk. ${wardName}'s money is safe. No further action is needed — this alert is informational.`
            : `${wardName} sent RM ${alert.amount.toLocaleString()} above the RM ${alert.threshold?.toLocaleString() || ''} threshold, but TNGD² auto-approved because the recipient is verified. This alert is informational — no action is required.`}
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Button fullWidth onClick={() => navigate('/shield', { replace: true })}>
          Back to Shield
        </Button>
      </div>
    </div>
  );
}
