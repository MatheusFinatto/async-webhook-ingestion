import { render, screen, waitFor } from '@testing-library/react';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignaturePanel } from './SignaturePanel';

describe('SignaturePanel', () => {
  it('shows the canonical string and a matching HMAC-SHA256 hex', async () => {
    const secret = 'demo-hmac-secret-public';
    const timestamp = '1700000000';
    const rawBody = '{"event_id":"e1"}';
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    render(
      <SignaturePanel
        timestamp={timestamp}
        rawBody={rawBody}
        secret={secret}
      />,
    );

    expect(
      screen.getByText(`${timestamp}.${rawBody}`),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('signature')).toHaveTextContent(expected),
    );
  });
});
