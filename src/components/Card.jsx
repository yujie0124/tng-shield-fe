import './Card.css';

export default function Card({ children, onClick, className = '', padded = true }) {
  return (
    <div
      onClick={onClick}
      className={`card ${padded ? 'card-padded' : ''} ${onClick ? 'card-clickable' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
