import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, mkdir, open, readFile, readdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { FILE_GRAPH_SEARCH_LIMITS, FileGraphSource, parseMarkdown } from "./fileGraph.js";

async function graph(): Promise<{ root: string; source: FileGraphSource }> {
  const root = await mkdtemp(join(tmpdir(), "action-pocket-"));
  const source = new FileGraphSource(root);
  await source.initialize();
  return { root, source };
}

async function spawnLockOwner(lockPath: string): Promise<ChildProcessWithoutNullStreams> {
  const script = `
    import { randomUUID } from "node:crypto";
    import { constants } from "node:fs";
    import { open } from "node:fs/promises";
    const lock = await open(${JSON.stringify(lockPath)}, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    await lock.writeFile(JSON.stringify({ owner: randomUUID(), pid: process.pid }));
    await lock.sync();
    process.stdout.write("ready\\n");
    setInterval(() => {}, 1_000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end();
  await new Promise<void>((resolveReady, rejectReady) => {
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.setEncoding("utf8");
    child.stdout.once("data", (chunk) => {
      if (String(chunk).includes("ready")) resolveReady();
      else rejectReady(new Error(`unexpected lock owner output: ${String(chunk)}`));
    });
    child.once("error", rejectReady);
    child.once("exit", (code) => rejectReady(new Error(stderr || `lock owner exited ${code}`)));
  });
  return child;
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", () => resolveExit()));
}

test("requires an existing, accessible, absolute Graph directory without creating it", async () => {
  const relativeSource = new FileGraphSource("relative-graph");
  await assert.rejects(relativeSource.initialize(), /绝对路径/);

  const parent = await mkdtemp(join(tmpdir(), "action-pocket-missing-"));
  const missing = join(parent, "must-not-be-created");
  await assert.rejects(new FileGraphSource(missing).initialize(), /已存在目录/);
  await assert.rejects(stat(missing), { code: "ENOENT" });

  const file = join(parent, "not-a-directory");
  await writeFile(file, "x");
  await assert.rejects(new FileGraphSource(file).initialize(), /已存在的目录/);
});

test("search exposes finite directory, entry, candidate, block, per-file, and aggregate limits", () => {
  assert.deepEqual(FILE_GRAPH_SEARCH_LIMITS, {
    maximumFileBytes: 2 * 1024 * 1024,
    maximumTotalBytes: 32 * 1024 * 1024,
    maximumFiles: 1_000,
    maximumDirectories: 1_000,
    maximumDirectoryEntries: 20_000,
    maximumBlocks: 50_000,
  });
});

test("parseMarkdown preserves 1-based lines and neighboring semantic blocks", () => {
  const blocks = parseMarkdown("# Docker\n\n前一段解释\n\n```sh\ndocker ps\n```\n\n后一段");
  assert.deepEqual(blocks.map((block) => block.line), [1, 3, 5, 9]);
  assert.equal(blocks[2].kind, "command");
  assert.equal(parseMarkdown("DELETE FROM users")[0].kind, "command");
});

test("write appends raw content, creates directories, and returns verified location", async () => {
  const { root, source } = await graph();
  const rawContent = "困惑：为什么这样？\n例子：原样保留  两个空格";
  const receipt = await source.write({ rawContent, target: { sourceId: "file-graph", relativePath: "journals/today.md" } });
  assert.equal(receipt.ok, true);
  assert.equal(await readFile(join(root, "journals/today.md"), "utf8"), `${rawContent}\n`);
  if (receipt.ok) {
    assert.equal(receipt.location.path, "journals/today.md");
    assert.equal(receipt.location.line, 1);
    assert.equal(receipt.location.version, receipt.version);
  }
});

test("search returns top-N excerpts with source line and adjacent context", async () => {
  const { root, source } = await graph();
  await writeFile(join(root, "notes.md"), "# 容器清理\n\n清理前先查看磁盘。\n\n```sh\ndocker system prune\n```\n\n它会删除未使用资源。\n");
  const results = await source.search("docker system", 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].location.path, "notes.md");
  assert.equal(results[0].location.line, 5);
  assert.equal(results[0].location.uri, pathToFileURL(join(root, "notes.md")).href);
  assert.equal(results[0].kind, "command");
  assert.match(results[0].contextBefore ?? "", /清理前/);
  assert.match(results[0].contextAfter ?? "", /删除未使用/);
  assert.ok(results.length <= 3);
});

test("natural-language Chinese queries match meaningful segmented terms", async () => {
  const { root, source } = await graph();
  await writeFile(join(root, "adam.md"), "# Adam\n\n动量帮助优化器平滑梯度方向。\n");
  const results = await source.search("为什么优化器需要动量", 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].location.path, "adam.md");
});

test("duplicate blocks have distinct result identities and source lines", async () => {
  const { root, source } = await graph();
  await writeFile(join(root, "repeat.md"), "same needle\n\nsame needle\n");
  const results = await source.search("same needle", 5);
  assert.deepEqual(results.map((item) => item.location.line), [1, 3]);
  assert.notEqual(results[0].id, results[1].id);
});

test("concurrent appends do not lose content", async () => {
  const { root, source } = await graph();
  await Promise.all(Array.from({ length: 12 }, (_, index) => source.write({
    rawContent: `unique-${index}`,
    target: { sourceId: "file-graph", relativePath: "inbox/all.md" },
  })));
  const saved = await readFile(join(root, "inbox/all.md"), "utf8");
  for (let index = 0; index < 12; index += 1) assert.match(saved, new RegExp(`unique-${index}\\n`));
});

test("cross-process lock serializes append, verification, line calculation, and releases the lock", async () => {
  const { root } = await graph();
  const moduleUrl = new URL("./fileGraph.js", import.meta.url).href;
  const runWriter = (value: string) => new Promise<number>((resolveWriter, rejectWriter) => {
    const script = `
      import { FileGraphSource } from ${JSON.stringify(moduleUrl)};
      const source = new FileGraphSource(${JSON.stringify(root)});
      await source.initialize();
      const receipt = await source.write({ rawContent: ${JSON.stringify(value)}, target: { sourceId: "file-graph", relativePath: "shared.md" } });
      if (!receipt.ok) throw new Error(receipt.code + ": " + receipt.message);
      process.stdout.write(String(receipt.location.line));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectWriter);
    child.once("exit", (code) => code === 0 ? resolveWriter(Number(stdout)) : rejectWriter(new Error(stderr || `writer exited ${code}`)));
  });

  const values = Array.from({ length: 6 }, (_, index) => `process-${index}`);
  const receiptLines = await Promise.all(values.map(runWriter));
  const saved = await readFile(join(root, "shared.md"), "utf8");
  assert.equal(saved.trim().split("\n").length, values.length);
  assert.deepEqual([...receiptLines].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  for (const value of values) assert.match(saved, new RegExp(`^${value}$`, "m"));
  await assert.rejects(stat(join(root, "shared.md.action-pocket.lock")), { code: "ENOENT" });
});

test("persistent lock candidate stat failure still closes and safely removes the private candidate", async () => {
  const { root, source } = await graph();
  const target = join(root, "stat-failure.md");
  const probe = await open(join(root, "stat-failure.probe"), constants.O_CREAT | constants.O_RDWR, 0o600);
  const prototype = Object.getPrototypeOf(probe) as Record<string, any>;
  const originalStat = prototype.stat;
  await probe.close();
  let failedHandle: any;
  prototype.stat = async function () {
    failedHandle = this;
    throw Object.assign(new Error("injected persistent candidate stat failure"), { code: "EIO" });
  };

  let receipt;
  try {
    receipt = await source.write({ rawContent: "must fail", target: { sourceId: "file-graph", relativePath: "stat-failure.md" } });
  } finally {
    prototype.stat = originalStat;
  }

  assert.equal(receipt?.ok, false);
  if (receipt && !receipt.ok) assert.equal(receipt.code, "IO_ERROR");
  await assert.rejects(originalStat.call(failedHandle), { code: "EBADF" });
  assert.equal((await readdir(root)).some((name) => name.includes(".action-pocket.lock")), false);
  await assert.rejects(stat(target), { code: "ENOENT" });
});

test("lock initialization write or sync failure removes only the created lock and allows retry", async (context) => {
  for (const method of ["writeFile", "sync"] as const) {
    await context.test(`${method} failure`, async () => {
      const { root, source } = await graph();
      const target = join(root, `${method}.md`);
      const lockPath = `${target}.action-pocket.lock`;
      const probe = await open(join(root, `${method}.probe`), constants.O_CREAT | constants.O_RDWR, 0o600);
      const prototype = Object.getPrototypeOf(probe) as Record<string, any>;
      const original = prototype[method];
      await probe.close();
      let failed = false;
      prototype[method] = async function (...args: any[]) {
        if (!failed) {
          failed = true;
          throw Object.assign(new Error(`injected lock ${method} failure`), { code: "EIO" });
        }
        return original.apply(this, args);
      };

      let first;
      try {
        first = await source.write({ rawContent: "first", target: { sourceId: "file-graph", relativePath: `${method}.md` } });
      } finally {
        prototype[method] = original;
      }
      assert.equal(first?.ok, false);
      if (first && !first.ok) assert.equal(first.code, "IO_ERROR");
      await assert.rejects(stat(lockPath), { code: "ENOENT" });

      const retry = await source.write({ rawContent: "retry", target: { sourceId: "file-graph", relativePath: `${method}.md` } });
      assert.equal(retry.ok, true);
      assert.equal(await readFile(target, "utf8"), "retry\n");
    });
  }
});

test("competing process reapers cannot delete an active successor lock", async () => {
  const { root } = await graph();
  const target = join(root, "reaper-race.md");
  const lockPath = `${target}.action-pocket.lock`;
  const crashed = await spawnLockOwner(lockPath);
  crashed.kill("SIGKILL");
  await waitForExit(crashed);

  const moduleUrl = new URL("./fileGraph.js", import.meta.url).href;
  const startPath = join(root, "reaper-race.start");
  const runWriter = (value: string, holdWhileWriting: boolean) => new Promise<number>((resolveWriter, rejectWriter) => {
    const script = `
      import { constants } from "node:fs";
      import { access, open } from "node:fs/promises";
      import { FileGraphSource } from ${JSON.stringify(moduleUrl)};
      const source = new FileGraphSource(${JSON.stringify(root)});
      await source.initialize();
      ${holdWhileWriting ? `
        const probe = await open(${JSON.stringify(join(root, "reaper-race.probe"))}, constants.O_CREAT | constants.O_RDWR, 0o600);
        const prototype = Object.getPrototypeOf(probe);
        const originalWriteFile = prototype.writeFile;
        await probe.close();
        prototype.writeFile = async function (data, ...args) {
          if (Buffer.isBuffer(data) && data.includes(${JSON.stringify(value)})) {
            await new Promise((resolveWait) => setTimeout(resolveWait, 200));
          }
          return originalWriteFile.call(this, data, ...args);
        };
      ` : ""}
      while (true) {
        try { await access(${JSON.stringify(startPath)}); break; }
        catch { await new Promise((resolveWait) => setTimeout(resolveWait, 5)); }
      }
      const receipt = await source.write({ rawContent: ${JSON.stringify(value)}, target: { sourceId: "file-graph", relativePath: "reaper-race.md" } });
      if (!receipt.ok) throw new Error(receipt.code + ": " + receipt.message);
      process.stdout.write(String(receipt.location.line));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectWriter);
    child.once("exit", (code) => code === 0 ? resolveWriter(Number(stdout)) : rejectWriter(new Error(stderr || `writer exited ${code}`)));
  });

  const writers = Array.from({ length: 8 }, (_, index) => runWriter(`reaper-${index}`, index === 0));
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  await writeFile(startPath, "start");
  const lines = await Promise.all(writers);
  const saved = await readFile(target, "utf8");
  assert.deepEqual([...lines].sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (let index = 0; index < 8; index += 1) assert.match(saved, new RegExp(`^reaper-${index}$`, "m"));
  await assert.rejects(stat(lockPath), { code: "ENOENT" });
  await assert.rejects(stat(`${lockPath}.reap`), { code: "ENOENT" });
});

test("a lock left by an abnormally exited owner process is conservatively recovered", async () => {
  const { root, source } = await graph();
  const target = join(root, "crashed.md");
  const child = await spawnLockOwner(`${target}.action-pocket.lock`);
  child.kill("SIGKILL");
  await waitForExit(child);

  const receipt = await source.write({ rawContent: "after crash", target: { sourceId: "file-graph", relativePath: "crashed.md" } });
  assert.equal(receipt.ok, true);
  assert.equal(await readFile(target, "utf8"), "after crash\n");
  await assert.rejects(stat(`${target}.action-pocket.lock`), { code: "ENOENT" });
});

test("a malformed unverifiable lock is preserved until an operator removes it", async () => {
  const { root, source } = await graph();
  const target = join(root, "malformed.md");
  const lockPath = `${target}.action-pocket.lock`;
  await writeFile(lockPath, "not valid lock metadata", { mode: 0o600 });

  const pending = source.write({ rawContent: "after removal", target: { sourceId: "file-graph", relativePath: "malformed.md" } });
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  assert.equal(await readFile(lockPath, "utf8"), "not valid lock metadata");
  await assert.rejects(stat(target), { code: "ENOENT" });

  await unlink(lockPath);
  const receipt = await pending;
  assert.equal(receipt.ok, true);
  assert.equal(await readFile(target, "utf8"), "after removal\n");
});

test("an active lock owner is never preempted", async () => {
  const { root, source } = await graph();
  const target = join(root, "active.md");
  const lockPath = `${target}.action-pocket.lock`;
  const child = await spawnLockOwner(lockPath);
  try {
    const pending = source.write({ rawContent: "after owner exits", target: { sourceId: "file-graph", relativePath: "active.md" } });
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const metadata = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
    assert.equal(metadata.pid, child.pid);
    await assert.rejects(stat(target), { code: "ENOENT" });

    child.kill("SIGKILL");
    await waitForExit(child);
    const receipt = await pending;
    assert.equal(receipt.ok, true);
    assert.equal(await readFile(target, "utf8"), "after owner exits\n");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child);
    }
  }
});

test("returns typed failures for traversal, absolute paths, oversized input, and symlink escape", async () => {
  const { root, source } = await graph();
  const outside = await mkdtemp(join(tmpdir(), "action-pocket-outside-"));
  await symlink(outside, join(root, "escape"), "dir");
  const input = (relativePath: string, rawContent = "safe") => ({ rawContent, target: { sourceId: "file-graph", relativePath } });
  const traversal = await source.write(input("../outside.md"));
  const absolute = await source.write(input("/tmp/outside.md"));
  const symlinked = await source.write(input("escape/leak.md"));
  const oversized = await source.write(input("big.md", "x".repeat(256 * 1024 + 1)));
  assert.equal(traversal.ok, false);
  assert.equal(absolute.ok, false);
  assert.equal(symlinked.ok, false);
  assert.equal(oversized.ok, false);
  if (!traversal.ok) assert.equal(traversal.code, "PATH_OUTSIDE_SOURCE");
  if (!absolute.ok) assert.equal(absolute.code, "INVALID_INPUT");
  if (!symlinked.ok) assert.equal(symlinked.code, "PATH_OUTSIDE_SOURCE");
  if (!oversized.ok) assert.equal(oversized.code, "PAYLOAD_TOO_LARGE");
});

test("returns an explicit IO failure instead of a success receipt", async () => {
  const { root, source } = await graph();
  await mkdir(join(root, "not-a-file.md"));
  const receipt = await source.write({ rawContent: "must-not-succeed", target: { sourceId: "file-graph", relativePath: "not-a-file.md" } });
  assert.equal(receipt.ok, false);
  if (!receipt.ok) assert.equal(receipt.code, "IO_ERROR");
});

test("search skips hidden caches, backup directory, symlinks, and files over the scan limit", async () => {
  const { root, source } = await graph();
  const outside = await mkdtemp(join(tmpdir(), "action-pocket-search-outside-"));
  await mkdir(join(root, ".cache"));
  await mkdir(join(root, "logseq", "bak"), { recursive: true });
  await writeFile(join(root, ".cache", "secret.md"), "uniqueprivatemarker");
  await writeFile(join(root, "logseq", "bak", "old.md"), "uniqueprivatemarker");
  await writeFile(join(outside, "outside.md"), "outside-symlink-marker");
  await symlink(join(outside, "outside.md"), join(root, "linked.md"), "file");
  await writeFile(join(root, "oversized.md"), `uniqueoversizedmarker\n${"x".repeat(2 * 1024 * 1024)}`);
  await writeFile(join(root, "visible.md"), "needle-public");
  assert.equal((await source.search("uniqueprivatemarker", 5)).length, 0);
  assert.equal((await source.search("outside-symlink-marker", 5)).length, 0);
  assert.equal((await source.search("uniqueoversizedmarker", 5)).length, 0);
  assert.equal((await source.search("needle-public", 99)).length, 1);
});

test("search enforces the 32 MiB aggregate budget before reading another candidate", async () => {
  const { root, source } = await graph();
  const maximumFile = 2 * 1024 * 1024;
  for (let index = 0; index < 16; index += 1) {
    await writeFile(join(root, `a-${String(index).padStart(2, "0")}.md`), Buffer.alloc(maximumFile, 97));
  }
  await writeFile(join(root, "z-after-budget.md"), "marker-after-hard-budget");
  assert.equal((await source.search("marker-after-hard-budget", 5)).length, 0);
});

test("search versions change when the source body changes", async () => {
  const { root, source } = await graph();
  const path = join(root, "freshness.md");
  await writeFile(path, "freshness marker v1");
  const first = await source.search("freshness marker", 1);
  await writeFile(path, "freshness marker v2");
  const second = await source.search("freshness marker", 1);
  assert.notEqual(first[0].location.version, second[0].location.version);
});
