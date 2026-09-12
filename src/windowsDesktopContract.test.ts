import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { attemptDesktopHide } from "./desktopRuntimeState.js";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("Neutralino is borderless and bridge startup has no premature not-ready warning", async () => {
  const config = JSON.parse(await source("neutralino.config.json"));
  assert.equal(config.modes.window.exitProcessOnClose, true);
  assert.equal(config.modes.window.borderless, true);
  assert.equal(config.modes.window.transparent, true);

  const bridge = await source("src/desktopRuntime.ts");
  assert.match(bridge, /type BridgeState = "idle" \| "connecting" \| "ready" \| "offline" \| "failed"/);
  assert.doesNotMatch(bridge, /桌面桥接未就绪|setTimeout\(/);
  assert.doesNotMatch(bridge, /throw error/);
  assert.match(bridge, /暂时无法隐藏窗口/);

  let rejectedHide: unknown;
  const hidden = await attemptDesktopHide(() => Promise.reject(new Error("offline")), (error) => { rejectedHide = error; });
  assert.equal(hidden, false);
  assert.equal((rejectedHide as Error).message, "offline");

  const main = await source("src/main.tsx");
  assert.match(main, /event\.key === "Escape" && isDesktopRuntime\(\)/);
  assert.doesNotMatch(main, /event\.key === "Escape"[^\n]*preventDefault/);
});

test("Windows launcher caches HWND and explicitly recovers hidden, minimized, and exited shells", async () => {
  const launcher = await source("native/ActionPocketLauncher.cs");
  const mutexIndex = launcher.indexOf('new Mutex(false, @"Local\\ActionPocket.Launcher")');
  const configurationIndex = launcher.indexOf("GraphConfiguration.Resolve(args)");
  assert.ok(mutexIndex >= 0 && mutexIndex < configurationIndex);
  assert.match(launcher, /private IntPtr shellHandle;/);
  assert.match(launcher, /shellHandle != IntPtr.Zero && IsWindow\(shellHandle\)/);
  assert.match(launcher, /FindWindowForProcess\(\(uint\)shell.Id\)/);
  assert.match(launcher, /shell = shellStarter\(root, port\);\s+showRequested = true/);
  assert.match(launcher, /ShowWindow\(handle, IsIconic\(handle\) \? SwRestore : SwShow\)/);
  assert.match(launcher, /SetForegroundWindow\(handle\)/);
  assert.match(launcher, /new HotkeyWindow\(ToggleShell\)/);
  assert.match(launcher, /DoubleClick \+= delegate \{ RequestShowShell\(\); \}/);
  assert.match(launcher, /DwmSetWindowAttribute/);
  assert.match(launcher, /AccentEnableAcrylicBlurBehind/);
  assert.match(launcher, /Func<string, int, Process> shellStarter/);
  assert.match(launcher, /MaximumAutomaticShellFailures = 3/);
  assert.match(launcher, /shellRestartPolicy\.RegisterFailure\(\)/);
  assert.match(launcher, /StopAutomaticShellRestart/);
  assert.match(launcher, /可从托盘手动重试/);
});

test("Windows launcher persists and assembles folder and single-Markdown projects", async () => {
  const launcher = await source("native/ActionPocketLauncher.cs");
  assert.match(launcher, /projects\.v1\.json/);
  assert.match(launcher, /添加文件夹项目/);
  assert.match(launcher, /添加 Markdown 项目/);
  assert.match(launcher, /OpenFileDialog/);
  assert.match(launcher, /\.md;\*\.markdown/);
  assert.match(launcher, /AP_PROJECTS_FILE/);
  assert.match(launcher, /File\.Replace\(temporary, ProjectsFile, null\)/);
  assert.match(launcher, /RestartForConfiguration/);
  const importIndex = launcher.indexOf("GraphConfiguration.EnsureCurrentConfigurationImported(configuration)");
  const pickerIndex = launcher.indexOf("if (!picker()) return", importIndex);
  assert.ok(importIndex >= 0 && pickerIndex > importIndex);
  assert.match(launcher, /AddProjectToDocument\(destination, "directory"/);
  assert.match(launcher, /LoadProjects\(ValidateProjectsFile\(configuration\.ProjectsFile\)\)/);
  assert.match(launcher, /imported\.projects\.Count == 2/);

  const build = await source("native/build.ps1");
  assert.match(build, /System\.Web\.Extensions\.dll/);
});

test("Windows backdrop has an opaque fallback for rejected or unavailable Acrylic", async () => {
  const launcher = await source("native/ActionPocketLauncher.cs");
  assert.match(launcher, /public static bool Apply\(IntPtr window\)/);
  assert.match(launcher, /applyAcrylic\(\) != 0 \? BackdropMode\.Acrylic : BackdropMode\.Opaque/);
  assert.match(launcher, /catch \(EntryPointNotFoundException\) \{ return BackdropMode\.Opaque; \}/);
  assert.match(launcher, /ApplyOpaqueFallback\(window\)/);
  assert.match(launcher, /AccentEnableGradient/);
  assert.match(launcher, /SetLayeredWindowAttributes\(window, 0, 255, LwaAlpha\)/);
  assert.match(launcher, /MarkBackdropFailure\(\)/);
  assert.match(launcher, /acrylicFailure == BackdropMode\.Opaque && missingApi == BackdropMode\.Opaque/);
});

test("Windows package uses an isolated staging tree with one root executable", async () => {
  const script = await source("scripts/prepare-windows-release.ps1");
  assert.match(script, /windows-x64-staging/);
  assert.match(script, /Join-Path \$shellDir "ActionPocketShell\.exe"/);
  assert.match(script, /Join-Path \$stagingDir "ActionPocket\.exe"/);
  assert.match(script, /Compress-Archive -Path \(Join-Path \$stagingDir "\*"\)/);
});
