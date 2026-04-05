import { createClient } from "@deepgram/sdk";
import { db } from "@my-better-t-app/db";
import { recordings, speakerSegments, transcriptions } from "@my-better-t-app/db/schema";
import { env } from "@my-better-t-app/env/server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const deepgram = createClient(env.DEEPGRAM_API_KEY);

export const transcribeRoutes = new Hono();

transcribeRoutes.post("/transcribe", async (c) => {
  const body = await c.req.parseBody();
  const audio = body.audio;

  if (!(audio instanceof File)) {
    return c.json({ error: "Missing or invalid 'audio' file in request body" }, 400);
  }

  const arrayBuffer = await audio.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength === 0) {
    return c.json({ error: "Audio file is empty" }, 400);
  }

  try {
    const [recording] = await db
      .insert(recordings)
      .values({ status: "recording" })
      .returning();

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(buffer, {
      model: "nova-3",
      smart_format: true,
      diarize: true,
      punctuate: true,
      utterances: true,
      mimetype: audio.type || "audio/wav",
    });

    if (error) {
      await db
        .update(recordings)
        .set({ status: "failed" })
        .where(eq(recordings.id, recording.id));
      return c.json({ error: "Deepgram transcription failed", details: error.message }, 502);
    }

    const utterances = result.results?.utterances ?? [];
    const channel = result.results?.channels?.[0]?.alternatives?.[0];
    const fullText = channel?.transcript ?? "";
    const duration = result.metadata?.duration ?? null;

    const speakerSet = new Set<number>();
    const segments = utterances.map((u) => {
      speakerSet.add(u.speaker);
      return {
        speakerLabel: `user${u.speaker + 1}`,
        text: u.transcript,
        startTime: u.start,
        endTime: u.end,
        confidence: u.confidence,
      };
    });

    const [transcription] = await db
      .insert(transcriptions)
      .values({
        recordingId: recording.id,
        fullText,
        speakerCount: speakerSet.size,
      })
      .returning();

    if (segments.length > 0) {
      await db.insert(speakerSegments).values(
        segments.map((s) => ({
          transcriptionId: transcription.id,
          speakerLabel: s.speakerLabel,
          text: s.text,
          startTime: s.startTime,
          endTime: s.endTime,
          confidence: s.confidence,
        })),
      );
    }

    await db
      .update(recordings)
      .set({ status: "completed", durationSeconds: duration, completedAt: new Date() })
      .where(eq(recordings.id, recording.id));

    return c.json({
      recordingId: recording.id,
      transcriptionId: transcription.id,
      fullText,
      speakerCount: speakerSet.size,
      segments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: "Transcription failed", details: message }, 500);
  }
});

transcribeRoutes.get("/transcriptions/:id", async (c) => {
  const { id } = c.req.param();

  const transcription = await db.query.transcriptions.findFirst({
    where: eq(transcriptions.id, id),
  });

  if (!transcription) {
    return c.json({ error: "Transcription not found" }, 404);
  }

  const segments = await db.query.speakerSegments.findMany({
    where: eq(speakerSegments.transcriptionId, id),
    orderBy: (s, { asc }) => [asc(s.startTime)],
  });

  return c.json({
    id: transcription.id,
    recordingId: transcription.recordingId,
    fullText: transcription.fullText,
    speakerCount: transcription.speakerCount,
    createdAt: transcription.createdAt,
    segments: segments.map((s) => ({
      speakerLabel: s.speakerLabel,
      text: s.text,
      startTime: s.startTime,
      endTime: s.endTime,
      confidence: s.confidence,
    })),
  });
});
