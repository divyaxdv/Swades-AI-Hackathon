/**
 * Node.js load test — no external tools needed.
 *
 * Usage:
 *   node load-tests/node-chunks.mjs                  # default: 1000 chunks, 50 concurrency
 *   node load-tests/node-chunks.mjs 5000 100         # 5000 chunks, 100 concurrency
 *   TOTAL=300000 CONCURRENCY=200 node load-tests/node-chunks.mjs
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOTAL = Number(process.env.TOTAL) || Number(process.argv[2]) || 1000;
const CONCURRENCY = Number(process.env.CONCURRENCY) || Number(process.argv[3]) || 50;

function buildWav() {
  const PCM_SIZE = 1024;
  const buf = new ArrayBuffer(44 + PCM_SIZE);
  const dv = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + PCM_SIZE, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, PCM_SIZE, true);
  return new Uint8Array(buf);
}

const wavData = buildWav();

let succeeded = 0;
let failed = 0;
const latencies = [];

async function createRecording() {
  const res = await fetch(`${BASE}/api/recordings`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create recording: ${res.status}`);
  const data = await res.json();
  return data.recordingId;
}

async function uploadAndAck(recordingId, chunkIndex) {
  const t0 = performance.now();
  try {
    const form = new FormData();
    form.append("chunk", new Blob([wavData], { type: "audio/wav" }), `chunk-${chunkIndex}.wav`);
    form.append("recordingId", recordingId);
    form.append("chunkIndex", String(chunkIndex));

    const uploadRes = await fetch(`${BASE}/api/chunks/upload`, { method: "POST", body: form });
    if (!uploadRes.ok) throw new Error(`upload ${uploadRes.status}`);

    const { chunkId } = await uploadRes.json();

    const ackRes = await fetch(`${BASE}/api/chunks/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkId }),
    });
    if (!ackRes.ok) throw new Error(`ack ${ackRes.status}`);

    succeeded++;
    latencies.push(performance.now() - t0);
  } catch {
    failed++;
    latencies.push(performance.now() - t0);
  }
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function run() {
  console.log(`\n  Load Test: ${TOTAL} chunks, ${CONCURRENCY} concurrent\n  Target:    ${BASE}\n`);

  const recordingId = await createRecording();
  console.log(`  Recording: ${recordingId}\n`);

  const startTime = performance.now();
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= TOTAL) break;
      await uploadAndAck(recordingId, idx);

      if ((succeeded + failed) % 500 === 0) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        const rps = ((succeeded + failed) / (elapsed || 1)).toFixed(0);
        process.stdout.write(`\r  Progress: ${succeeded + failed}/${TOTAL}  (${rps} req/s)  ok:${succeeded}  fail:${failed}`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const elapsed = (performance.now() - startTime) / 1000;
  const rps = ((succeeded + failed) / elapsed).toFixed(0);

  console.log(`\n\n  ── Results ────────────────────────────────`);
  console.log(`  Total:       ${succeeded + failed}`);
  console.log(`  Succeeded:   ${succeeded}`);
  console.log(`  Failed:      ${failed}`);
  console.log(`  Duration:    ${elapsed.toFixed(1)}s`);
  console.log(`  Throughput:  ${rps} req/s`);
  console.log(`  Latency p50: ${percentile(latencies, 50).toFixed(0)}ms`);
  console.log(`  Latency p95: ${percentile(latencies, 95).toFixed(0)}ms`);
  console.log(`  Latency p99: ${percentile(latencies, 99).toFixed(0)}ms`);
  console.log(`  Success rate: ${((succeeded / (succeeded + failed)) * 100).toFixed(1)}%`);

  console.log(`\n  ── Reconciliation ─────────────────────────`);
  try {
    const reconRes = await fetch(`${BASE}/api/chunks/reconcile`, { method: "POST" });
    console.log(`  Reconcile: ${reconRes.status}`);
    const missingRes = await fetch(`${BASE}/api/chunks/missing`);
    const missing = await missingRes.json();
    console.log(`  Missing chunks: ${Array.isArray(missing) ? missing.length : JSON.stringify(missing)}`);
  } catch (err) {
    console.log(`  Reconciliation failed: ${err.message}`);
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

run();
