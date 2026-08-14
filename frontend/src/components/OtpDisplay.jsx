import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode as QrCodeIcon, Type } from 'lucide-react';
import { formatCountdown } from '../lib/format';
import { Button, CopyButton } from './ui';

/*
 * The OTP is time-boxed by the backend, so the UI counts down against the real
 * expiry instead of showing a static "valid for 5 minutes" while the clock runs.
 */
export function OtpDisplay({ otp, expiresAt, partnerId, disclosureType, onExpire }) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));

    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);

      if (remaining === 0) {
        window.clearInterval(timer);
        onExpire?.();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [expiresAt, onExpire]);

  useEffect(() => {
    let cancelled = false;

    // The payload carries the identifiers the partner console needs, so a scan
    // fills the whole form rather than just the six digits.
    const payload = JSON.stringify({ otp, partnerId, disclosureType });

    QRCode.toDataURL(payload, { width: 320, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [otp, partnerId, disclosureType]);

  const expired = secondsLeft === 0;
  const urgent = secondsLeft > 0 && secondsLeft <= 60;
  const progress = Math.max(0, Math.min(100, (secondsLeft / 300) * 100));

  return (
    <div className="well p-4">
      {showQr && qrDataUrl && !expired ? (
        <div className="flex flex-col items-center">
          <img src={qrDataUrl} alt={`QR code containing the one-time password for ${partnerId}`} className="h-40 w-40 rounded-lg border bg-white p-1.5" />
        </div>
      ) : (
        <p
          className={`text-center font-mono text-[2rem] font-bold leading-none tracking-[0.25em] ${
            expired ? 'text-[color:var(--text-subtle)] line-through' : 'text-[color:var(--text)]'
          }`}
        >
          {otp}
        </p>
      )}

      <div className="mt-3">
        <div className="h-1 overflow-hidden rounded-full bg-[color:var(--border)]">
          <div
            className="h-full rounded-full transition-[width] duration-1000 ease-linear"
            style={{
              width: `${progress}%`,
              background: urgent ? 'var(--danger)' : 'var(--success)'
            }}
          />
        </div>
        <p
          className={`mt-1.5 text-center text-xs font-medium ${
            expired
              ? 'text-[color:var(--danger)]'
              : urgent
                ? 'text-[color:var(--danger)]'
                : 'text-[color:var(--text-muted)]'
          }`}
          aria-live="polite"
        >
          {expired ? 'Expired — generate a new code' : `Expires in ${formatCountdown(secondsLeft)}`}
        </p>
      </div>

      {!expired ? (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            icon={showQr ? Type : QrCodeIcon}
            onClick={() => setShowQr((current) => !current)}
            disabled={!qrDataUrl && !showQr}
          >
            {showQr ? 'Show digits' : 'Show QR'}
          </Button>
          <CopyButton value={otp} label="Copy one-time password" className="border" />
        </div>
      ) : null}
    </div>
  );
}
