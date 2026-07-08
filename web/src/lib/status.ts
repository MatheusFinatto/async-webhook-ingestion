const STATUS_COLOR: Record<string, string> = {
  '2': 'var(--color-stage-processed)',
  '4': 'var(--color-stage-rejected)',
  '5': 'var(--color-stage-unavailable)',
};

export function statusColor(status: number): string {
  if (status === 0) {
    return 'var(--text-faint)';
  }
  return STATUS_COLOR[String(status)[0]] ?? 'var(--text-muted)';
}
