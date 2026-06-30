export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function newEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

export function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

export function colorFor(id: string): string {
  return `hsl(${hueFor(id)} 70% 62%)`;
}
