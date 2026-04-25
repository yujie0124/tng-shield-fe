import './Input.css';

export default function Input({ label, error, ...props }) {
  return (
    <label className="input-wrap">
      {label && <span className="input-label">{label}</span>}
      <input className={`input ${error ? 'input-error' : ''}`} {...props} />
      {error && <span className="input-error-text">{error}</span>}
    </label>
  );
}
