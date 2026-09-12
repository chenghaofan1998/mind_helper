import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { attemptDesktopHide } from "./desktopRuntimeState.js";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

/** The Windows launcher is split across several files; contract checks read them as one unit. */
async function nativeSourceFiles(): Promise<string[]> {
  const directory = join(process.cwd(), "native");
  const names = await readdir(directory);
  return names.filter((name) => name.endsWith(".cs")).sort();
}

async function nativeSource(): Promise<string> {
  const directory = join(process.cwd(), "native");
  const parts = await Promise.all((await nativeSourceFiles()).map((name) => readFile(join(directory, name), "utf8")));
  return parts.join("\n");
}

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

test("Windows launcher caches the shell HWND and recovers hidden, minimized and exited shells (source contract)", async () => {
  const launcher = await nativeSource();
  const mutexIndex = launcher.indexOf('new Mutex(false, @"Local\\ActionPocket.Launcher")');
  const configurationIndex = launcher.indexOf("GraphConfiguration.Resolve(args)");
  assert.ok(mutexIndex >= 0 && mutexIndex < configurationIndex);
  assert.match(launcher, /private IntPtr shellHandle;/);
  assert.match(launcher, /shellHandle != IntPtr\.Zero && IsWindow\(shellHandle\)/);
  assert.match(launcher, /FindWindowForProcess\(\(uint\)shell\.Id\)/);
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

test("Windows tray menu is limited to show, hide, settings and exit (source contract)", async () => {
  const launcher = await nativeSource();
  assert.match(launcher, /ContextMenuStrip menu = new ContextMenuStrip\(\)/);
  assert.match(launcher, /menu\.Items\.Add\("显示 Action Pocket"/);
  assert.match(launcher, /menu\.Items\.Add\("隐藏 Action Pocket"/);
  assert.match(launcher, /menu\.Items\.Add\("设置…"/);
  assert.match(launcher, /menu\.Items\.Add\("退出 Action Pocket"/);
  assert.doesNotMatch(launcher, /添加文件夹项目…|添加 Markdown 项目…/);
});

test("Windows settings window stages project edits and owns its pickers (source contract)", async () => {
  const launcher = await nativeSource();
  const settings = await source("native/SettingsWindow.cs");
  assert.match(settings, /internal sealed class ProjectSettingsWindow : Form/);
  assert.match(settings, /FolderBrowserDialog/);
  assert.match(settings, /OpenFileDialog/);
  assert.match(settings, /\.md;\*\.markdown/);
  // Dialogs must be owned by the settings window so they cannot fall behind the shell.
  assert.match(settings, /dialog\.ShowDialog\(this\)/);
  assert.match(settings, /GraphConfiguration\.AddProjectToDocument\(document/);
  assert.match(settings, /设为默认项目/);
  assert.match(settings, /document\.activeProjectId = project\.id/);
  assert.match(settings, /这是最后一个项目/);
  assert.match(settings, /标准 Connector 后续通过同一来源模型接入/);
  assert.match(settings, /DialogResult = DialogResult\.OK;/);
  // The tray "设置…" entry stages into a window and only restarts after a real save.
  assert.match(launcher, /menu\.Items\.Add\("设置…", null, delegate \{ OpenSettings\(\); \}\)/);
  assert.match(launcher, /GraphConfiguration\.EnsureCurrentConfigurationImported\(configuration\);\s+configuration\.GraphDirectory = null;\s+configuration\.ProjectsFile = GraphConfiguration\.ProjectsFile/);
  assert.match(launcher, /window\.ShowDialog\(\) == DialogResult\.OK/);
});

test("Windows launcher persists and assembles folder and single-Markdown projects (source contract)", async () => {
  const launcher = await nativeSource();
  const config = await source("native/GraphConfiguration.cs");
  assert.match(config, /projects\.v1\.json/);
  assert.match(config, /AP_PROJECTS_FILE/);
  assert.match(config, /File\.Replace\(temporary, ProjectsFile, null\)/);
  assert.match(config, /AddProjectToDocument\(destination, "directory"/);
  assert.match(config, /LoadProjects\(ValidateProjectsFile\(configuration\.ProjectsFile\)\)/);
  assert.match(launcher, /RestartForConfiguration\(\)/);
  assert.match(launcher, /imported\.projects\.Count == 2/);

  const build = await source("native/build.ps1");
  assert.match(build, /System\.Web\.Extensions\.dll/);
});

test("Windows launcher sources are split by responsibility and stay under 500 lines (source contract)", async () => {
  const files = await nativeSourceFiles();
  assert.ok(files.length >= 6, `expected several native sources, found ${files.join(", ")}`);
  for (const name of files) {
    const text = await source(join("native", name));
    const lineCount = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n").length;
    assert.ok(lineCount < 500, `${name} has ${lineCount} lines`);
  }
  const build = await source("native/build.ps1");
  assert.match(build, /Get-ChildItem -LiteralPath \$PSScriptRoot -Filter "\*\.cs"/);
  assert.match(build, /\$sources/);
});

test("Windows backdrop has an opaque fallback for rejected or unavailable Acrylic (source contract)", async () => {
  const launcher = await nativeSource();
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
