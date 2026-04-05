import { createClient } from "@deepgram/sdk";
import { env } from "@my-better-t-app/env/server";
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
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(buffer, {
      model: "nova-3",
      smart_format: true,
      diarize: true,
      punctuate: true,
      utterances: true,
      mimetype: audio.type || "audio/wav",
    });

    if (error) {
      return c.json({ error: "Deepgram transcription failed", details: error.message }, 502);
    }

    const utterances = result.results?.utterances ?? [];
    const channel = result.results?.channels?.[0]?.alternatives?.[0];
    const fullText = channel?.transcript ?? "";

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

    return c.json({
      fullText,
      speakerCount: speakerSet.size,
      segments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: "Transcription failed", details: message }, 500);
  }
});
