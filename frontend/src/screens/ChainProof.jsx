import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Search,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import { CONTRACT_ADDRESS, EXPLORER_URL, NETWORK_NAME } from '../lib/api';
import { DEPLOY_BLOCK, RPC_URL, fetchEvents, getContract, getProvider, partnerIdHash } from '../lib/chain';
import { formatDate, truncateHash } from '../lib/format';
import { Badge, Button, Card, CardHeader, CopyButton, EmptyState, Field, Spinner } from '../components/ui';

/*
 * The "prove it is really on-chain" screen.
 *
 * Every number on this page is read from a public Ethereum node by the
 * browser. Nothing here touches our backend, which is the point: a reviewer
 * can verify the claims without trusting our API, our database, or us.
 */

const EVENT_STYLE = {
  KYCVerified: { label: 'KYC Verified', variant: 'success', icon: ShieldCheck },
  ConsentGranted: { label: 'Consent Granted', variant: 'info', icon: Eye },
  ConsentRevoked: { label: 'Consent Revoked', variant: 'danger', icon: EyeOff }
};

function Stat({ label, value, mono = false, href, copy }) {
  const body = mono ? <span className="font-mono text-sm">{value}</span> : <span className="text-sm">{value}</span>;

  return (
    <div className="well px-3 py-2">
      <p className="t-label">{label}</p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1.5 truncate text-[color:var(--primary)] underline decoration-[color:var(--primary-border)] underline-offset-2 hover:decoration-[color:var(--primary)]"
          >
            {body}
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <span className="min-w-0 truncate">{body}</span>
        )}
        {copy ? <CopyButton value={copy} label={`Copy ${label}`} /> : null}
      </div>
    </div>
  );
}

export function ChainProof() {
  const [head, setHead] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [operator, setOperator] = useState(null);
  const [liveError, setLiveError] = useState('');

  const [customerId, setCustomerId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [checking, setChecking] = useState(false);

  const [events, setEvents] = useState(null);
  const [eventMeta, setEventMeta] = useState(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const configured = Boolean(CONTRACT_ADDRESS);

  /*
   * A ticking block number is the cheapest possible proof that this is a real,
   * live network and not a recording. It is the first thing a sceptical
   * reviewer looks for.
   */
  useEffect(() => {
    if (!configured) {
      return undefined;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const [blockNumber, network] = await Promise.all([
          getProvider().getBlockNumber(),
          getProvider().getNetwork()
        ]);

        if (!cancelled) {
          setHead(blockNumber);
          setChainId(Number(network.chainId));
          setLiveError('');
        }
      } catch (error) {
        if (!cancelled) {
          setLiveError(error?.shortMessage || error?.message || 'Unable to reach the RPC node.');
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, 12000); // roughly one Sepolia block

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [configured]);

  useEffect(() => {
    if (!configured) {
      return;
    }

    getContract()
      .operator()
      .then(setOperator)
      .catch(() => setOperator(null));
  }, [configured]);

  const handleCheck = useCallback(
    async (event) => {
      event?.preventDefault();

      const trimmed = customerId.trim();

      if (!trimmed) {
        return;
      }

      setChecking(true);
      setStatusError('');
      setStatus(null);

      try {
        const hash = partnerIdHash(partnerId || '__none__');
        const result = await getContract().checkStatus(trimmed, hash);

        setStatus({
          consentGranted: result.consentGranted,
          isVerified: result.isVerified,
          payloadHash: result.payloadHash,
          verifiedAt: Number(result.verifiedAt),
          verifierBank: result.verifierBank,
          partnerHash: hash,
          partnerQueried: partnerId.trim()
        });
      } catch (error) {
        setStatusError(error?.shortMessage || error?.message || 'The contract call failed.');
      } finally {
        setChecking(false);
      }
    },
    [customerId, partnerId]
  );

  const handleLoadEvents = useCallback(async () => {
    setLoadingEvents(true);

    try {
      const result = await fetchEvents({ customerId: customerId.trim() || null });
      setEvents(result.events);
      setEventMeta(result);
    } catch (error) {
      setEvents([]);
      setEventMeta({ error: error?.shortMessage || error?.message || 'Event scan failed.' });
    } finally {
      setLoadingEvents(false);
    }
  }, [customerId]);

  const verifiedAtLabel = useMemo(() => {
    if (!status?.isVerified || !status.verifiedAt) {
      return null;
    }

    return formatDate(new Date(status.verifiedAt * 1000));
  }, [status]);

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={AlertTriangle}
          title="No contract address configured"
          description="Set VITE_CONTRACT_ADDRESS in the frontend environment to enable the on-chain proof view."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">On-chain proof</h1>
        <p className="t-body mt-1 max-w-2xl">
          Everything below is read straight from a public Ethereum node by your browser. It does not pass
          through the KYC Vault API, so you can confirm these values without trusting our servers.
        </p>
      </div>

      {/* --- Liveness -------------------------------------------------- */}
      <Card>
        <CardHeader
          icon={Activity}
          title="Live network"
          description="Polled directly from the RPC endpoint every 12 seconds."
          actions={
            head ? (
              <Badge variant="success" icon={CheckCircle2}>
                Connected
              </Badge>
            ) : (
              <Badge variant="neutral">
                <Spinner className="h-3 w-3" /> Connecting
              </Badge>
            )
          }
        />
        <div className="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Network" value={`${NETWORK_NAME}${chainId ? ` (chain ${chainId})` : ''}`} />
          <Stat label="Latest block" value={head ? head.toLocaleString() : '—'} mono />
          <Stat
            label="Contract"
            value={truncateHash(CONTRACT_ADDRESS, 10, 8)}
            mono
            href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`}
            copy={CONTRACT_ADDRESS}
          />
          <Stat
            label="Operator (immutable)"
            value={operator ? truncateHash(operator, 10, 8) : '—'}
            mono
            href={operator ? `${EXPLORER_URL}/address/${operator}` : undefined}
            copy={operator || undefined}
          />
        </div>
        {liveError ? (
          <div className="border-t px-5 py-3">
            <p className="text-xs font-medium text-[color:var(--danger)]">{liveError}</p>
            <p className="t-body mt-1 text-xs">RPC endpoint: <span className="font-mono">{RPC_URL}</span></p>
          </div>
        ) : null}
      </Card>

      {/* --- Contract inspector ---------------------------------------- */}
      <Card>
        <CardHeader
          icon={Search}
          title="Query the contract yourself"
          description="Calls checkStatus() as a read-only view. No wallet, no gas, no backend."
        />
        <form className="card-body space-y-4" onSubmit={handleCheck}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer ID" hint="The public identifier, e.g. CUST_001">
              <input
                className="input"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                placeholder="CUST_001"
                autoComplete="off"
              />
            </Field>
            <Field label="Partner ID" hint="Optional. Checks whether this partner has consent.">
              <input
                className="input"
                value={partnerId}
                onChange={(event) => setPartnerId(event.target.value)}
                placeholder="BANK_B"
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" icon={Search} loading={checking} disabled={!customerId.trim()}>
              Read from chain
            </Button>
            <Button type="button" variant="secondary" icon={Boxes} onClick={handleLoadEvents} loading={loadingEvents}>
              {customerId.trim() ? 'Load this customer’s events' : 'Load all contract events'}
            </Button>
          </div>

          {statusError ? (
            <p className="text-sm font-medium text-[color:var(--danger)]">{statusError}</p>
          ) : null}

          {status ? (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap gap-2">
                <Badge variant={status.isVerified ? 'success' : 'neutral'} icon={status.isVerified ? CheckCircle2 : XCircle}>
                  {status.isVerified ? 'KYC proof exists on-chain' : 'No proof for this ID'}
                </Badge>
                {status.partnerQueried ? (
                  <Badge variant={status.consentGranted ? 'info' : 'danger'} icon={status.consentGranted ? Eye : EyeOff}>
                    {status.consentGranted
                      ? `Consent granted to ${status.partnerQueried}`
                      : `No consent for ${status.partnerQueried}`}
                  </Badge>
                ) : null}
              </div>

              {status.isVerified ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Stat label="payloadHash (SHA-256 of the PII)" value={truncateHash(status.payloadHash, 14, 10)} mono copy={status.payloadHash} />
                  <Stat label="verifiedAt (block timestamp)" value={verifiedAtLabel} />
                  <Stat
                    label="verifierBank"
                    value={truncateHash(status.verifierBank, 10, 8)}
                    mono
                    href={`${EXPLORER_URL}/address/${status.verifierBank}`}
                    copy={status.verifierBank}
                  />
                  <Stat label="keccak256(partnerId) sent to the contract" value={truncateHash(status.partnerHash, 14, 10)} mono copy={status.partnerHash} />
                </div>
              ) : null}

              {/* The thing a judge should take away from this screen. */}
              <div className="well px-4 py-3">
                <p className="text-sm font-medium">That is the entire on-chain record.</p>
                <p className="t-body mt-1">
                  A hash, a timestamp, an address, and a boolean per partner. No name, no ID number, no date of
                  birth, no document. The hash is one-way — it can confirm that a record matches, and it can never
                  reproduce the record.
                </p>
              </div>
            </div>
          ) : null}
        </form>
      </Card>

      {/* --- Event log --------------------------------------------------- */}
      <Card>
        <CardHeader
          icon={Link2}
          title="Event log"
          description="Every write this contract has ever accepted, in reverse order. Each row links to Etherscan."
          actions={
            eventMeta?.head ? (
              <span className="t-label">
                blocks {eventMeta.scannedFrom?.toLocaleString()}–{eventMeta.head.toLocaleString()}
              </span>
            ) : null
          }
        />
        <div className="card-body">
          {loadingEvents ? (
            <div className="flex items-center gap-2 py-6 text-sm text-[color:var(--text-muted)]">
              <Spinner /> Scanning blocks…
            </div>
          ) : events === null ? (
            <EmptyState
              icon={Boxes}
              title="No scan run yet"
              description="Use the button above to pull events from the chain."
            />
          ) : events.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No events found in the scanned range"
              description={
                DEPLOY_BLOCK > 0
                  ? 'Nothing was written in this window.'
                  : 'Set VITE_CONTRACT_DEPLOY_BLOCK so the scan can reach back to deployment.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {events.map((item, index) => {
                const style = EVENT_STYLE[item.name];
                const Icon = style.icon;

                return (
                  <li key={`${item.txHash}-${index}`} className="well px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={style.variant} icon={Icon}>
                        {style.label}
                      </Badge>
                      <a
                        href={`${EXPLORER_URL}/tx/${item.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-[color:var(--primary)] underline decoration-[color:var(--primary-border)] underline-offset-2 hover:decoration-[color:var(--primary)]"
                      >
                        block {item.blockNumber.toLocaleString()} · {truncateHash(item.txHash, 8, 6)}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="t-label">customerId topic</dt>
                        <dd className="truncate font-mono text-[color:var(--text-muted)]">{item.customerTopic}</dd>
                      </div>
                      {item.payloadHash ? (
                        <div className="min-w-0">
                          <dt className="t-label">payloadHash</dt>
                          <dd className="truncate font-mono text-[color:var(--text-muted)]">{item.payloadHash}</dd>
                        </div>
                      ) : null}
                      {item.partnerTopic ? (
                        <div className="min-w-0">
                          <dt className="t-label">keccak256(partnerId)</dt>
                          <dd className="truncate font-mono text-[color:var(--text-muted)]">{item.partnerTopic}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}

          {eventMeta?.truncated ? (
            <p className="t-body mt-3 text-xs">
              The scan stopped early — public RPC nodes cap how many blocks a single log query may cover. Set
              <span className="font-mono"> VITE_CONTRACT_DEPLOY_BLOCK</span> to narrow the range, or point
              <span className="font-mono"> VITE_RPC_URL</span> at a dedicated node for a full history.
            </p>
          ) : null}

          {eventMeta?.error ? (
            <p className="mt-3 text-xs font-medium text-[color:var(--danger)]">{eventMeta.error}</p>
          ) : null}
        </div>
      </Card>

      {/* --- The split ---------------------------------------------------- */}
      <Card>
        <CardHeader
          icon={Database}
          title="Why this is safe to make public"
          description="The split that makes a public ledger compatible with private identity data."
        />
        <div className="card-body grid gap-4 sm:grid-cols-2">
          <div className="well px-4 py-3">
            <p className="text-sm font-semibold">On-chain — public and permanent</p>
            <ul className="t-body mt-2 space-y-1 text-xs">
              <li>SHA-256 hash of the record</li>
              <li>Verification timestamp and verifier address</li>
              <li>Consent flags, keyed by keccak256 of the partner ID</li>
            </ul>
            <p className="t-body mt-2 text-xs">
              Nobody can alter this, including us. That is exactly what makes it worth having.
            </p>
          </div>
          <div className="well px-4 py-3">
            <p className="text-sm font-semibold">Off-chain — private and erasable</p>
            <ul className="t-body mt-2 space-y-1 text-xs">
              <li>Name and government ID, AES-256-GCM encrypted</li>
              <li>Data key wrapped by a Cloud KMS HSM</li>
              <li>Access log of every read attempt</li>
            </ul>
            <p className="t-body mt-2 text-xs">
              A deletion request erases all of this. The on-chain hash stays behind as an orphan: proof that a
              verification happened, with nothing left to reconstruct.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
