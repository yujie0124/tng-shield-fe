import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { familyShieldService } from '../services';
import './ReviewToast.css';

const SEEN_PREFIX = 'tng_seen_review_ids:';

function seenKey(userId) {
  return `${SEEN_PREFIX}${userId}`;
}

function loadSeen(userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey(userId)) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSeen(userId, set) {
  localStorage.setItem(seenKey(userId), JSON.stringify([...set]));
}

export default function ReviewToast() {
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState(null);
  const dismissTimer = useRef(null);
  const lastUserIdRef = useRef(null);
  const firstRunForUserRef = useRef(true);

  useEffect(() => {
    let mounted = true;

    const tick = async () => {
      try {
        const s = await familyShieldService.getStatus();
        if (!mounted) return;

        // Only guardians get review notifications. If the active user
        // isn't a guardian, clear any toast and bail.
        if (s?.role !== 'guardian') {
          if (lastUserIdRef.current !== null) {
            lastUserIdRef.current = null;
            firstRunForUserRef.current = true;
            setToast(null);
          }
          return;
        }

        const userId = s.guardian?.id;
        if (!userId) return;

        // Account switch (or first mount): reset first-run gating so we
        // don't carry "seen" state between users.
        if (lastUserIdRef.current !== userId) {
          lastUserIdRef.current = userId;
          firstRunForUserRef.current = true;
          setToast(null);
        }

        const seen = loadSeen(userId);
        const pending = s.pending || [];

        if (firstRunForUserRef.current) {
          // on first poll for this user, mark current pending as seen so
          // we only fire on NEW arrivals while they're using the app
          pending.forEach((p) => seen.add(p.id));
          saveSeen(userId, seen);
          firstRunForUserRef.current = false;
          return;
        }

        const fresh = pending.find((p) => !seen.has(p.id));
        if (fresh && location.pathname !== `/shield/review/${fresh.id}`) {
          setToast(fresh);
          seen.add(fresh.id);
          saveSeen(userId, seen);
          if (dismissTimer.current) clearTimeout(dismissTimer.current);
          dismissTimer.current = setTimeout(() => setToast(null), 8000);
        }
      } catch {
        // ignore
      }
    };

    tick();
    const interval = setInterval(tick, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [location.pathname]);

  if (!toast) return null;

  const ai = toast.aiRiskReport || {};
  const onOpen = () => {
    setToast(null);
    navigate(`/shield/review/${toast.id}`);
  };

  return (
    <div className={`review-toast review-toast-${ai.level || 'medium'}`}>
      <div className="review-toast-icon">🛡</div>
      <div className="review-toast-body" onClick={onOpen}>
        <div className="review-toast-title">
          New review · {toast.fromShortName || toast.fromName}
        </div>
        <div className="review-toast-sub">
          RM {toast.amount.toLocaleString()} → {toast.recipientName || toast.recipientPhone}
          {ai.matchedScamPatternLabel && ` · ${ai.matchedScamPatternLabel}`}
        </div>
      </div>
      <button className="review-toast-cta" onClick={onOpen}>Review</button>
      <button className="review-toast-close" onClick={() => setToast(null)}>×</button>
    </div>
  );
}
