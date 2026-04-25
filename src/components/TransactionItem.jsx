import { useNavigate } from 'react-router-dom';
import './TransactionItem.css';

const TYPE_META = {
  reload: { icon: '↓', label: 'Reload', sign: '+', color: 'var(--tng-success)' },
  transfer_in: { icon: '↓', label: 'Received', sign: '+', color: 'var(--tng-success)' },
  transfer_out: { icon: '↑', label: 'Sent', sign: '-', color: 'var(--tng-text)' },
  payment: { icon: '⌖', label: 'Payment', sign: '-', color: 'var(--tng-text)' },
  blocked: { icon: '⛔', label: 'Blocked by Shield', sign: '', color: 'var(--tng-danger)' },
};

const STATUS_META = {
  pending_review: { label: '⏳ Pending guardian review', cls: 'tx-pill-pending' },
  approved:       { label: '✓ Approved by guardian',     cls: 'tx-pill-approved' },
  declined:       { label: '⛔ Declined by guardian',     cls: 'tx-pill-declined' },
};

export default function TransactionItem({ tx }) {
  const navigate = useNavigate();
  const meta = TYPE_META[tx.type] || TYPE_META.payment;
  const date = tx.createdAt ? new Date(tx.createdAt).toLocaleString() : '';
  const status = tx.status && STATUS_META[tx.status] ? STATUS_META[tx.status] : null;
  const isPending = tx.status === 'pending_review';
  const isDeclined = tx.status === 'declined' || tx.type === 'blocked';

  const onClick = () => {
    if (isPending && tx.reviewId) navigate(`/transfer/pending/${tx.reviewId}`);
  };

  return (
    <div
      className={`tx-item ${isPending ? 'tx-item-pending' : ''} ${isDeclined ? 'tx-item-declined' : ''} ${isPending && tx.reviewId ? 'tx-item-clickable' : ''}`}
      onClick={onClick}
    >
      <div
        className="tx-item-icon"
        style={{
          background: isDeclined ? '#FFEBEE' : isPending ? '#FFF8E1' : 'var(--tng-blue-bg)',
          color: isDeclined ? 'var(--tng-danger)' : isPending ? '#B45309' : 'var(--tng-blue)',
        }}
      >
        {isPending ? '⏳' : meta.icon}
      </div>
      <div className="tx-item-body">
        <div className="tx-item-title">{tx.title || meta.label}</div>
        <div className="tx-item-sub">{date}</div>
        {status && <div className={`tx-pill ${status.cls}`}>{status.label}</div>}
      </div>
      <div
        className={`tx-item-amount ${isPending ? 'tx-item-amount-pending' : ''} ${isDeclined ? 'tx-item-amount-declined' : ''}`}
        style={!isPending && !isDeclined ? { color: meta.color } : undefined}
      >
        {isPending || isDeclined ? '' : meta.sign}RM {Number(tx.amount).toFixed(2)}
      </div>
    </div>
  );
}
