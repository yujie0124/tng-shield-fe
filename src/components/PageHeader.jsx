import { useNavigate } from 'react-router-dom';

export default function PageHeader({ title, showBack = true, right = null }) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      {showBack && (
        <button
          aria-label="Back"
          onClick={() => navigate(-1)}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--tng-surface)',
            color: 'var(--tng-text)',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          ‹
        </button>
      )}
      <h1 className="page-title">{title}</h1>
      <div style={{ marginLeft: 'auto' }}>{right}</div>
    </header>
  );
}
