export function connectionSummary(host: string, port = 5432): string {
  return `Connecting to ${host}:${port}`;
}
