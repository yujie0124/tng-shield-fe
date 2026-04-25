import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, PageHeader } from '../components';
import { familyShieldService } from '../services';

export default function Shield() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);

  const load = () => familyShieldService.getStatus().then(setStatus);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  if (!status) {
    return (
      <div className="page">
        <PageHeader title="Family Shield" showBack={false} />
        <div className="muted">Loading…</div>
      </div>
    );
  }

  return status.role === 'guardian' ? (
    <GuardianShield status={status} navigate={navigate} reload={load} />
  ) : (
    <WardShield status={status} navigate={navigate} reload={load} />
  );
}

function GuardianShield({ status, navigate, reload }) {
  return (
    <div className="page">
      <PageHeader title="Family Shield" showBack={false} />

      <Card>
        <div className="shield-stat-grid">
          <div className="shield-stat shield-stat-success">
            <div className="muted" style={{ fontSize: 11 }}>Lifetime savings protected</div>
            <div className="shield-stat-num">RM {status.blockedSavings.toLocaleString()}</div>
            <div className="shield-stat-foot">
              {status.blockedCount} block{status.blockedCount === 1 ? '' : 's'} · {status.wards.length} ward{status.wards.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </Card>

      {status.pending.length > 0 && (
        <>
          <h2 className="section-title">⚠ Pending review · {status.pending.length}</h2>
          {status.pending.map((r) => (
            <PendingCard key={r.id} review={r} onClick={() => navigate(`/shield/review/${r.id}`)} />
          ))}
        </>
      )}

      <h2 className="section-title">Watching over</h2>
      {status.wards.map((w) => (
        <WardCard key={w.id} ward={w} onChange={reload} navigate={navigate} />
      ))}

      <h2 className="section-title">Add another family member</h2>
      <Card>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Invite an elderly parent or a child. They'll get a setup link via SMS.
        </div>
        <Button fullWidth variant="ghost" onClick={() => alert('Demo only — invite flow not wired up.')}>
          + Invite a ward
        </Button>
      </Card>
    </div>
  );
}

function PendingCard({ review, onClick }) {
  const ai = review.aiRiskReport || {};
  const ends = new Date(review.coolOffEndsAt).getTime();
  const remaining = Math.max(0, ends - Date.now());
  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  return (
    <Card onClick={onClick} className="pending-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="pending-from">⚠ Review · {review.fromShortName || review.fromName}</div>
          <div className="pending-line">
            RM {review.amount.toLocaleString()} → {review.recipientName || review.recipientPhone}
          </div>
          {ai.matchedScamPatternLabel && (
            <div className="pending-pattern">{ai.matchedScamPatternLabel}</div>
          )}
        </div>
        <RiskBadge level={ai.level} score={ai.score} />
      </div>
      <div className="pending-foot">
        <span className="pending-countdown">⏱ {mm}:{ss} cool-off</span>
        <span className="muted">Tap to review ›</span>
      </div>
    </Card>
  );
}

function WardCard({ ward, onChange, navigate }) {
  const [editing, setEditing] = useState(false);
  const [threshold, setThreshold] = useState(String(ward.threshold));
  const [coolOff, setCoolOff] = useState(String(ward.coolOffMinutes));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await familyShieldService.setThreshold(ward.id, Number(threshold));
      await familyShieldService.setCoolOff(ward.id, Number(coolOff));
      setEditing(false);
      onChange?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="shield-avatar" style={{ background: ward.avatarColor || 'var(--tng-blue)' }}>
          {ward.name.charAt(0)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>
            {ward.name} <span className="ward-tag">{ward.wardType === 'child' ? 'Junior' : 'Senior'}</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            ✓ Active · {ward.relationship} · age {ward.age}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 11 }}>This week</div>
          <div style={{ fontWeight: 600 }}>RM {ward.spentThisWeek.toFixed(0)}</div>
        </div>
      </div>

      {ward.pendingReview && (
        <div
          className="ward-pending-row"
          onClick={() => navigate(`/shield/review/${ward.pendingReview.id}`)}
        >
          ⏳ Pending review · RM {ward.pendingReview.amount.toLocaleString()} ›
        </div>
      )}

      {!editing ? (
        <div className="ward-settings-row">
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Review threshold</div>
            <div style={{ fontWeight: 600 }}>RM {ward.threshold.toLocaleString()}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Cool-off</div>
            <div style={{ fontWeight: 600 }}>{ward.coolOffMinutes} min</div>
          </div>
          <button className="ward-edit-btn" onClick={() => setEditing(true)}>Edit</button>
        </div>
      ) : (
        <div className="ward-edit">
          <label>
            <span className="muted" style={{ fontSize: 11 }}>Threshold (RM)</span>
            <input
              className="input"
              type="number"
              min="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 11 }}>Cool-off (min)</span>
            <input
              className="input"
              type="number"
              min="1"
              max="60"
              value={coolOff}
              onChange={(e) => setCoolOff(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={save} loading={saving}>Save</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function RiskBadge({ level, score }) {
  return (
    <div className={`risk-badge risk-badge-${level || 'low'}`}>
      <div className="risk-badge-num">{score ?? '–'}</div>
      <div className="risk-badge-label">{(level || 'low').toUpperCase()}</div>
    </div>
  );
}

function WardShield({ status, navigate }) {
  const isChild = status.wardType === 'child';
  return (
    <div className="page">
      <PageHeader title="Family Shield" showBack={false} />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="shield-avatar" style={{ background: 'var(--tng-blue)' }}>
            {status.guardian?.name?.charAt(0) || 'G'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              Guardian: {status.guardian?.name || '—'}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {isChild ? 'Junior Mode' : 'Senior Mode'} · {status.relationship}
            </div>
          </div>
          {status.guardian?.phone && (
            <a className="call-pill" href={`tel:${status.guardian.phone}`}>📞 Call</a>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Review threshold</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>RM {status.threshold ?? '—'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 11 }}>Cool-off</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{status.coolOffMinutes} min</div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
          Transfers above this amount pause for {status.coolOffMinutes} minutes while your
          guardian reviews an AI risk report and confirms with you. Threshold can only be
          changed by your guardian.
        </div>
      </Card>

      <h2 className="section-title">My shield activity</h2>
      {status.reviews.length === 0 && (
        <Card>
          <div className="muted">No protected transfers yet.</div>
        </Card>
      )}
      {status.reviews.map((r) => (
        <Card
          key={r.id}
          onClick={() =>
            r.status === 'pending' ? navigate(`/transfer/pending/${r.id}`) : null
          }
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {r.status === 'blocked' && '⛔ Blocked'}
                {r.status === 'expired' && '⛔ Auto-blocked'}
                {r.status === 'approved' && '✓ Approved'}
                {r.status === 'pending' && '⏳ Pending'}
                {' · '}RM {r.amount.toLocaleString()}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                To {r.recipientName || r.recipientPhone}
              </div>
            </div>
            {r.aiRiskReport?.score != null && (
              <RiskBadge level={r.aiRiskReport.level} score={r.aiRiskReport.score} />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
