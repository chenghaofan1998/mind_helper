import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { attemptDesktopHide } from "./desktopRuntimeState.js";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("Neutralino close exits only the shell and rejected Esc hide reports fallback", async () => {
  const config = JSON.parse(await source("neutralino.config.json"));
  assert.equal(config.modes.window.exitProcessOnClose, true);
  assert.equal(config.modes.window.skipTaskbar, false);

  const bridge = await source("src/desktopRuntime.ts");
  assert.doesNotMatch(bridge, /events\.on\(["']windowClose/);
  assert.match(bridge, /events\.on\("ready", \(\) => \{ nativeRuntime = true; \}\)/);
  assert.match(bridge, /attemptDesktopHide\([\s\S]*?neutralinoWindow\.hide\(\)[\s\S]*?callbacks\?\.onError\(`Esc 隐藏失败/);
  assert.match(bridge, /events\.on\("serverOffline"[\s\S]*?nativeRuntime = false/);

  let rejectedHide: unknown;
  const hidden = await attemptDesktopHide(
    () => Promise.reject(new Error("bridge offline")),
    (error) => { rejectedHide = error; },
  );
  assert.equal(hidden, false);
  assert.equal((rejectedHide as Error).message, "bridge offline");

  const main = await source("src/main.tsx");
  assert.match(main, /event\.key === "Escape" && isDesktopRuntime\(\)/);
  assert.match(main, /hideDesktopWindow\(\)/);
});

test("Windows launcher owns single-instance, retry, shell recovery, tray, and service-failure state", async () => {
  const launcher = await source("native/ActionPocketLauncher.cs");
  const mutexIndex = launcher.indexOf('new Mutex(false, @"Local\\ActionPocket.Launcher")');
  const configurationIndex = launcher.indexOf("GraphConfiguration.Resolve(args)");
  assert.ok(mutexIndex >= 0 && mutexIndex < configurationIndex, "single-instance mutex must precede graph configuration");
  assert.match(launcher, /instanceMutex\.WaitOne\(0, false\)[\s\S]*?if \(!ownsInstance\)[\s\S]*?return;/);
  assert.match(launcher, /private const int ServiceStartAttempts = 3;/);
  assert.match(launcher, /for \(int attempt = 1; attempt <= ServiceStartAttempts; attempt\+\+\)[\s\S]*?PortReservation\.FindAvailable\(\)[\s\S]*?WaitUntilReady/);
  assert.match(launcher, /catch \(InvalidOperationException error\)[\s\S]*?Stop\(candidate\)/);
  assert.match(launcher, /catch \(TimeoutException error\)[\s\S]*?Stop\(candidate\)/);

  assert.match(launcher, /private Process shell;/);
  assert.match(launcher, /private void EnsureShellStarted\(\)/);
  assert.match(launcher, /shell = StartShell\(root, port\)/);
  assert.match(launcher, /if \(shell != null && HasExited\(shell\)\)[\s\S]*?bool restart = showRequested;[\s\S]*?if \(restart\)[\s\S]*?RequestShowShell\(\);/);
  assert.match(launcher, /StableShowTicksRequired = 2[\s\S]*?stableShowTicks >= StableShowTicksRequired[\s\S]*?showRequested = false/);
  assert.doesNotMatch(launcher, /restartShellAfterExit/);
  assert.match(launcher, /if \(IsIconic\(handle\)\)[\s\S]*?ShowWindow\(handle, SwHide\)/);
  assert.match(launcher, /if \(HasExited\(service\)\)[\s\S]*?ExitThread\(\)/);
  assert.match(launcher, /new HotkeyWindow\(ToggleShell\)/);
  assert.match(launcher, /显示 Action Pocket/);
  assert.match(launcher, /隐藏 Action Pocket/);
  assert.match(launcher, /退出 Action Pocket/);
  assert.match(launcher, /ShowBalloonTip\(3000\)/);
  assert.match(launcher, /Path\.Combine\(root, "app", "shell"\)/);
  assert.match(launcher, /Path\.Combine\(appDirectory, "runtime", "node\.exe"\)/);
});

test("Windows package uses an isolated staging tree with one root executable", async () => {
  const script = await source("scripts/prepare-windows-release.ps1");
  assert.match(script, /windows-x64-staging/);
  assert.match(script, /Join-Path \$shellDir "ActionPocketShell\.exe"/);
  assert.match(script, /Join-Path \$shellDir "resources\.neu"/);
  assert.match(script, /Join-Path \$stagingDir "ActionPocket\.exe"/);
  assert.match(script, /\$expectedRootEntries = .*"ActionPocket\.exe".*"app".*"README\.txt"/);
  assert.match(script, /Compare-Object -ReferenceObject \$expectedRootEntries -DifferenceObject \$rootEntries/);
  assert.match(script, /\$_.Name -match "-\(linux\|mac\)_"/);
  assert.match(script, /Compress-Archive -Path \(Join-Path \$stagingDir "\*"\)/);
  assert.doesNotMatch(script, /Compress-Archive -Path \(Join-Path \$neutralinoReleaseDir/);
});
