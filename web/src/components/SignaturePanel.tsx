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
    <Panel
      title="What the API demands from senders"
      info="The signing contract this API enforces at its boundary. A real partner (a marketplace, a payment provider) runs this recipe on their servers before every delivery. In this demo the browser plays the partner, so you can watch the ingredients of the request that was just fired."
    >
      <ol className="flex flex-col text-xs">
        <Step
          n={1}
          title="x-timestamp"
          hint="The sender stamps Unix seconds. The API refuses anything older than 5 minutes, which kills captured-and-resent deliveries."
        >
          {timestamp}
        </Step>
        <Connector label="take the exact request bytes" />
        <Step
          n={2}
          title="raw body"
          hint="Byte for byte as shipped on the wire. If a single character changes in transit, the API's check fails."
        >
          {rawBody}
        </Step>
        <Connector label="join them with a dot" />
        <Step
          n={3}
          title="canonical string"
          hint="The one string that gets hashed. Binding timestamp to body means neither can be swapped on its own."
        >
          {canonical}
        </Step>
        <Connector label={`hash with HMAC-SHA256 + shared secret "${secret}"`} />
        <Step
          n={4}
          title="x-signature header"
          hint="The sender's proof of identity. The API rebuilds this from the same ingredients and compares: match means a real partner, mismatch means 401 at the door."
          data-testid="signature"
        >
          {signature || 'computing...'}
        </Step>
      </ol>
    </Panel>
  );
}

function Step({
  n,
  title,
  hint,
  children,
  ...rest
}: {
  n: number;
  title: string;
  hint: string;
  children: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <li>
      <div className="flex items-center gap-2">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-fg-muted">
          {n}
        </span>
        <span className="mono font-medium text-fg">{title}</span>
      </div>
      <p className="ml-6 mt-0.5 text-[11px] leading-relaxed text-fg-faint">
        {hint}
      </p>
      <div
        className="mono ml-6 mt-1 break-all rounded bg-surface-2 px-2 py-1 text-fg"
        {...rest}
      >
        {children}
      </div>
    </li>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <li aria-hidden="true" className="my-1.5 flex items-center gap-1.5 pl-1">
      <span className="text-fg-faint">↓</span>
      <span className="text-[10px] italic text-fg-faint">{label}</span>
    </li>
  );
}
