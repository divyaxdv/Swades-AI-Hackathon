import { Hono } from "hono";

export const transcribeRoutes = new Hono();

transcribeRoutes.post("/transcribe", async (c) => {
  const body = await c.req.parseBody();
  const audio = body.audio;

  if (!(audio instanceof File)) {
    return c.json({ error: "Missing or invalid 'audio' file in request body" }, 400);
  }

  const buffer = await audio.arrayBuffer();

  if (buffer.byteLength === 0) {
    return c.json({ error: "Audio file is empty" }, 400);
  }

  return c.json({
    message: "Audio received",
    fileName: audio.name,
    sizeBytes: buffer.byteLength,
    mimeType: audio.type,
  });
});
