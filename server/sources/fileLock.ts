import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, lstat, open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { KnowledgeSourceError } from "../errors.js";

const WRITE_LOCK_TIMEOUT_MS = 10_000;

type LockState = "gone" | "recovered" | "active" | "unverifiable";
interface LockIdentity { dev: number; ino: number; }

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function closeCandidate(candidatePath: string, candidate: FileHandle, publishedPath?: string): Promise<void> {
  try {
    if (publishedPath) await unlinkIfPresent(publishedPath);
    await unlinkIfPresent(candidatePath);
  } finally {
    await candidate.close();
  }
}

async function closePublishedLock(lockPath: string, lock: FileHandle): Promise<void> {
  try {
    await unlinkIfPresent(lockPath);
  } finally {
    await lock.close();
  }
}

function lockOwnerProcessState(pid: number): "active" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "active";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    return code === "EPERM" ? "active" : "unknown";
  }
}

async function readLock(handle: FileHandle, size: number): Promise<unknown> {
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return JSON.parse(buffer.subarray(0, offset).toString("utf8"));
}

function sameFileIdentity(left: LockIdentity, right: LockIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function recoverStaleLock(lockPath: string): Promise<LockState> {
  let existing: FileHandle;
  try {
    existing = await open(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "unverifiable";
  }

  let identity: LockIdentity;
  let metadata: unknown;
  try {
    const openedInfo = await existing.stat();
    identity = openedInfo;
    if (!openedInfo.isFile() || openedInfo.size < 1 || openedInfo.size > 1_024) return "unverifiable";
    metadata = await readLock(existing, openedInfo.size);
  } catch {
    return "unverifiable";
  } finally {
    await existing.close().catch(() => undefined);
  }

  const owner = metadata as { owner?: unknown; pid?: unknown };
  if (typeof owner.owner !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(owner.owner) ||
      !Number.isSafeInteger(owner.pid) || (owner.pid as number) <= 0) return "unverifiable";
  const processState = lockOwnerProcessState(owner.pid as number);
  if (processState === "active") return "active";
  if (processState !== "dead") return "unverifiable";

  const claimPath = `${lockPath}.reap`;
  try {
    await link(lockPath, claimPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "unverifiable";
  }

  try {
    const claimedInfo = await lstat(claimPath);
    if (claimedInfo.isSymbolicLink() || !sameFileIdentity(identity, claimedInfo)) return "gone";
    await unlink(lockPath);
    return "recovered";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "unverifiable";
  } finally {
    await unlinkIfPresent(claimPath).catch(() => undefined);
  }
}

export async function withCrossProcessLock<T>(target: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${target}.action-pocket.lock`;
  const claimPath = `${lockPath}.reap`;
  const deadline = Date.now() + WRITE_LOCK_TIMEOUT_MS;
  const owner = randomUUID();
  const candidatePath = `${lockPath}.${owner}.candidate`;
  const candidate = await open(candidatePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
  let published = false;

  try {
    await candidate.stat();
    await candidate.writeFile(JSON.stringify({ owner, pid: process.pid }));
    await candidate.sync();

    let lastState: LockState = "unverifiable";
    while (!published) {
      const claimPresent = await pathExists(claimPath);
      if (!claimPresent) {
        try {
          await link(candidatePath, lockPath);
          published = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        if (published && await pathExists(claimPath)) {
          await unlink(lockPath);
          published = false;
        }
      }

      if (published) break;
      lastState = claimPresent ? "unverifiable" : await recoverStaleLock(lockPath);
      if (!claimPresent && (lastState === "gone" || lastState === "recovered")) continue;
      if (Date.now() >= deadline) {
        const reason = lastState === "active" ? "持锁进程仍在运行" : "无法安全确认现有锁已失效";
        throw new KnowledgeSourceError("TIMEOUT", `等待写入锁 10 秒超时：${reason}，请稍后重试。`);
      }
      await wait(25);
    }
    await unlink(candidatePath);
  } catch (error) {
    await closeCandidate(candidatePath, candidate, published ? lockPath : undefined).catch(() => undefined);
    throw error;
  }

  try {
    return await action();
  } finally {
    await closePublishedLock(lockPath, candidate);
  }
}
