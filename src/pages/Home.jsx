import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BalanceCard, QuickActions, TransactionItem } from '../components';
import { useAuth } from '../context/AuthContext';
import { walletService, transactionService, familyShieldService } from '../services';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [balance, setBalance] = useState(0);
  const [txs, setTxs] = useState([]);
  const [shield, setShield] = useState(null);
  const [error, setError] = useState('');

  const refresh = () => {
    Promise.all([
      walletService.getBalance(),
      transactionService.list({ limit: 5 }),
      familyShieldService.getStatus(),
    ])
      .then(([bal, list, status]) => {
        setBalance(bal?.balance ?? 0);
        setTxs(list?.items ?? list ?? []);
        setShield(status);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page">
      <BalanceCard balance={balance} userName={user?.shortName || user?.name} />

      {shield?.role === 'ward' && (
        <WardShieldBanner shield={shield} onTap={() => navigate('/shield')} />
      )}

      {shield?.role === 'guardian' && (
        <GuardianShieldBanner shield={shield} onTap={() => navigate('/shield')} />
      )}

      <div style={{ height: 16 }} />
      <QuickActions />

      <h2 className="section-title">Recent Activity</h2>
      {error && <div className="muted">{error}</div>}
      {!error && txs.length === 0 && <div className="muted">No transactions yet.</div>}
      {txs.map((tx) => (
        <TransactionItem key={tx.id} tx={tx} />
      ))}
    </div>
  );
}

function WardShieldBanner({ shield, onTap }) {
  const wardType = shield.wardType;
  const isChild = wardType === 'child';
  const pending = shield.latestPending;
  const blocked = shield.latestBlocked;

  if (pending) {
    return (
      <div className="shield-banner shield-banner-alert" onClick={onTap}>
        <div className="shield-banner-row">
          <div className="shield-icon" style={{ background: 'var(--tng-danger)' }}>⏳</div>
          <div>
            <div className="shield-banner-title" style={{ color: 'var(--tng-danger)' }}>
              Cool-off in progress
            </div>
            <div className="shield-banner-sub">
              RM {pending.amount.toLocaleString()} · {shield.guardian?.name || 'Guardian'} is reviewing
            </div>
          </div>
        </div>
        <div className="shield-banner-cta shield-banner-cta-alert">
          ⏱ Tap to see countdown & chat with guardian
        </div>
      </div>
    );
  }

  return (
    <div className={`shield-banner ${isChild ? 'shield-banner-child' : 'shield-banner-ward'}`} onClick={onTap}>
      <div className="shield-banner-row">
        <div className="shield-icon">🛡</div>
        <div>
          <div className="shield-banner-title">
            Family Shield · {isChild ? 'Junior' : 'Senior'} Mode
          </div>
          <div className="shield-banner-sub">
            Guardian: {shield.guardian?.name || '—'} · threshold RM {shield.threshold ?? '—'}
          </div>
        </div>
      </div>
      {blocked && (
        <div className="shield-banner-cta">
          ✓ Last week we blocked a {blocked.aiRiskReport?.matchedScamPatternLabel || 'risky'} transfer of RM {blocked.amount.toLocaleString()}.
        </div>
      )}
      {!blocked && (
        <div className="shield-banner-cta">
          ✓ All clear — transfers above RM {shield.threshold} will pause for {shield.coolOffMinutes} min review.
        </div>
      )}
    </div>
  );
}

function GuardianShieldBanner({ shield, onTap }) {
  const pending = shield.pending || [];
  return (
    <div
      className={`shield-banner ${pending.length ? 'shield-banner-alert' : 'shield-banner-guardian'}`}
      onClick={onTap}
    >
      <div className="shield-banner-row">
        <div className="shield-icon">🛡</div>
        <div>
          <div className="shield-banner-title">Family Shield · Guardian</div>
          <div className="shield-banner-sub">
            Watching over {shield.wards.length} family member{shield.wards.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      {pending.length > 0 ? (
        <div className="shield-banner-cta shield-banner-cta-alert">
          ⚠ {pending.length} pending review{pending.length === 1 ? '' : 's'} — tap to open
        </div>
      ) : (
        <div className="shield-banner-cta">
          ✓ All quiet · RM {shield.blockedSavings.toLocaleString()} protected lifetime
        </div>
      )}
    </div>
  );
}
