import { useEffect, useState } from 'react';
import { config } from '../lib/config';
import { canonicalString, hmacSha256Hex } from '../lib/hmac';
import { Panel } from './ui';

interface SignaturePanelProps {
  timestamp: string;
  rawBody: string;
  secret?: string;
}

export function SignaturePanel({
  timestamp,
  rawBody,
  secret = config.hmacSecret,
}: SignaturePanelProps) {
  const canonical = canonicalString(timestamp, rawBody);
  const [signature, setSignature] = useState('');

  useEffect(() => {
    let active = true;
    void hmacSha256Hex(secret, canonical).then((hex) => {
      if (active) {
        setSignature(hex);
      }
    });
    return () => {
      active = false;
    };
  }, [secret, canonical]);

  return (
    <Panel title="How it signs">
      <dl className="flex flex-col gap-3 text-xs">
        <Field label="x-timestamp">{timestamp}</Field>
        <Field label="rawBody">{rawBody}</Field>
        <Field label="canonical = ${timestamp}.${rawBody}">{canonical}</Field>
        <Field label="HMAC-SHA256 hex (x-signature)" data-testid="signature">
          {signature}
        </Field>
      </dl>
    </Panel>
  );
}

function Field({
  label,
  children,
  ...rest
}: {
  label: string;
  children: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div>
      <dt className="text-fg-faint">{label}</dt>
      <dd
        className="mono mt-0.5 break-all rounded bg-surface-2 px-2 py-1 text-fg"
        {...rest}
      >
        {children}
      </dd>
    </div>
  );
}
