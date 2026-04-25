import './BalanceCard.css';

export default function BalanceCard({ balance = 0, currency = 'RM', userName = '' }) {
  return (
    <div className="balance-card">
      <div className="balance-card-top">
        <div>
          <div className="balance-card-greeting">Hi, {userName || 'there'}</div>
          <div className="balance-card-label">eWallet Balance</div>
        </div>
        <div className="balance-card-logo">TNG</div>
      </div>
      <div className="balance-card-amount">
        <span className="currency">{currency}</span>
        <span className="amount">{Number(balance).toFixed(2)}</span>
      </div>
      <div className="balance-card-foot">Tap to view eWallet details</div>
    </div>
  );
}
