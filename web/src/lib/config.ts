const DEFAULT_API_URL = 'http://localhost:3000';

export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? DEFAULT_API_URL,
  wsUrl: import.meta.env.VITE_WS_URL ?? import.meta.env.VITE_API_URL ?? DEFAULT_API_URL,
  hmacSecret: import.meta.env.VITE_DEMO_WEBHOOK_HMAC_SECRET ?? 'demo-hmac-secret-public',
  adminKey: import.meta.env.VITE_DEMO_ADMIN_API_KEY ?? 'demo-admin-key-public',
};
