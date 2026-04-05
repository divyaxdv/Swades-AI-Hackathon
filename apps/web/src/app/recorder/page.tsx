"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CloudUpload,
  Download,
  Languages,
  Loader2,
  Mic,
  Pause,
  Play,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { env } from "@my-better-t-app/env/web";

import { Button } from "@my-better-t-app/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import { LiveWaveform } from "@/components/ui/live-waveform";
import {
  createServerRecording,
  useChunkSync,
  type ChunkSyncStatus,
} from "@/hooks/use-chunk-sync";
import { useRecorder, type WavChunk } from "@/hooks/use-recorder";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)}s`;
}

function SyncIcon({ status }: { status?: ChunkSyncStatus }) {
  switch (status) {
    case "uploading":
      return <Loader2 className="size-3 animate-spin text-blue-400" />;
    case "acked":
      return <Check className="size-3 text-green-400" />;
    case "failed":
      return <X className="size-3 text-red-400" />;
    default:
      return <CloudUpload className="size-3 text-muted-foreground/50" />;
  }
}

function ChunkRow({
  chunk,
  index,
  syncStatus,
}: {
  chunk: WavChunk;
  index: number;
  syncStatus?: ChunkSyncStatus;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
    } else {
      el.play();
      setPlaying(true);
    }
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = chunk.url;
    a.download = `chunk-${index + 1}.wav`;
    a.click();
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/30 px-3 py-2">
      <audio
        ref={audioRef}
        src={chunk.url}
        onEnded={() => setPlaying(false)}
        preload="none"
      />
      <span className="text-xs font-medium text-muted-foreground tabular-nums">
        #{index + 1}
      </span>
      <span className="text-xs tabular-nums">
        {formatDuration(chunk.duration)}
      </span>
      <span className="text-[10px] text-muted-foreground">16kHz PCM</span>
      <SyncIcon status={syncStatus} />
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="icon-xs" onClick={toggle}>
          {playing ? (
            <Square className="size-3" />
          ) : (
            <Play className="size-3" />
          )}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={download}>
          <Download className="size-3" />
        </Button>
      </div>
    </div>
  );
}

interface TranscriptionSegment {
  speakerLabel: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

interface TranscriptionResult {
  recordingId: string;
  transcriptionId: string;
  fullText: string;
  speakerCount: number;
  segments: TranscriptionSegment[];
}

export default function RecorderPage() {
  const [deviceId] = useState<string | undefined>();
  const {
    status,
    start,
    stop,
    pause,
    resume,
    chunks,
    elapsed,
    stream,
    clearChunks,
  } = useRecorder({ chunkDuration: 5, deviceId });

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const { syncState, persistAndSync, clearSync } = useChunkSync({
    recordingId,
  });
  const lastSyncedCount = useRef(0);

  const [transcribing, setTranscribing] = useState(false);
  const [transcription, setTranscription] =
    useState<TranscriptionResult | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isActive = isRecording || isPaused;

  useEffect(() => {
    if (chunks.length > lastSyncedCount.current && recordingId) {
      for (let i = lastSyncedCount.current; i < chunks.length; i++) {
        persistAndSync(chunks[i], i);
      }
      lastSyncedCount.current = chunks.length;
    }
  }, [chunks, recordingId, persistAndSync]);

  const handlePrimary = useCallback(async () => {
    if (isActive) {
      stop();
    } else {
      try {
        const newId = await createServerRecording();
        setRecordingId(newId);
        lastSyncedCount.current = 0;
        start();
      } catch {
        setTranscriptionError("Failed to create recording session");
      }
    }
  }, [isActive, stop, start]);

  const handleClearAll = useCallback(() => {
    clearChunks();
    clearSync();
    lastSyncedCount.current = 0;
  }, [clearChunks, clearSync]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setTranscriptionError(null);
    setTranscription(null);

    try {
      const formData = new FormData();
      formData.append("audio", file, file.name);

      const res = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload transcription failed");
      }

      const data: TranscriptionResult = await res.json();
      setTranscription(data);
    } catch (err) {
      setTranscriptionError(
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setUploading(false);
    }
  }, []);

  const handleTranscribe = useCallback(async () => {
    if (chunks.length === 0) return;

    setTranscribing(true);
    setTranscriptionError(null);
    setTranscription(null);

    try {
      const totalLength = chunks.reduce(
        (acc, chunk) => acc + chunk.duration * 16000 * 2,
        0,
      );
      const mergedBuffer = new ArrayBuffer(totalLength);
      const mergedView = new Uint8Array(mergedBuffer);
      let offset = 0;

      for (const chunk of chunks) {
        const buf = await chunk.blob.arrayBuffer();
        const data = new Uint8Array(buf).slice(44);
        mergedView.set(data, offset);
        offset += data.byteLength;
      }

      const wavHeader = new ArrayBuffer(44);
      const view = new DataView(wavHeader);
      const sampleRate = 16000;
      const numSamples = offset / 2;

      const writeStr = (off: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(off + i, str.charCodeAt(i));
        }
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + offset, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, offset, true);

      const mergedBlob = new Blob([wavHeader, mergedView.slice(0, offset)], {
        type: "audio/wav",
      });

      const formData = new FormData();
      formData.append("audio", mergedBlob, "recording.wav");

      const res = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Transcription request failed");
      }

      const data: TranscriptionResult = await res.json();
      setTranscription(data);
    } catch (err) {
      setTranscriptionError(
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setTranscribing(false);
    }
  }, [chunks]);

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>
            16 kHz / 16-bit PCM WAV — chunked every 5 s
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {/* Waveform */}
          <div className="overflow-hidden rounded-sm border border-border/50 bg-muted/20 text-foreground">
            <LiveWaveform
              active={isRecording}
              processing={isPaused}
              stream={stream}
              height={80}
              barWidth={3}
              barGap={1}
              barRadius={2}
              sensitivity={1.8}
              smoothingTimeConstant={0.85}
              fadeEdges
              fadeWidth={32}
              mode="static"
            />
          </div>

          {/* Timer */}
          <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
            {formatTime(elapsed)}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            {/* Record / Stop */}
            <Button
              size="lg"
              variant={isActive ? "destructive" : "default"}
              className="gap-2 px-5"
              onClick={handlePrimary}
              disabled={status === "requesting"}
            >
              {isActive ? (
                <>
                  <Square className="size-4" />
                  Stop
                </>
              ) : (
                <>
                  <Mic className="size-4" />
                  {status === "requesting" ? "Requesting..." : "Record"}
                </>
              )}
            </Button>

            {/* Upload file */}
            {!isActive && (
              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="size-4" />
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />

            {/* Pause / Resume */}
            {isActive && (
              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                onClick={isPaused ? resume : pause}
              >
                {isPaused ? (
                  <>
                    <Play className="size-4" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="size-4" />
                    Pause
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chunks / Transcription (shared area) */}
      {chunks.length > 0 && (
        <div className="relative w-full">
          {/* Chunks card (hidden behind overlay when transcription is visible) */}
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Chunks</CardTitle>
              <CardDescription>{chunks.length} recorded</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {chunks.map((chunk, i) => (
                <ChunkRow
                  key={chunk.id}
                  chunk={chunk}
                  index={i}
                  syncStatus={syncState.find((s) => s.chunkIndex === i)?.status}
                />
              ))}
              <div className="mt-2 flex items-center justify-between">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={handleTranscribe}
                  disabled={transcribing || isActive}
                >
                  <Languages className="size-3" />
                  {transcribing ? "Transcribing..." : "Transcribe"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive"
                  onClick={handleClearAll}
                >
                  <Trash2 className="size-3" />
                  Clear all
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Overlay: transcribing spinner / error / result */}
          {(transcribing || transcriptionError || transcription) && (
            <Card className="absolute inset-0 z-10 flex flex-col overflow-auto border-primary/30 bg-background">
              {transcribing && (
                <>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      Transcribing…
                    </CardTitle>
                    <CardDescription>Processing your recording</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 items-center justify-center">
                    <p className="text-sm text-muted-foreground">
                      This may take a few seconds
                    </p>
                  </CardContent>
                </>
              )}

              {!transcribing && transcriptionError && (
                <>
                  <CardHeader>
                    <CardTitle className="text-destructive">
                      Transcription Failed
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-sm text-destructive">
                      {transcriptionError}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      onClick={() => {
                        setTranscriptionError(null);
                        setTranscription(null);
                      }}
                    >
                      Back to chunks
                    </Button>
                  </CardContent>
                </>
              )}

              {!transcribing && transcription && (
                <>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle>Transcription</CardTitle>
                        <CardDescription>
                          {transcription.speakerCount} speaker
                          {transcription.speakerCount !== 1 ? "s" : ""} detected
                        </CardDescription>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-muted-foreground"
                        onClick={() => {
                          setTranscription(null);
                          setTranscriptionError(null);
                        }}
                      >
                        <X className="mr-1 size-3" />
                        Close
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {transcription.segments.map((seg, i) => (
                      <div
                        key={`${seg.startTime}-${i}`}
                        className="flex gap-3 text-sm"
                      >
                        <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {seg.speakerLabel}
                        </span>
                        <div className="flex flex-col gap-0.5">
                          <p>{seg.text}</p>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {seg.startTime.toFixed(1)}s –{" "}
                            {seg.endTime.toFixed(1)}s
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
