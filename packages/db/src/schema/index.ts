import { integer, pgEnum, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
