import { boolean, integer, pgEnum, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const recordingStatusEnum = pgEnum("recording_status", [
  "recording",
  "completed",
  "failed",
]);

export const recordings = pgTable("recordings", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: recordingStatusEnum("status").default("recording").notNull(),
  durationSeconds: real("duration_seconds"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const transcriptions = pgTable("transcriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  recordingId: uuid("recording_id")
    .references(() => recordings.id, { onDelete: "cascade" })
    .notNull(),
  fullText: text("full_text").notNull(),
  speakerCount: integer("speaker_count").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const speakerSegments = pgTable("speaker_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  transcriptionId: uuid("transcription_id")
    .references(() => transcriptions.id, { onDelete: "cascade" })
    .notNull(),
  speakerLabel: text("speaker_label").notNull(),
  text: text("text").notNull(),
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  confidence: real("confidence"),
});

export const chunks = pgTable("chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  recordingId: uuid("recording_id")
    .references(() => recordings.id, { onDelete: "cascade" })
    .notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  bucketKey: text("bucket_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chunkAcks = pgTable("chunk_acks", {
  id: uuid("id").defaultRandom().primaryKey(),
  chunkId: uuid("chunk_id")
    .references(() => chunks.id, { onDelete: "cascade" })
    .notNull(),
  bucketVerified: boolean("bucket_verified").default(false).notNull(),
  ackedAt: timestamp("acked_at").defaultNow().notNull(),
});
