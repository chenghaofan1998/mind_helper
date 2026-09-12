using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ActionPocketLauncher
{
    /// <summary>
    /// Owns the tray lifecycle: it starts the local knowledge service and the Neutralino shell,
    /// keeps them alive, exposes the tray menu and the global hotkey, and applies the OS backdrop.
    /// Project configuration is edited in a separate settings window and persisted atomically by
    /// <see cref="GraphConfiguration"/>.
    /// </summary>
    internal sealed class LauncherContext : ApplicationContext
    {
        private const int SwHide = 0;
        private const int SwShow = 5;
        private const int SwRestore = 9;
        private const int StableShowTicksRequired = 2;
        private const int MaximumAutomaticShellFailures = 3;

        private readonly string root;
        private readonly LaunchConfiguration configuration;
        private readonly Func<string, int, Process> shellStarter;
        private readonly ShellRestartPolicy shellRestartPolicy;
        private int port;
        private Process service;
        private readonly HotkeyWindow hotkey;
        private readonly NotifyIcon tray;
        private readonly System.Windows.Forms.Timer monitor;
        private Process shell;
        private IntPtr shellHandle;
        private bool backdropFailed;
        private bool showRequested;
        private int stableShowTicks;
        private bool stopping;

        private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        public LauncherContext(LaunchConfiguration launchConfiguration)
            : this(launchConfiguration, ServiceRuntime.StartShell)
        {
        }

        internal LauncherContext(LaunchConfiguration launchConfiguration, Func<string, int, Process> startShell)
        {
            root = AppDomain.CurrentDomain.BaseDirectory;
            configuration = launchConfiguration;
            shellStarter = startShell;
            shellRestartPolicy = new ShellRestartPolicy(MaximumAutomaticShellFailures);
            ServiceRuntime.RunningService runningService = ServiceRuntime.StartReadyService(root, configuration);
            port = runningService.Port;
            service = runningService.Process;
            shell = null;
            shellHandle = IntPtr.Zero;
            hotkey = null;
            tray = null;
            monitor = null;
            try
            {
                shell = shellStarter(root, port);
                showRequested = true;

                hotkey = new HotkeyWindow(ToggleShell);
                if (!hotkey.Register())
                    MessageBox.Show("Ctrl+Alt+P 注册失败，可能已被其他程序占用。仍可通过托盘显示 Action Pocket。", "Action Pocket", MessageBoxButtons.OK, MessageBoxIcon.Warning);

                tray = new NotifyIcon();
                tray.Icon = SystemIcons.Application;
                tray.Text = "Action Pocket（双击显示）";
                tray.ContextMenuStrip = BuildTrayMenu();
                tray.DoubleClick += delegate { RequestShowShell(); };
                tray.Visible = true;
                if (FirstRunNotice.TryMarkShown())
                {
                    tray.BalloonTipTitle = "Action Pocket 正在托盘运行";
                    tray.BalloonTipText = "关闭或最小化窗口后，可双击托盘图标或按 Ctrl+Alt+P 再次显示。项目增删改在托盘“设置…”中完成。";
                    tray.BalloonTipIcon = ToolTipIcon.Info;
                    tray.ShowBalloonTip(3000);
                }

                monitor = new System.Windows.Forms.Timer();
                monitor.Interval = 250;
                monitor.Tick += CheckProcesses;
                monitor.Start();
            }
            catch
            {
                if (tray != null)
                {
                    tray.Visible = false;
                    tray.Dispose();
                }
                if (hotkey != null)
                    hotkey.Dispose();
                Stop(shell);
                Stop(service);
                throw;
            }
        }

        private ContextMenuStrip BuildTrayMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("显示 Action Pocket", null, delegate { RequestShowShell(); });
            menu.Items.Add("隐藏 Action Pocket", null, delegate { HideShell(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("设置…", null, delegate { OpenSettings(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出 Action Pocket", null, delegate { ExitThread(); });
            return menu;
        }

        private void OpenSettings()
        {
            try
            {
                // Import any externally supplied configuration first so the window shows the
                // effective project list, then stage edits against the local projects file.
                GraphConfiguration.EnsureCurrentConfigurationImported(configuration);
                configuration.GraphDirectory = null;
                configuration.ProjectsFile = GraphConfiguration.ProjectsFile;

                bool saved;
                using (ProjectSettingsWindow window = new ProjectSettingsWindow(GraphConfiguration.LoadProjects()))
                {
                    saved = window.ShowDialog() == DialogResult.OK;
                    if (saved) GraphConfiguration.SaveProjects(window.Document);
                }
                if (!saved) return;
                RestartForConfiguration();
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "Action Pocket 设置失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void RestartForConfiguration()
        {
            ServiceRuntime.RunningService replacement = ServiceRuntime.StartReadyService(root, configuration);
            Stop(shell);
            Stop(service);
            service = replacement.Process;
            port = replacement.Port;
            shellHandle = IntPtr.Zero;
            shellRestartPolicy.Reset();
            shell = shellStarter(root, port);
            showRequested = true;
        }

        private void CheckProcesses(object sender, EventArgs args)
        {
            if (stopping)
                return;
            if (HasExited(service))
            {
                MessageBox.Show("知识源服务意外退出，Action Pocket 将关闭。", "Action Pocket", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitThread();
                return;
            }
            if (shell != null && HasExited(shell))
            {
                shell.Dispose();
                shell = null;
                shellHandle = IntPtr.Zero;
                stableShowTicks = 0;
                if (showRequested && !shellRestartPolicy.RegisterFailure()) StopAutomaticShellRestart("桌面壳连续启动失败，已停止自动重试。可从托盘手动重试。");
                return;
            }
            if (shell == null && showRequested)
            {
                if (shellRestartPolicy.TickReady()) TryAutomaticShellRestart();
                return;
            }

            IntPtr handle = FindShellWindow();
            if (handle == IntPtr.Zero)
            {
                stableShowTicks = 0;
                return;
            }
            if (IsIconic(handle))
            {
                if (showRequested)
                {
                    ShowWindow(handle, SwRestore);
                    SetForegroundWindow(handle);
                    stableShowTicks = 0;
                }
                else
                {
                    ShowWindow(handle, SwHide);
                }
                return;
            }
            if (showRequested)
            {
                ShowWindow(handle, SwShow);
                SetForegroundWindow(handle);
                if (IsWindowVisible(handle) && !HasExited(shell))
                {
                    stableShowTicks++;
                    if (stableShowTicks >= StableShowTicksRequired)
                    {
                        showRequested = false;
                        stableShowTicks = 0;
                        shellRestartPolicy.Reset();
                    }
                }
                else
                {
                    stableShowTicks = 0;
                }
            }
        }

        private void TryAutomaticShellRestart()
        {
            try
            {
                shell = shellStarter(root, port);
            }
            catch (Exception error)
            {
                shell = null;
                if (!shellRestartPolicy.RegisterFailure()) StopAutomaticShellRestart("桌面壳连续启动失败：" + error.Message + " 可从托盘手动重试。");
            }
        }

        private void StopAutomaticShellRestart(string message)
        {
            showRequested = false;
            stableShowTicks = 0;
            MessageBox.Show(message, "Action Pocket 窗口启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        private void ToggleShell()
        {
            IntPtr handle = FindShellWindow();
            if (handle != IntPtr.Zero && IsWindowVisible(handle) && !IsIconic(handle))
                HideShell();
            else
                RequestShowShell();
        }

        private void RequestShowShell()
        {
            if (stopping)
                return;
            try
            {
                shellRestartPolicy.Reset();
                EnsureShellStarted();
                showRequested = true;
                stableShowTicks = 0;
                IntPtr handle = FindShellWindow();
                if (handle != IntPtr.Zero)
                {
                    ShowWindow(handle, IsIconic(handle) ? SwRestore : SwShow);
                    SetForegroundWindow(handle);
                }
            }
            catch (Exception error)
            {
                showRequested = false;
                stableShowTicks = 0;
                MessageBox.Show(error.Message, "Action Pocket 窗口启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void HideShell()
        {
            showRequested = false;
            stableShowTicks = 0;
            IntPtr handle = FindShellWindow();
            if (handle != IntPtr.Zero)
            {
                ShowWindow(handle, SwHide);
            }
        }

        private void EnsureShellStarted()
        {
            if (shell != null && !HasExited(shell))
                return;
            if (shell != null)
            {
                shell.Dispose();
                shell = null;
            }
            shellHandle = IntPtr.Zero;
            shell = shellStarter(root, port);
        }

        private void MarkBackdropFailure()
        {
            if (backdropFailed) return;
            backdropFailed = true;
            if (tray != null) tray.Text = "Action Pocket（双击显示 · 不透明背景）";
        }

        private IntPtr FindShellWindow()
        {
            if (shell == null || HasExited(shell)) return IntPtr.Zero;
            if (shellHandle != IntPtr.Zero && IsWindow(shellHandle)) return shellHandle;
            try
            {
                shell.Refresh();
                shellHandle = shell.MainWindowHandle;
                if (shellHandle == IntPtr.Zero) shellHandle = FindWindowForProcess((uint)shell.Id);
                if (shellHandle != IntPtr.Zero && !SystemBackdrop.Apply(shellHandle)) MarkBackdropFailure();
                return shellHandle;
            }
            catch (InvalidOperationException) { return IntPtr.Zero; }
        }

        private static IntPtr FindWindowForProcess(uint expectedProcessId)
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate(IntPtr window, IntPtr parameter)
            {
                uint processId;
                GetWindowThreadProcessId(window, out processId);
                if (processId != expectedProcessId) return true;
                found = window;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        private static bool HasExited(Process process)
        {
            if (process == null)
                return true;
            try { return process.HasExited; }
            catch (InvalidOperationException) { return true; }
        }

        protected override void ExitThreadCore()
        {
            if (!stopping)
            {
                stopping = true;
                if (monitor != null)
                {
                    monitor.Stop();
                    monitor.Dispose();
                }
                if (tray != null)
                {
                    tray.Visible = false;
                    tray.Dispose();
                }
                if (hotkey != null)
                    hotkey.Dispose();
                Stop(shell);
                Stop(service);
            }
            base.ExitThreadCore();
        }

        private static void Stop(Process process)
        {
            if (process == null)
                return;
            try
            {
                if (!process.HasExited)
                {
                    process.Kill();
                    process.WaitForExit(3000);
                }
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            finally { process.Dispose(); }
        }
    }
}
