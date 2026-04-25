import { useEffect, useState } from 'react';
import './PhoneFrame.css';

function formatTime(date) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const isPM = hours >= 12;
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
}

export default function PhoneFrame({ children }) {
  const [time, setTime] = useState(() => formatTime(new Date()));

  useEffect(() => {
    const tick = () => setTime(formatTime(new Date()));
    const now = new Date();
    const msUntilNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    let interval = null;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  return (
    <div className="phone-frame">
      <div className="phone-frame-body">
        <div className="phone-frame-screen">
          <div className="phone-frame-statusbar">
            <span className="phone-frame-time">{time}</span>
            <div className="phone-frame-island" />
            <div className="phone-frame-status-right">
              <span className="phone-frame-signal" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
              <span className="phone-frame-wifi" aria-hidden="true">
                <svg viewBox="0 0 16 12" width="15" height="11">
                  <path
                    d="M8 11.5a1 1 0 100-2 1 1 0 000 2zm-3-3.2a4.2 4.2 0 016 0l-1 1a2.8 2.8 0 00-4 0l-1-1zm-2-2a7 7 0 0110 0l-1 1a5.6 5.6 0 00-8 0l-1-1zm-2-2a9.8 9.8 0 0114 0l-1 1a8.4 8.4 0 00-12 0l-1-1z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="phone-frame-battery" aria-hidden="true">
                <span className="phone-frame-battery-fill" />
              </span>
            </div>
          </div>
          <div className="phone-frame-content">{children}</div>
          <div className="phone-frame-home-indicator" />
        </div>
      </div>
    </div>
  );
}
