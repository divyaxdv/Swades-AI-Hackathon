# Reliable Recording & Transcription Pipeline

A real-time audio recording system with reliable chunk storage, speaker diarization, and transcription. Records audio in the browser, identifies speakers by voice, and produces labeled transcripts (user1, user2, etc.).

## How It Works

```
Client (Browser)
    │
    ├── 1. Capture audio via microphone (16 kHz, 16-bit PCM WAV)
    ├── 2. Split into 5-second chunks
    ├── 3. Store each chunk in OPFS (Origin Private File System)
    ├── 4. Upload chunks to MinIO storage bucket
    ├── 5. Acknowledge (ack) each successful upload to the database
    ├── 6. Transcribe → Deepgram Nova-3 with speaker diarization
    │
    └── Recovery: if DB has ack but chunk is missing from bucket
        └── Re-send from OPFS → bucket
```

**Main objective:** Zero data loss. OPFS acts as the durable client-side buffer — chunks are only cleared after the bucket and DB are both confirmed in sync.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TailwindCSS v4, shadcn/ui |
| Backend | Hono 4.8 on Bun |
| Database | PostgreSQL + Drizzle ORM |
| Storage | MinIO (S3-compatible object store) |
| Transcription | Deepgram Nova-3 (speech-to-text + speaker diarization) |
| Monorepo | Turborepo + npm workspaces |

## Prerequisites

- **Node.js >= 20.9.0** (managed automatically via `.nvmrc` if you use [nvm](https://github.com/nvm-sh/nvm))
- **Bun** — server runtime ([install](https://bun.sh))
- **Docker Desktop** — for PostgreSQL and MinIO containers
- **Deepgram API key** — get one free at [deepgram.com](https://console.deepgram.com)

## Quick Start (Single Command)

```bash
# 1. Clone and install
git clone <repo-url>
cd Swades-AI-Hackathon
npm install

# 2. Set up environment variables (see below)

# 3. Start everything
npm start
```

`npm start` automatically handles:
1. Switches to the correct Node.js version (via nvm)
2. Starts Docker containers (PostgreSQL + MinIO)
3. Pushes the database schema
4. Starts both the API server and frontend

Once running:
- **Frontend:** [http://localhost:3001](http://localhost:3001)
- **API Server:** [http://localhost:3000](http://localhost:3000)
- **MinIO Console:** [http://localhost:9001](http://localhost:9001) (admin: `minioadmin` / `minioadmin`)

## Environment Variables

### `apps/server/.env`

```env
DATABASE_URL=postgresql://postgres:password@localhost:5433/my-better-t-app
CORS_ORIGIN=http://localhost:3001
NODE_ENV=development

DEEPGRAM_API_KEY=your_deepgram_api_key_here

MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=recordings
```

### `apps/web/.env`

```env
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

## Project Structure

```
Swades-AI-Hackathon/
├── apps/
│   ├── web/                # Frontend (Next.js)
│   │   ├── src/
│   │   │   ├── app/recorder/   # Recorder page — capture, chunk, transcribe
│   │   │   ├── hooks/
│   │   │   │   ├── use-recorder.ts      # Audio capture + WAV chunking
│   │   │   │   └── use-chunk-sync.ts    # OPFS storage + upload + ack flow
│   │   │   └── lib/
│   │   │       └── opfs.ts             # OPFS read/write/delete helpers
│   │   └── .env
│   └── server/             # Backend API (Hono on Bun)
│       ├── src/
│       │   ├── index.ts             # App entry — mounts routes
│       │   ├── routes/
│       │   │   ├── transcribe.ts    # POST /api/transcribe, GET /api/transcriptions/:id
│       │   │   └── chunks.ts        # Chunk upload, ack, reconcile, missing
│       │   └── lib/
│       │       └── s3.ts            # S3 client configured for MinIO
│       └── .env
├── packages/
│   ├── db/                 # Drizzle ORM schema + Docker Compose
│   │   ├── src/schema/     # recordings, transcriptions, speakerSegments, chunks, chunkAcks
│   │   └── docker-compose.yml   # PostgreSQL + MinIO services
│   ├── ui/                 # Shared shadcn/ui components
│   ├── env/                # Type-safe environment config (Zod)
│   └── config/             # Shared TypeScript config
├── start.sh                # Automated startup script
├── .nvmrc                  # Pins Node.js version
├── turbo.json              # Turborepo task config
└── package.json
```

## API Endpoints

### Transcription

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/transcribe` | Upload audio file → transcribe with speaker diarization |
| `GET` | `/api/transcriptions/:id` | Fetch a stored transcription by ID |

### Chunk Pipeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/recordings` | Create a new recording session, returns `recordingId` |
| `POST` | `/api/chunks/upload` | Upload a chunk (multipart form: `chunk`, `recordingId`, `chunkIndex`) |
| `POST` | `/api/chunks/ack` | Acknowledge a chunk upload (`chunkId`) |
| `POST` | `/api/chunks/reconcile` | Compare DB acks vs bucket contents, flag mismatches |
| `GET` | `/api/chunks/missing` | List chunks with ack but missing from bucket |
| `GET` | `/api/chunks/list` | List all objects in the MinIO bucket |

## Database Schema

- **recordings** — each recording session (status, duration, timestamps)
- **transcriptions** — full transcription text + speaker count, linked to a recording
- **speaker_segments** — individual speaker turns (label, text, start/end time, confidence)
- **chunks** — audio chunk metadata (bucket key, size, index), linked to a recording
- **chunk_acks** — upload acknowledgments (bucket verified flag)

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start everything (Docker + DB schema + dev servers) |
| `npm run dev` | Start dev servers only (server + web) |
| `npm run dev:web` | Start only the frontend |
| `npm run dev:server` | Start only the API server |
| `npm run build` | Build all apps |
| `npm run check-types` | TypeScript type checking |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Drizzle Studio (database UI) |
| `npm run db:start` | Start Docker containers |
| `npm run db:stop` | Stop Docker containers |
| `npm run db:down` | Remove Docker containers + volumes |
| `npm run loadtest` | Run load test with Node.js (no install needed) |
| `npm run loadtest:k6` | Run load test with k6 (requires k6 installed) |
| `npm run check` | Run linter (Ultracite/Oxlint) |
| `npm run fix` | Auto-fix lint + formatting issues |

## Load Testing

Target: **300,000 requests** to validate the chunk pipeline under heavy load.

### Option 1: Node.js (no extra tools)

```bash
# Default: 1000 chunks, 50 concurrent
npm run loadtest

# Custom: 300K chunks, 200 concurrent
TOTAL=300000 CONCURRENCY=200 npm run loadtest
```

### Option 2: k6 (more detailed metrics)

```bash
# Install k6
brew install k6

# Run
npm run loadtest:k6
```

The k6 test ramps to 5,000 req/s sustained for 50 seconds (~300K total requests).

### What the test does

1. Creates a recording session on the server
2. Uploads WAV chunks in parallel (upload → ack per chunk)
3. Runs reconciliation after all uploads complete
4. Reports latency percentiles (p50/p95/p99), throughput, and success rate
5. Checks for missing chunks (bucket vs DB consistency)

### What to validate

- **No data loss** — every ack in the DB has a matching chunk in the bucket
- **Throughput** — server handles sustained high req/s without dropping chunks
- **Consistency** — reconciliation catches and repairs any mismatches
- **Success rate** — should be > 95% under load

## Features

- **Real-time recording** with live waveform visualization
- **5-second WAV chunking** at 16 kHz / 16-bit PCM
- **Speaker diarization** — identifies speakers by voice (user1, user2, etc.)
- **OPFS durability** — survives tab crashes, offline, browser restarts
- **Automatic reconciliation** — detects and repairs bucket/DB mismatches
- **Upload support** — drag-and-drop or file picker for pre-recorded audio
- **Transcription overlay** — results appear directly over the chunks panel
