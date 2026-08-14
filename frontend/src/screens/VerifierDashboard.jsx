import React, { useRef, useState } from 'react';
import { FileText, ScanLine, Upload, UserCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card, CardHeader, Field } from '../components/ui';
import { TxLink } from '../components/TxLink';
import { TxProgress } from '../components/TxProgress';

export function VerifierDashboard() {
  const [customerId, setCustomerId] = useState('');
  const [fullName, setFullName] = useState('');
  const [govId, setGovId] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const [stage, setStage] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrRawText, setOcrRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');

  const fileInputRef = useRef(null);
  const toast = useToast();

  const handleOCR = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setFileName(file.name);
    setOcrLoading(true);

    try {
      const formData = new FormData();
      formData.append('document', file);

      const response = await api.post('/ocr/extract', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const extracted = response.data.extracted || {};
      const found = [];

      if (extracted.fullName) {
        setFullName(extracted.fullName);
        found.push('name');
      }

      if (extracted.govId) {
        setGovId(extracted.govId);
        found.push('ID number');
      }

      setOcrRawText(response.data.rawText || '');

      if (found.length > 0) {
        toast.success(`Extracted ${found.join(' and ')}. Review before submitting.`);
      } else {
        toast.warning('No fields could be read from that document. Enter the details manually.');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Could not scan that document.'));
    } finally {
      setOcrLoading(false);
      // Allow re-selecting the same file after a failed scan.
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleMint = async (event) => {
    event.preventDefault();

    const errors = {};

    if (!customerId.trim()) {
      errors.customerId = 'A customer public ID is required.';
    }

    if (!fullName.trim()) {
      errors.fullName = 'Full name is required.';
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setLastTxHash('');
    setStage('encrypting');

    try {
      // The encrypt step is local to the request; the visible stage advances as
      // soon as the call is in flight so the label matches what is happening.
      window.setTimeout(() => setStage((current) => (current === 'encrypting' ? 'broadcasting' : current)), 600);
      window.setTimeout(() => setStage((current) => (current === 'broadcasting' ? 'confirming' : current)), 2500);

      const response = await api.post('/kyc/verify', {
        customerId: customerId.trim(),
        pii: { fullName: fullName.trim(), govId: govId.trim() }
      });

      setLastTxHash(response.data.txHash);
      toast.success(`${customerId.trim()} verified and anchored on-chain.`);
    } catch (error) {
      toast.error(errorMessage(error, 'Verification failed.'));
    } finally {
      setStage(null);
    }
  };

  const busy = Boolean(stage);

  return (
    <div className="mx-auto max-w-6xl animate-fade-up px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="t-display">Verifier console</h1>
        <p className="t-body mt-0.5">Scan a document, confirm the details, and anchor the proof on-chain.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            icon={Upload}
            title="Document scan"
            description="Optional — extracts the name and ID number so you can review them."
            accent="var(--role-verifier)"
          />
          <div className="card-body">
            <label
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors hover:bg-[color:var(--surface-sunken)]"
              style={{ borderColor: 'var(--border-strong)' }}
            >
              <FileText className="mb-2 h-6 w-6 text-[color:var(--text-subtle)]" aria-hidden="true" />
              <span className="text-sm font-medium">{fileName || 'Choose a document to scan'}</span>
              <span className="mt-0.5 text-xs text-[color:var(--text-subtle)]">Aadhaar, PAN, or passport — JPG, PNG, WEBP, PDF</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleOCR}
                className="sr-only"
                disabled={ocrLoading}
              />
            </label>

            {ocrLoading ? (
              <p className="t-body mt-3 flex items-center gap-2" aria-live="polite">
                <ScanLine className="h-4 w-4 animate-pulse text-[color:var(--primary)]" aria-hidden="true" />
                Reading document…
              </p>
            ) : null}

            {ocrRawText ? (
              <details className="mt-3">
                <summary className="t-label cursor-pointer hover:text-[color:var(--text)]">Raw OCR output</summary>
                <pre className="well mt-2 max-h-40 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-[color:var(--text-muted)]">
                  {ocrRawText}
                </pre>
              </details>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader icon={UserCheck} title="Anchor status" accent="var(--role-verifier)" />
          <div className="card-body space-y-3">
            {stage ? (
              <TxProgress stage={stage} />
            ) : lastTxHash ? (
              <>
                <p className="t-body">Proof anchored. The record is now verifiable by any partner with consent.</p>
                <TxLink hash={lastTxHash} label="Verification transaction" />
              </>
            ) : (
              <p className="t-body">
                PII is encrypted with AES-256-GCM before storage. Only its SHA-256 hash is written to the chain.
              </p>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader icon={UserCheck} title="Customer details" accent="var(--role-verifier)" />
          <form onSubmit={handleMint} className="card-body" noValidate>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Customer public ID" error={fieldErrors.customerId} hint="The ID the customer signs in with.">
                <input
                  className="input"
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  placeholder="demo_user_1"
                  autoComplete="off"
                />
              </Field>
              <Field label="Full name" error={fieldErrors.fullName}>
                <input
                  className="input"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Alice Wonderland"
                  autoComplete="off"
                />
              </Field>
              <Field label="Government ID">
                <input
                  className="input font-mono"
                  value={govId}
                  onChange={(event) => setGovId(event.target.value)}
                  placeholder="XXXX XXXX XXXX"
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button type="submit" loading={busy}>
                {busy ? 'Anchoring…' : 'Encrypt and anchor proof'}
              </Button>
              <p className="text-xs text-[color:var(--text-subtle)]">
                Confirmation can take up to 30 seconds on a public testnet.
              </p>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
