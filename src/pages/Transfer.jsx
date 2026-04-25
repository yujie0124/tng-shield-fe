import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { walletService, familyShieldService } from '../services';
import merchantsData from '../data/merchants.json';
import './Transfer.css';

export default function Transfer() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = location.state?.prefill;

  const [recipientPhone, setRecipientPhone] = useState(prefill?.recipientPhone || '');
  const [recipientName, setRecipientName] = useState(prefill?.recipientName || '');
  const [editingRecipient, setEditingRecipient] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount] = useState(prefill?.amount ? String(prefill.amount) : '');
  const [note, setNote] = useState(prefill?.note || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [scamCall, setScamCall] = useState(false);
  const [shield, setShield] = useState(null);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    setScamCall(familyShieldService.getScamCallActive());
    familyShieldService.getStatus().then(setShield);
    walletService.getBalance().then((r) => setBalance(r.balance));
  }, []);

  const pickerMerchants = useMemo(
    () => merchantsData.filter((m) => m.scenario && m.phone),
    [],
  );

  const numAmount = Number(amount) || 0;
  const willTrigger =
    shield?.role === 'ward' && shield.threshold && numAmount >= shield.threshold;
  const canSubmit = recipientPhone && numAmount > 0 && !submitting;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await walletService.transfer({
        recipientPhone,
        amount: numAmount,
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

  const pickMerchant = (m) => {
    setRecipientPhone(m.phone);
    setRecipientName(m.name);
    setPickerOpen(false);
    setEditingRecipient(false);
  };

  const startManualEntry = () => {
    setPickerOpen(false);
    setRecipientName('');
    setEditingRecipient(true);
  };

  const onCardClick = () => {
    if (editingRecipient) return;
    setPickerOpen((v) => !v);
  };

  const displayName =
    recipientName || (recipientPhone ? recipientPhone : '');

  return (
    <form onSubmit={onSubmit} className="transfer-page">
      <header className="transfer-header">
        <button
          type="button"
          className="transfer-back"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          ‹
        </button>
        <h1 className="transfer-title">Transfer Money</h1>
        <span className="transfer-header-spacer" />
      </header>

      {scamCall && (
        <div
          className="scam-call-banner"
          style={{ margin: 0, borderRadius: 0 }}
        >
          <span className="scam-call-dot" />
          Call in progress: "Sergeant Rahman" 47:12
        </div>
      )}

      <section className="transfer-recipient-area">
        <div className="transfer-recipient-label">Transfer to</div>
        <div className="transfer-recipient-anchor">
          <div
            className={`transfer-recipient-card ${pickerOpen ? 'is-open' : ''}`}
            onClick={onCardClick}
            role="button"
            tabIndex={0}
          >
            <span className="transfer-recipient-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.6-8 5v1h16v-1c0-3.4-4.7-5-8-5z" />
              </svg>
            </span>
            <span
              className={`transfer-recipient-name ${displayName ? '' : 'transfer-recipient-placeholder'}`}
            >
              {displayName ? displayName.toUpperCase() : 'TAP TO ADD RECIPIENT'}
            </span>
            <span className="transfer-recipient-caret" aria-hidden="true">
              {pickerOpen ? '▴' : '▾'}
            </span>
          </div>

          {pickerOpen && (
            <ul className="transfer-recipient-picker" role="listbox">
              {pickerMerchants.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="transfer-picker-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      pickMerchant(m);
                    }}
                  >
                    {m.name}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="transfer-picker-manual"
                  onClick={(e) => {
                    e.stopPropagation();
                    startManualEntry();
                  }}
                >
                  Type number manually ›
                </button>
              </li>
            </ul>
          )}
        </div>

        {editingRecipient && (
          <input
            className="transfer-phone-input"
            type="tel"
            placeholder="Recipient phone (01x-xxx xxxx)"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            onBlur={() => recipientPhone && setEditingRecipient(false)}
            autoFocus
          />
        )}

        <div className="transfer-verify-pill">
          <span className="transfer-verify-icon">✓</span>
          Always verify recipient name before transferring.
        </div>
      </section>

      {shield?.role === 'ward' && shield.threshold && (
        <div
          className="threshold-info"
          style={{ margin: '16px 16px 0' }}
        >
          <span>🛡</span>
          <div>
            Transfers above <b>RM {shield.threshold.toLocaleString()}</b> pause for a{' '}
            <b>{shield.coolOffMinutes} min</b> guardian review.
          </div>
        </div>
      )}

      <div className="transfer-amount-block">
        <div className="transfer-amount-label">Amount</div>
        <div className="transfer-amount-row">
          <div className="transfer-amount-input-wrap">
            <div className="transfer-amount-input-line">
              <span className="transfer-amount-currency">RM</span>
              <input
                className="transfer-amount-input"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                }
              />
            </div>
          </div>
          <button
            type="button"
            className="transfer-reload-btn"
            onClick={() => navigate('/reload')}
          >
            Reload Now
          </button>
        </div>
        <div className="transfer-amount-divider" />
        {balance !== null && (
          <div className="transfer-amount-foot">
            You can transfer up to RM {Number(balance).toFixed(2)}
          </div>
        )}
      </div>

      <button type="button" className="transfer-gift-btn">
        <span className="transfer-gift-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M20 7h-2.4A3 3 0 0012 4.5 3 3 0 006.4 7H4a1 1 0 00-1 1v3a1 1 0 001 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 001-1V8a1 1 0 00-1-1zm-5-1a1 1 0 010 2h-2V7a1 1 0 011-1 1 1 0 011 0zm-6 0a1 1 0 011 0 1 1 0 011 1v1H9a1 1 0 010-2zm2 14H6v-7h5v7zm2 0v-7h5v7h-5zm6-9H5V9h6v1a1 1 0 002 0V9h6v2z" />
          </svg>
        </span>
        <span>Send gift</span>
      </button>

      <div className="transfer-note-block">
        <label className="transfer-note-label" htmlFor="transfer-note">
          What's the transfer for?
        </label>
        <input
          id="transfer-note"
          className="transfer-note-input"
          type="text"
          maxLength={50}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="transfer-note-counter">{note.length}/50</div>
      </div>

      {willTrigger && (
        <div
          className="threshold-warn"
          style={{ margin: '16px 16px 0' }}
        >
          ⏱ This transfer will pause for guardian review ({shield.coolOffMinutes} min).
        </div>
      )}

      {error && <div className="transfer-error">{error}</div>}

      <div className="transfer-bottom">
        <button
          type="submit"
          className="transfer-next-btn"
          disabled={!canSubmit}
        >
          {submitting ? '...' : willTrigger ? 'Submit for review' : 'Next'}
        </button>
      </div>
    </form>
  );
}
