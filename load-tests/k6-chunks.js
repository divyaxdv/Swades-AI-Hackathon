import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

const uploadDuration = new Trend("chunk_upload_duration", true);
const ackDuration = new Trend("chunk_ack_duration", true);
const uploadErrors = new Counter("chunk_upload_errors");
const ackErrors = new Counter("chunk_ack_errors");
const successRate = new Rate("success_rate");

// Generate a minimal valid WAV header (44 bytes) + 1KB of PCM silence
const WAV_HEADER_SIZE = 44;
const PCM_SIZE = 1024;
const wavBytes = new Uint8Array(WAV_HEADER_SIZE + PCM_SIZE);
const dv = new DataView(wavBytes.buffer);

function writeStr(offset, str) {
  for (let i = 0; i < str.length; i++) {
    dv.setUint8(offset + i, str.charCodeAt(i));
  }
}
writeStr(0, "RIFF");
dv.setUint32(4, 36 + PCM_SIZE, true);
writeStr(8, "WAVE");
writeStr(12, "fmt ");
dv.setUint32(16, 16, true);
dv.setUint16(20, 1, true); // PCM
dv.setUint16(22, 1, true); // mono
dv.setUint32(24, 16000, true); // 16kHz
dv.setUint32(28, 32000, true); // byte rate
dv.setUint16(32, 2, true); // block align
dv.setUint16(34, 16, true); // 16-bit
writeStr(36, "data");
dv.setUint32(40, PCM_SIZE, true);

const wavBinary = wavBytes.buffer;

// ── Scenarios ──────────────────────────────────────────────
export const options = {
  scenarios: {
    // Ramp-up: warm the server, then sustained high load
    chunk_pipeline: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { duration: "10s", target: 1000 }, // ramp to 1K req/s
        { duration: "50s", target: 5000 }, // sustain 5K req/s → ~275K
        { duration: "10s", target: 100 }, // cool down
      ],
    },
  },
  thresholds: {
    success_rate: ["rate>0.95"],
    chunk_upload_duration: ["p(95)<2000"],
    chunk_ack_duration: ["p(95)<500"],
  },
};

// ── Setup: create one recording per test run ───────────────
export function setup() {
  const res = http.post(`${BASE}/api/recordings`, null, {
    headers: { "Content-Type": "application/json" },
  });

  check(res, { "recording created": (r) => r.status === 200 });

  const body = res.json();
  console.log(`Created recording: ${body.recordingId}`);
  return { recordingId: body.recordingId };
}

// ── Main: upload chunk → ack ───────────────────────────────
export default function (data) {
  const chunkIndex = __VU * 100000 + __ITER;

  // 1. Upload chunk
  const formData = {
    chunk: http.file(wavBinary, `chunk-${chunkIndex}.wav`, "audio/wav"),
    recordingId: data.recordingId,
    chunkIndex: String(chunkIndex),
  };

  const uploadRes = http.post(`${BASE}/api/chunks/upload`, formData);
  uploadDuration.add(uploadRes.timings.duration);

  const uploadOk = check(uploadRes, {
    "upload 200": (r) => r.status === 200,
    "upload has chunkId": (r) => {
      try { return !!r.json().chunkId; } catch { return false; }
    },
  });

  if (!uploadOk) {
    uploadErrors.add(1);
    successRate.add(false);
    return;
  }

  const chunkId = uploadRes.json().chunkId;

  // 2. Acknowledge
  const ackRes = http.post(
    `${BASE}/api/chunks/ack`,
    JSON.stringify({ chunkId }),
    { headers: { "Content-Type": "application/json" } },
  );
  ackDuration.add(ackRes.timings.duration);

  const ackOk = check(ackRes, {
    "ack 200": (r) => r.status === 200,
  });

  if (!ackOk) {
    ackErrors.add(1);
    successRate.add(false);
    return;
  }

  successRate.add(true);
}

// ── Teardown: run reconciliation ───────────────────────────
export function teardown(data) {
  const reconRes = http.post(`${BASE}/api/chunks/reconcile`, null, {
    headers: { "Content-Type": "application/json" },
  });
  console.log(`Reconciliation: ${reconRes.status} — ${reconRes.body}`);

  const missingRes = http.get(`${BASE}/api/chunks/missing`);
  const missing = missingRes.json();
  console.log(`Missing chunks after test: ${JSON.stringify(missing)}`);
}
