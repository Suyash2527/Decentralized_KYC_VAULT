import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BadgeCheck,
  Clock,
  History,
  KeyRound,
  ShieldCheck,
  Timer,
  Trash2
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatRelative, truncateHash } from '../lib/format';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Badge, Button, Card, CardHeader, ConfirmModal, CopyButton, EmptyState, Field, Spinner } from '../components/ui';
import { AuditEvent } from '../components/AuditEvent';
import { OtpDisplay } from '../components/OtpDisplay';
import { PartnerSelect } from '../components/PartnerSelect';
import { SecretValue } from '../components/SecretValue';
import { TxLink } from '../components/TxLink';

const DISCLOSURE_OPTIONS = [
  {
    value: 'FULL',
    label: 'Full identity',
    preview: (pii) => [
      ['Name', pii?.fullName || 'Your full name'],
      ['Government ID', pii?.govId || 'Your ID number']
    ]
  },
  {
    value: 'NAME_ONLY',
    label: 'Name only',
    preview: (pii) => [
      ['Name', pii?.fullName || 'Your full name'],
      ['Government ID', 'Hidden for privacy']
    ]
  },
  {
    value: 'PROOF_OF_EXISTENCE',
    label: 'Proof of existence',
    preview: () => [
      ['Name', 'Hidden'],
      ['Government ID', 'Hidden'],
      ['Status', 'Verified identity on file']
    ]
  }
];

const OTP_TTL_MS = 5 * 60 * 1000;

export function CustomerVault() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [identity, setIdentity] = useState(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityError, setIdentityError] = useState('');

  const [auditTrail, setAuditTrail] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');

  const [consentPartner, setConsentPartner] = useState('');
  const [consentBusy, setConsentBusy] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');

  const [otpPartner, setOtpPartner] = useState('');
  const [disclosureType, setDisclosureType] = useState('FULL');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpState, setOtpState] = useState(null);

  const [expiryBusy, setExpiryBusy] = useState(false);
  const [customExpiry, setCustomExpiry] = useState('');
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetLoading, setForgetLoading] = useState(false);

  const loadIdentity = useCallback(async () => {
    setIdentityLoading(true);

    try {
      const response = await api.get('/kyc/me');
      setIdentity(response.data);
      setIdentityError('');
    } catch (error) {
      setIdentity(null);
      setIdentityError(errorMessage(error, 'Could not load your identity record.'));
    } finally {
      setIdentityLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);

    try {
      const response = await api.get(`/audit/${user.bankId}`);
      setAuditTrail(response.data.auditTrail || []);
      setAuditError('');
    } catch (error) {
      // The previous build swallowed this and rendered "no events yet", which
      // told the customer nothing had happened when in fact nothing was checked.
      setAuditTrail([]);
      setAuditError(errorMessage(error, 'Could not load your audit trail.'));
    } finally {
      setAuditLoading(false);
    }
  }, [user.bankId]);

  useEffect(() => {
    loadIdentity();
    loadAudit();
  }, [loadIdentity, loadAudit]);

  const handleConsent = async (action) => {
    if (!consentPartner.trim()) {
      toast.warning('Choose a partner first.');
      return;
    }

    setConsentBusy(action);
    setLastTxHash('');

    try {
      const response = await api.post(`/consent/${action}`, { partnerId: consentPartner.trim() });
      setLastTxHash(response.data.txHash);
      toast.success(
        action === 'grant'
          ? `${response.data.partnerId} can now access your record.`
          : `${response.data.partnerId} no longer has access.`
      );
      await Promise.all([loadIdentity(), loadAudit()]);
    } catch (error) {
      toast.error(errorMessage(error, `Could not ${action} consent.`));
    } finally {
      setConsentBusy('');
    }
  };

  const handleGenerateOtp = async () => {
    if (!otpPartner.trim()) {
      toast.warning('Choose which partner this code is for.');
      return;
    }

    setOtpLoading(true);

    try {
      const response = await api.post('/otp/generate', {
        partnerId: otpPartner.trim(),
        disclosureType
      });

      setOtpState({
        otp: response.data.otp,
        partnerId: response.data.partnerId,
        disclosureType,
        expiresAt: Date.now() + (response.data.expiresInSeconds ?? OTP_TTL_MS / 1000) * 1000
      });
    } catch (error) {
      toast.error(errorMessage(error, 'Could not generate a code.'));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSetExpiry = async (minutes) => {
    setExpiryBusy(true);

    try {
      await api.post('/kyc/set-expiry', { minutes });
      toast.success(minutes === 0 ? 'Self-destruct timer cleared.' : `Record will be deleted in ${minutes} minutes.`);
      setCustomExpiry('');
      await loadIdentity();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update the timer.'));
    } finally {
      setExpiryBusy(false);
    }
  };

  const handleForget = async () => {
    setForgetLoading(true);

    try {
      const response = await api.delete('/kyc/forget');
      toast.success(response.data.message);
      setForgetOpen(false);
      logout();
      navigate('/');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not delete your data.'));
      setForgetLoading(false);
    }
  };

  const activeDisclosure = DISCLOSURE_OPTIONS.find((option) => option.value === disclosureType);
  const grantedConsents = (identity?.consents || []).filter((consent) => consent.status === 'GRANTED');

  return (
    <div className="mx-auto max-w-6xl animate-fade-up px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="t-display">Your identity vault</h1>
        <p className="t-body mt-0.5">Control exactly who can see your verified record, and see everyone who has.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ─── Identity ─── */}
        <Card className="lg:col-span-2">
          <CardHeader
            icon={BadgeCheck}
            title="Verified identity"
            description="What the network holds about you."
            accent="var(--role-customer)"
            actions={
              identity?.verified ? (
                <Badge variant="success" icon={ShieldCheck}>
                  Anchored
                </Badge>
              ) : identityLoading ? null : (
                <Badge variant="warning">Not verified</Badge>
              )
            }
          />
          <div className="card-body">
            {identityLoading ? (
              <p className="t-body flex items-center gap-2">
                <Spinner /> Loading your record…
              </p>
            ) : identityError ? (
              <EmptyState icon={AlertCircle} title="Could not load your record" description={identityError} />
            ) : !identity?.pii ? (
              <EmptyState
                icon={ShieldCheck}
                title="No verified record yet"
                description="A verifier bank must complete your KYC before you can share it."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <p className="t-label">Full name</p>
                    <p className="text-sm font-medium">{identity.pii.fullName}</p>
                  </div>
                  <SecretValue label="Government ID" value={identity.pii.govId} />
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="t-label">Verified on</p>
                    <p className="text-sm">{formatDate(identity.verifiedAt)}</p>
                  </div>
                  {identity.integrityOk === false ? (
                    <Badge variant="danger" icon={AlertCircle}>
                      Integrity check failed
                    </Badge>
                  ) : identity.verified ? (
                    <Badge variant="success" icon={ShieldCheck}>
                      Matches on-chain hash
                    </Badge>
                  ) : null}
                  {identity.piiHash ? (
                    <div className="well flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="t-label">Payload hash</p>
                        <p className="truncate font-mono text-xs">{truncateHash(identity.piiHash, 10, 8)}</p>
                      </div>
                      <CopyButton value={identity.piiHash} label="Copy payload hash" />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ─── OTP share ─── */}
        <Card>
          <CardHeader icon={KeyRound} title="Share with a code" accent="var(--role-customer)" />
          <div className="card-body space-y-4">
            <PartnerSelect label="Share with" value={otpPartner} onChange={setOtpPartner} />

            <Field label="How much to reveal">
              <select
                className="input"
                value={disclosureType}
                onChange={(event) => setDisclosureType(event.target.value)}
              >
                {DISCLOSURE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {/* Selective disclosure was previously invisible — this shows the
                customer exactly what the partner will receive. */}
            <div className="well px-3 py-2.5">
              <p className="t-label mb-1.5">They will see</p>
              <dl className="space-y-1">
                {activeDisclosure.preview(identity?.pii).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 text-xs">
                    <dt className="text-[color:var(--text-subtle)]">{key}</dt>
                    <dd
                      className={`truncate font-medium ${
                        /^hidden/i.test(value) ? 'text-[color:var(--text-subtle)] italic' : 'text-[color:var(--text)]'
                      }`}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {otpState ? (
              <OtpDisplay
                otp={otpState.otp}
                expiresAt={otpState.expiresAt}
                partnerId={otpState.partnerId}
                disclosureType={otpState.disclosureType}
              />
            ) : null}

            <Button
              variant={otpState ? 'secondary' : 'primary'}
              onClick={handleGenerateOtp}
              loading={otpLoading}
              className="w-full"
              disabled={!identity?.verified}
            >
              {otpState ? 'Generate new code' : 'Generate code'}
            </Button>
          </div>
        </Card>

        {/* ─── Consent ─── */}
        <Card className="lg:col-span-2">
          <CardHeader
            icon={ShieldCheck}
            title="Standing consent"
            description="Partners here can read your record until you revoke them."
            accent="var(--role-customer)"
          />
          <div className="card-body space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <PartnerSelect label="Partner" value={consentPartner} onChange={setConsentPartner} />
              <Button
                onClick={() => handleConsent('grant')}
                loading={consentBusy === 'grant'}
                disabled={Boolean(consentBusy) || !identity?.verified}
              >
                Grant
              </Button>
              <Button
                variant="danger"
                onClick={() => handleConsent('revoke')}
                loading={consentBusy === 'revoke'}
                disabled={Boolean(consentBusy) || !identity?.verified}
              >
                Revoke
              </Button>
            </div>

            {lastTxHash ? <TxLink hash={lastTxHash} label="Consent transaction" /> : null}

            <div>
              <p className="t-label mb-1.5">Currently allowed</p>
              {grantedConsents.length === 0 ? (
                <p className="t-body">No partner currently has standing access.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {grantedConsents.map((consent) => (
                    <li key={consent.partnerId}>
                      <Badge variant="success" icon={ShieldCheck}>
                        {consent.partnerId}
                        <span className="font-normal text-[color:var(--text-subtle)]">
                          · {formatRelative(consent.updatedAt)}
                        </span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        {/* ─── Lifecycle ─── */}
        <Card>
          <CardHeader icon={Timer} title="Data lifecycle" accent="var(--role-customer)" />
          <div className="card-body space-y-4">
            {identity?.expiresAt ? (
              <div
                className="rounded-lg border px-3 py-2"
                style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-border)' }}
              >
                <p className="text-xs font-semibold text-[color:var(--danger)]">
                  Self-destructs {formatRelative(identity.expiresAt)}
                </p>
                <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{formatDate(identity.expiresAt)}</p>
              </div>
            ) : null}

            <div>
              <p className="t-label mb-1.5">Auto-delete after</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { minutes: 60, label: '1 hour' },
                  { minutes: 1440, label: '1 day' },
                  { minutes: 10080, label: '7 days' }
                ].map((preset) => (
                  <Button
                    key={preset.minutes}
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSetExpiry(preset.minutes)}
                    disabled={expiryBusy || !identity?.pii}
                  >
                    {preset.label}
                  </Button>
                ))}
                {identity?.expiresAt ? (
                  <Button variant="ghost" size="sm" onClick={() => handleSetExpiry(0)} disabled={expiryBusy}>
                    Cancel
                  </Button>
                ) : null}
              </div>

              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const minutes = Number(customExpiry);

                  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
                    toast.warning('Enter a whole number of minutes between 1 and 10080.');
                    return;
                  }

                  handleSetExpiry(minutes);
                }}
              >
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10080}
                  value={customExpiry}
                  onChange={(event) => setCustomExpiry(event.target.value)}
                  placeholder="Custom (minutes)"
                  aria-label="Custom expiry in minutes"
                />
                <Button type="submit" variant="secondary" size="sm" disabled={expiryBusy || !customExpiry}>
                  Set
                </Button>
              </form>
            </div>

            <div className="border-t pt-4">
              <Button
                variant="danger"
                icon={Trash2}
                className="w-full"
                onClick={() => setForgetOpen(true)}
                disabled={!identity?.pii}
              >
                Delete my data
              </Button>
              <p className="mt-1.5 text-xs text-[color:var(--text-subtle)]">
                Removes all off-chain PII. The historic on-chain hash remains as an orphaned record.
              </p>
            </div>
          </div>
        </Card>

        {/* ─── Audit ─── */}
        <Card className="lg:col-span-3">
          <CardHeader
            icon={History}
            title="Access history"
            description="Every consent change and every attempt to read your record."
            accent="var(--role-customer)"
            actions={
              <Button variant="secondary" size="sm" onClick={loadAudit} loading={auditLoading}>
                Refresh
              </Button>
            }
          />
          <div className="card-body">
            {auditLoading ? (
              <p className="t-body flex items-center gap-2">
                <Spinner /> Loading history…
              </p>
            ) : auditError ? (
              <EmptyState icon={AlertCircle} title="Could not load your history" description={auditError} />
            ) : auditTrail.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="Nothing has happened yet"
                description="Verifications, consent changes, and partner access will appear here."
              />
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {auditTrail.map((event, index) => (
                  <AuditEvent key={`${event.type}-${event.timestamp}-${index}`} event={event} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={forgetOpen}
        onClose={() => setForgetOpen(false)}
        onConfirm={handleForget}
        loading={forgetLoading}
        title="Delete your identity record"
        description="This permanently removes your encrypted PII and every consent record. It cannot be undone. The hash already written to the blockchain will remain, but it will no longer point to any data."
        confirmLabel="Delete permanently"
        confirmPhrase="DELETE"
      />
    </div>
  );
}
