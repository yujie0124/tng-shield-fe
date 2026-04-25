import { useEffect, useState } from 'react';
import { PageHeader, TransactionItem } from '../components';
import { transactionService } from '../services';

export default function History() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await transactionService.list({ limit: 50 });
        if (!mounted) return;
        setItems(res?.items ?? res ?? []);
        setError('');
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 2500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="page">
      <PageHeader title="Transaction History" showBack={false} />
      {loading && <div className="muted">Loading...</div>}
      {error && <div className="muted">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="muted">No transactions yet.</div>
      )}
      {items.map((tx) => (
        <TransactionItem key={tx.id} tx={tx} />
      ))}
    </div>
  );
}
