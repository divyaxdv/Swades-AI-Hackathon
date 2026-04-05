import { useCallback, useEffect, useRef, useState } from "react"

import { env } from "@my-better-t-app/env/web"
import type { WavChunk } from "@/hooks/use-recorder"
import {
  listOPFSSessions,
  readChunkFromOPFS,
  removeChunkFromOPFS,
  removeSessionFromOPFS,
  writeChunkToOPFS,
} from "@/lib/opfs"

export type ChunkSyncStatus = "pending" | "uploading" | "acked" | "failed"

interface SyncedChunk {
  chunkIndex: number
  status: ChunkSyncStatus
  chunkId?: string
}

interface UseChunkSyncOptions {
  recordingId: string | null
}

const SERVER = env.NEXT_PUBLIC_SERVER_URL

async function uploadChunk(
  recordingId: string,
  chunkIndex: number,
  blob: Blob,
  durationMs: number,
): Promise<string> {
  const form = new FormData()
  form.append("chunk", blob, `chunk-${chunkIndex}.wav`)
  form.append("recordingId", recordingId)
  form.append("chunkIndex", String(chunkIndex))
  form.append("durationMs", String(durationMs))

  const res = await fetch(`${SERVER}/api/chunks/upload`, { method: "POST", body: form })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  const data = await res.json()
  return data.chunkId as string
}

async function ackChunk(chunkId: string): Promise<void> {
  const res = await fetch(`${SERVER}/api/chunks/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunkId }),
  })
  if (!res.ok) throw new Error(`Ack failed: ${res.status}`)
}

export async function createServerRecording(): Promise<string> {
  const res = await fetch(`${SERVER}/api/recordings`, { method: "POST" })
  if (!res.ok) throw new Error(`Failed to create recording: ${res.status}`)
  const data = await res.json()
  return data.recordingId as string
}

export function useChunkSync({ recordingId }: UseChunkSyncOptions) {
  const [syncState, setSyncState] = useState<SyncedChunk[]>([])
  const pendingRef = useRef<Set<number>>(new Set())

  const persistAndSync = useCallback(
    async (chunk: WavChunk, chunkIndex: number) => {
      if (!recordingId || pendingRef.current.has(chunkIndex)) return
      pendingRef.current.add(chunkIndex)

      setSyncState((prev) => [
        ...prev.filter((s) => s.chunkIndex !== chunkIndex),
        { chunkIndex, status: "pending" },
      ])

      try {
        await writeChunkToOPFS(recordingId, chunkIndex, chunk.blob)

        setSyncState((prev) =>
          prev.map((s) => (s.chunkIndex === chunkIndex ? { ...s, status: "uploading" } : s)),
        )

        const chunkId = await uploadChunk(
          recordingId,
          chunkIndex,
          chunk.blob,
          Math.round(chunk.duration * 1000),
        )

        await ackChunk(chunkId)

        await removeChunkFromOPFS(recordingId, chunkIndex)

        setSyncState((prev) =>
          prev.map((s) =>
            s.chunkIndex === chunkIndex ? { ...s, status: "acked", chunkId } : s,
          ),
        )
      } catch {
        setSyncState((prev) =>
          prev.map((s) => (s.chunkIndex === chunkIndex ? { ...s, status: "failed" } : s)),
        )
      } finally {
        pendingRef.current.delete(chunkIndex)
      }
    },
    [recordingId],
  )

  const retryFailed = useCallback(
    async (chunks: WavChunk[]) => {
      if (!recordingId) return
      const failed = syncState.filter((s) => s.status === "failed")
      for (const f of failed) {
        const chunk = chunks[f.chunkIndex]
        if (chunk) {
          await persistAndSync(chunk, f.chunkIndex)
        }
      }
    },
    [recordingId, syncState, persistAndSync],
  )

  const reconcileOnLoad = useCallback(async () => {
    const sessions = await listOPFSSessions()
    for (const session of sessions) {
      for (const fileName of session.chunkFiles) {
        const match = fileName.match(/chunk-(\d+)\.wav/)
        if (!match) continue
        const idx = Number(match[1])
        const blob = await readChunkFromOPFS(session.recordingId, idx)
        if (!blob) continue

        try {
          const chunkId = await uploadChunk(session.recordingId, idx, blob, 0)
          await ackChunk(chunkId)
          await removeChunkFromOPFS(session.recordingId, idx)
        } catch {
          // will retry next time
        }
      }
      const remaining = await listOPFSSessions()
      const stillHasFiles = remaining.find((s) => s.recordingId === session.recordingId)
      if (!stillHasFiles || stillHasFiles.chunkFiles.length === 0) {
        await removeSessionFromOPFS(session.recordingId)
      }
    }
  }, [])

  useEffect(() => {
    reconcileOnLoad()
  }, [reconcileOnLoad])

  const clearSync = useCallback(async () => {
    if (recordingId) {
      await removeSessionFromOPFS(recordingId)
    }
    setSyncState([])
    pendingRef.current.clear()
  }, [recordingId])

  return { syncState, persistAndSync, retryFailed, clearSync }
}
