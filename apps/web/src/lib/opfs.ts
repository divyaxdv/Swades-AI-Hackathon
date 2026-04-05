const OPFS_DIR = "recordings";

async function getRecordingsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

function sessionDir(recordingId: string): string {
  return recordingId;
}

function chunkFileName(chunkIndex: number): string {
  return `chunk-${String(chunkIndex).padStart(4, "0")}.wav`;
}

export async function writeChunkToOPFS(
  recordingId: string,
  chunkIndex: number,
  blob: Blob,
): Promise<void> {
  const dir = await getRecordingsDir();
  const sessionHandle = await dir.getDirectoryHandle(sessionDir(recordingId), { create: true });
  const fileHandle = await sessionHandle.getFileHandle(chunkFileName(chunkIndex), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function readChunkFromOPFS(
  recordingId: string,
  chunkIndex: number,
): Promise<Blob | null> {
  try {
    const dir = await getRecordingsDir();
    const sessionHandle = await dir.getDirectoryHandle(sessionDir(recordingId));
    const fileHandle = await sessionHandle.getFileHandle(chunkFileName(chunkIndex));
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function removeChunkFromOPFS(
  recordingId: string,
  chunkIndex: number,
): Promise<void> {
  try {
    const dir = await getRecordingsDir();
    const sessionHandle = await dir.getDirectoryHandle(sessionDir(recordingId));
    await sessionHandle.removeEntry(chunkFileName(chunkIndex));
  } catch {
    // already deleted or doesn't exist
  }
}

export async function removeSessionFromOPFS(recordingId: string): Promise<void> {
  try {
    const dir = await getRecordingsDir();
    await dir.removeEntry(sessionDir(recordingId), { recursive: true });
  } catch {
    // already deleted or doesn't exist
  }
}

export interface OPFSSessionInfo {
  recordingId: string;
  chunkFiles: string[];
}

export async function listOPFSSessions(): Promise<OPFSSessionInfo[]> {
  const sessions: OPFSSessionInfo[] = [];
  try {
    const dir = await getRecordingsDir();
    for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind === "directory") {
        const chunkFiles: string[] = [];
        const sessionHandle = handle as FileSystemDirectoryHandle;
        for await (const [fileName] of sessionHandle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
          chunkFiles.push(fileName);
        }
        if (chunkFiles.length > 0) {
          sessions.push({ recordingId: name, chunkFiles: chunkFiles.sort() });
        }
      }
    }
  } catch {
    // OPFS not available or empty
  }
  return sessions;
}
