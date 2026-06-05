import { createHmac, randomUUID } from 'node:crypto';
import { request } from 'node:http';

const TARGET = process.env.SMOKE_TARGET ?? 'http://localhost:3000/webhooks/orders';
const SECRET = process.env.WEBHOOK_HMAC_SECRET ?? 'change-me';
const TOTAL = Number(process.env.SMOKE_REQUESTS ?? 2000);
const CONCURRENCY = Number(process.env.SMOKE_CONCURRENCY ?? 20);
const WARMUP = Number(process.env.SMOKE_WARMUP ?? 200);

const url = new URL(TARGET);

function post() {
  const body = JSON.stringify({
    event_id: randomUUID(),
    event_type: 'order.created',
    payload: { amount: 4200, currency: 'BRL' },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-timestamp': timestamp,
          'x-signature': signature,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          resolve({ status: res.statusCode, ms });
        });
      },
    );
    req.on('error', () => resolve({ status: 0, ms: 0 }));
    req.end(body);
  });
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function run(count, collect) {
  const samples = [];
  let done = 0;
  let inFlight = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (inFlight < CONCURRENCY && done + inFlight < count) {
        inFlight++;
        post().then((r) => {
          inFlight--;
          done++;
          if (collect) samples.push(r);
          if (done >= count) resolve();
          else pump();
        });
      }
    };
    pump();
  });
  return samples;
}

console.log(`warmup: ${WARMUP} requests`);
await run(WARMUP, false);

console.log(`measuring: ${TOTAL} requests, concurrency ${CONCURRENCY}`);
const wall = process.hrtime.bigint();
const samples = await run(TOTAL, true);
const wallMs = Number(process.hrtime.bigint() - wall) / 1e6;

const accepted = samples.filter((s) => s.status === 202);
const latencies = accepted.map((s) => s.ms).sort((a, b) => a - b);
const nonAccepted = samples.length - accepted.length;

console.log('');
console.log(`target:        ${TARGET}`);
console.log(`requests:      ${samples.length} (accepted 202: ${accepted.length}, other: ${nonAccepted})`);
console.log(`throughput:    ${(samples.length / (wallMs / 1000)).toFixed(0)} req/s`);
console.log(`latency p50:   ${percentile(latencies, 50).toFixed(2)} ms`);
console.log(`latency p95:   ${percentile(latencies, 95).toFixed(2)} ms`);
console.log(`latency p99:   ${percentile(latencies, 99).toFixed(2)} ms`);
console.log(`latency max:   ${latencies[latencies.length - 1].toFixed(2)} ms`);

if (nonAccepted > 0) process.exitCode = 1;
