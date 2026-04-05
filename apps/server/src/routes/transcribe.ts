import { DeepgramClient } from "@deepgram/sdk";
import { db } from "@my-better-t-app/db";
import { recordings, speakerSegments, transcriptions } from "@my-better-t-app/db/schema";
import { env } from "@my-better-t-app/env/server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const deepgram = new DeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });

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

    const result = await deepgram.listen.v1.media.transcribeFile(buffer, {
      model: "nova-3",
      smart_format: true,
      diarize: true,
      punctuate: true,
      utterances: true,
      language: "en",
      multichannel: false,
    });

    const channel = result.results?.channels?.[0]?.alternatives?.[0];
    const fullText = channel?.transcript ?? "";
    const words = channel?.words ?? [];
    const utterances = result.results?.utterances ?? [];
    const duration = result.metadata?.duration ?? null;

    console.log(
      "[diarize] words with speaker data:",
      words.slice(0, 5).map((w) => ({ word: w.word, speaker: w.speaker })),
    );
    console.log(
      "[diarize] utterances:",
      utterances.length,
      utterances.slice(0, 3).map((u) => ({ speaker: u.speaker, text: u.transcript?.slice(0, 40) })),
    );

    const speakerSet = new Set<number>();
    const segments: {
      speakerLabel: string;
      text: string;
      startTime: number;
      endTime: number;
      confidence: number;
    }[] = [];

    if (utterances.length > 0) {
      for (const u of utterances) {
        const speaker = u.speaker ?? 0;
        speakerSet.add(speaker);
        segments.push({
          speakerLabel: `user${speaker + 1}`,
          text: u.transcript ?? "",
          startTime: u.start ?? 0,
          endTime: u.end ?? 0,
          confidence: u.confidence ?? 0,
        });
      }
    } else if (words.length > 0) {
      let currentSpeaker = words[0].speaker ?? 0;
      let currentWords: string[] = [words[0].punctuated_word ?? words[0].word ?? ""];
      let segStart = words[0].start ?? 0;
      let segEnd = words[0].end ?? 0;
      let confSum = words[0].speaker_confidence ?? 0;
      let confCount = 1;

      for (let i = 1; i < words.length; i++) {
        const w = words[i];
        const speaker = w.speaker ?? 0;

        if (speaker !== currentSpeaker) {
          speakerSet.add(currentSpeaker);
          segments.push({
            speakerLabel: `user${currentSpeaker + 1}`,
            text: currentWords.join(" "),
            startTime: segStart,
            endTime: segEnd,
            confidence: confSum / confCount,
          });

          currentSpeaker = speaker;
          currentWords = [];
          segStart = w.start ?? 0;
          confSum = 0;
          confCount = 0;
        }

        currentWords.push(w.punctuated_word ?? w.word ?? "");
        segEnd = w.end ?? 0;
        confSum += w.speaker_confidence ?? 0;
        confCount++;
      }

      speakerSet.add(currentSpeaker);
      segments.push({
        speakerLabel: `user${currentSpeaker + 1}`,
        text: currentWords.join(" "),
        startTime: segStart,
        endTime: segEnd,
        confidence: confSum / confCount,
      });
    }

    console.log("[diarize] speakers detected:", speakerSet.size, [...speakerSet]);

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
    console.error("Transcription error:", err);
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
