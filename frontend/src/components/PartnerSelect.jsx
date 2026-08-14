import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Field } from './ui';

/*
 * Partner IDs used to be free text, so a typo produced "Partner account not
 * found" with no way to discover the correct value. If the lookup fails we fall
 * back to a text input rather than blocking the action entirely.
 */
export function PartnerSelect({ label = 'Partner institution', value, onChange, hint, id }) {
  const [partners, setPartners] = useState([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .get('/partners')
      .then((response) => {
        if (!cancelled) {
          setPartners(response.data.partners || []);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || partners.length === 0) {
    return (
      <Field
        label={label}
        hint={failed ? 'Partner directory unavailable — enter the ID manually.' : hint}
        id={id}
      >
        <input
          className="input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Partner username or bank ID"
          autoComplete="off"
        />
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint} id={id}>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select a partner…</option>
        {partners.map((partner) => (
          <option key={partner.bankId} value={partner.bankId}>
            {partner.username}
            {partner.username !== partner.bankId ? ` (${partner.bankId})` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}
