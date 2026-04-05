import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@my-better-t-app/db";
import { chunkAcks, chunks, recordings } from "@my-better-t-app/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { BUCKET, s3 } from "../lib/s3";

export const chunkRoutes = new Hono();

chunkRoutes.post("/recordings", async (c) => {
  const [recording] = await db
    .insert(recordings)
    .values({ status: "recording" })
    .returning();

  return c.json({ recordingId: recording.id });
});

chunkRoutes.post("/chunks/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body.chunk;
  const recordingId = body.recordingId as string;
  const chunkIndex = Number(body.chunkIndex);

  if (!(file instanceof File)) {
    return c.json({ error: "Missing 'chunk' file" }, 400);
  }
  if (!recordingId) {
    return c.json({ error: "Missing 'recordingId'" }, 400);
  }
  if (Number.isNaN(chunkIndex)) {
    return c.json({ error: "Missing or invalid 'chunkIndex'" }, 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const bucketKey = `${recordingId}/chunk-${String(chunkIndex).padStart(4, "0")}.wav`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: bucketKey,
      Body: buffer,
      ContentType: file.type || "audio/wav",
    }),
  );

  const [chunk] = await db
    .insert(chunks)
    .values({
      recordingId,
      chunkIndex,
      bucketKey,
      sizeBytes: buffer.byteLength,
      durationMs: Number(body.durationMs) || null,
    })
    .returning();

  return c.json({ chunkId: chunk.id, bucketKey });
});

chunkRoutes.post("/chunks/ack", async (c) => {
  const { chunkId } = await c.req.json<{ chunkId: string }>();

  if (!chunkId) {
    return c.json({ error: "Missing 'chunkId'" }, 400);
  }

  const chunk = await db.query.chunks.findFirst({
    where: eq(chunks.id, chunkId),
  });

  if (!chunk) {
    return c.json({ error: "Chunk not found" }, 404);
  }

  const [ack] = await db
    .insert(chunkAcks)
    .values({ chunkId, bucketVerified: true })
    .returning();

  return c.json({ ackId: ack.id, chunkId, ackedAt: ack.ackedAt });
});

chunkRoutes.post("/chunks/reconcile", async (c) => {
  const allAcks = await db.query.chunkAcks.findMany();
  const mismatches: { chunkId: string; bucketKey: string; reason: string }[] = [];

  for (const ack of allAcks) {
    const chunk = await db.query.chunks.findFirst({
      where: eq(chunks.id, ack.chunkId),
    });

    if (!chunk) {
      mismatches.push({ chunkId: ack.chunkId, bucketKey: "unknown", reason: "chunk_record_missing" });
      continue;
    }

    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: chunk.bucketKey }));
    } catch {
      mismatches.push({ chunkId: ack.chunkId, bucketKey: chunk.bucketKey, reason: "missing_from_bucket" });

      await db
        .update(chunkAcks)
        .set({ bucketVerified: false })
        .where(eq(chunkAcks.id, ack.id));
    }
  }

  return c.json({ total: allAcks.length, mismatches });
});

chunkRoutes.get("/chunks/missing", async (c) => {
  const allAcks = await db.query.chunkAcks.findMany({
    where: eq(chunkAcks.bucketVerified, false),
  });

  const missing: { chunkId: string; bucketKey: string }[] = [];

  for (const ack of allAcks) {
    const chunk = await db.query.chunks.findFirst({
      where: eq(chunks.id, ack.chunkId),
    });

    if (chunk) {
      missing.push({ chunkId: chunk.id, bucketKey: chunk.bucketKey });
    }
  }

  return c.json({ missing });
});

chunkRoutes.get("/chunks/list", async (c) => {
  const result = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  const objects = (result.Contents ?? []).map((o) => ({
    key: o.Key,
    size: o.Size,
    lastModified: o.LastModified,
  }));

  return c.json({ count: objects.length, objects });
});
