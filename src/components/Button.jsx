import './Button.css';

export default function Button({
  children,
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`btn btn-${variant} ${fullWidth ? 'btn-full' : ''}`}
      {...rest}
    >
      {loading ? '...' : children}
    </button>
  );
}
