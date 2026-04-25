import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { familyShieldService } from '../services';
import './ReviewToast.css';

const SEEN_REVIEWS_PREFIX = 'tng_seen_review_ids:';
const SEEN_ALERTS_PREFIX = 'tng_seen_alert_ids:';

function loadSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
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

        // Only guardians get notifications. If the active user
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

        const reviewKey = `${SEEN_REVIEWS_PREFIX}${userId}`;
        const alertKey = `${SEEN_ALERTS_PREFIX}${userId}`;
        const seenReviews = loadSet(reviewKey);
        const seenAlerts = loadSet(alertKey);

        const pending = s.pending || [];
        const alerts = s.recentAlerts || [];

        if (firstRunForUserRef.current) {
          // On first poll for this user, mark current items as seen so
          // we only fire on NEW arrivals while they're using the app.
          pending.forEach((p) => seenReviews.add(p.id));
          alerts.forEach((a) => seenAlerts.add(a.txId));
          saveSet(reviewKey, seenReviews);
          saveSet(alertKey, seenAlerts);
          firstRunForUserRef.current = false;
          return;
        }

        // Pending reviews (grey-zone) take priority over informational
        // auto-block / auto-approve toasts.
        const freshReview = pending.find((p) => !seenReviews.has(p.id));
        if (freshReview && location.pathname !== `/shield/review/${freshReview.id}`) {
          setToast({ kind: 'review', data: freshReview });
          seenReviews.add(freshReview.id);
          saveSet(reviewKey, seenReviews);
          if (dismissTimer.current) clearTimeout(dismissTimer.current);
          dismissTimer.current = setTimeout(() => setToast(null), 8000);
          return;
        }

        const freshAlert = alerts.find((a) => !seenAlerts.has(a.txId));
        if (
          freshAlert &&
          location.pathname !== `/shield/alert/${freshAlert.wardId}/${freshAlert.txId}`
        ) {
          setToast({ kind: 'alert', data: freshAlert });
          seenAlerts.add(freshAlert.txId);
          saveSet(alertKey, seenAlerts);
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

  if (toast.kind === 'review') {
    const r = toast.data;
    const ai = r.aiRiskReport || {};
    const onOpen = () => {
      setToast(null);
      navigate(`/shield/review/${r.id}`);
    };
    return (
      <div className={`review-toast review-toast-${ai.level || 'medium'}`}>
        <div className="review-toast-icon">🛡</div>
        <div className="review-toast-body" onClick={onOpen}>
          <div className="review-toast-title">
            New review · {r.fromShortName || r.fromName}
          </div>
          <div className="review-toast-sub">
            RM {r.amount.toLocaleString()} → {r.recipientName || r.recipientPhone}
            {ai.matchedScamPatternLabel && ` · ${ai.matchedScamPatternLabel}`}
          </div>
        </div>
        <button className="review-toast-cta" onClick={onOpen}>Review</button>
        <button className="review-toast-close" onClick={() => setToast(null)}>×</button>
      </div>
    );
  }

  // Auto-block or high-value auto-approve alert.
  const a = toast.data;
  const isBlock = a.kind === 'auto_block';
  const ai = a.aiRiskReport || {};
  const tone = isBlock ? 'critical' : 'low';
  const icon = isBlock ? '⛔' : '✓';
  const title = isBlock
    ? `Auto-blocked · ${a.wardName}`
    : `High-value approved · ${a.wardName}`;
  const recipientLabel = a.recipientName || a.recipientPhone || 'Recipient';
  const sub = `RM ${a.amount.toLocaleString()} → ${recipientLabel}${
    ai.reasons?.[0] ? ` · ${ai.reasons[0]}` : ''
  }`;
  const onOpen = () => {
    setToast(null);
    navigate(`/shield/alert/${a.wardId}/${a.txId}`);
  };
  return (
    <div className={`review-toast review-toast-${tone}`}>
      <div className="review-toast-icon">{icon}</div>
      <div className="review-toast-body" onClick={onOpen}>
        <div className="review-toast-title">{title}</div>
        <div className="review-toast-sub">{sub}</div>
      </div>
      <button className="review-toast-cta" onClick={onOpen}>View</button>
      <button className="review-toast-close" onClick={() => setToast(null)}>×</button>
    </div>
  );
}
