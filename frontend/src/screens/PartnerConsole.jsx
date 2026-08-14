import React, { useState } from 'react';
import { AlertCircle, KeyRound, Search, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/format';
import { useToast } from '../hooks/useToast';
import { Badge, Button, Card, CardHeader, EmptyState, Field } from '../components/ui';
import { SecretValue } from '../components/SecretValue';

const METHODS = [
  { key: 'consent', label: 'Standing consent', icon: ShieldCheck, hint: 'The customer has granted your institution ongoing access.' },
  { key: 'otp', label: 'One-time code', icon: KeyRound, hint: 'The customer generated a short-lived code for this request.' }
];

function ResultPanel({ result, error }) {
  if (error) {
    return (
      <div
        className="rounded-lg border px-4 py-3"
        style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-border)' }}
      >
        <p className="flex items-start gap-2 text-sm font-medium text-[color:var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <EmptyState
        icon={Search}
        title="No record retrieved yet"
        description="Enter a customer ID and choose how you are authorised to access it."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Badge variant="success" icon={ShieldCheck}>
        Verified against the on-chain hash
      </Badge>

      {result.pii.status ? (
        <div
          className="rounded-lg border px-3 py-2"
          style={{ background: 'var(--primary-soft)', borderColor: 'var(--primary-border)' }}
        >
          <p className="text-sm font-semibold text-[color:var(--primary)]">{result.pii.status}</p>
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
            The customer chose to confirm existence without disclosing identity.
          </p>
        </div>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        {result.pii.fullName ? (
          <div>
            <dt className="t-label">Full name</dt>
            <dd className="text-sm font-medium">{result.pii.fullName}</dd>
          </div>
        ) : null}
        {result.pii.govId ? (
          <div>
            <SecretValue label="Government ID" value={result.pii.govId} allowCopy={false} />
          </div>
        ) : null}
      </dl>

      <div className="well grid gap-2 px-3 py-2.5 sm:grid-cols-2">
        <div>
          <p className="t-label">Verified on</p>
          <p className="text-xs">{formatDate(result.verifiedAt)}</p>
        </div>
        {result.verifiedVia ? (
          <div>
            <p className="t-label">Access route</p>
            <p className="text-xs">{result.verifiedVia}</p>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-[color:var(--text-subtle)]">
        This retrieval has been recorded in the customer's access history.
      </p>
    </div>
  );
}

export function PartnerConsole() {
  const toast = useToast();

  const [method, setMethod] = useState('consent');
  const [customerId, setCustomerId] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!customerId.trim()) {
      toast.warning('Enter the customer public ID.');
      return;
    }

    if (method === 'otp' && !/^\d{6}$/.test(otp.trim())) {
      toast.warning('Enter the 6-digit code the customer gave you.');
      return;
    }

    setLoading(true);
    setResult(null);
    setError('');

    try {
      const response =
        method === 'consent'
          ? await api.get(`/kyc/access/${encodeURIComponent(customerId.trim())}`)
          : await api.post('/otp/verify', { customerId: customerId.trim(), otp: otp.trim() });

      setResult(response.data);
      toast.success('Record retrieved.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not retrieve that record.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl animate-fade-up px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="t-display">Partner console</h1>
        <p className="t-body mt-0.5">Retrieve a customer's verified identity, with their authorisation.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader icon={Search} title="Look up a customer" accent="var(--role-partner)" />
          <form onSubmit={handleSubmit} className="card-body space-y-4" noValidate>
            <fieldset>
              <legend className="t-label mb-1.5">Authorisation method</legend>
              <div className="grid gap-2">
                {METHODS.map((option) => {
                  const Icon = option.icon;
                  const selected = method === option.key;

                  return (
                    <label
                      key={option.key}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                      style={{
                        borderColor: selected ? 'var(--role-partner)' : 'var(--border)',
                        background: selected ? '#f5f3ff' : 'var(--surface)'
                      }}
                    >
                      <input
                        type="radio"
                        name="method"
                        value={option.key}
                        checked={selected}
                        onChange={() => {
                          setMethod(option.key);
                          setResult(null);
                          setError('');
                        }}
                        className="sr-only"
                        aria-label={`${option.label} — ${option.hint}`}
                      />
                      <Icon
                        className="mt-0.5 h-4 w-4 shrink-0"
                        style={{ color: selected ? 'var(--role-partner)' : 'var(--text-subtle)' }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="block text-xs text-[color:var(--text-subtle)]">{option.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <Field label="Customer public ID">
              <input
                className="input"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                placeholder="demo_user_1"
                autoComplete="off"
              />
            </Field>

            {method === 'otp' ? (
              <Field label="One-time code" hint="Six digits, valid for five minutes.">
                <input
                  className="input font-mono tracking-[0.3em]"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
              </Field>
            ) : null}

            <Button type="submit" loading={loading} className="w-full">
              {method === 'consent' ? 'Verify and fetch' : 'Redeem code'}
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader icon={ShieldCheck} title="Retrieved record" accent="var(--role-partner)" />
          <div className="card-body">
            <ResultPanel result={result} error={error} />
          </div>
        </Card>
      </div>
    </div>
  );
}
