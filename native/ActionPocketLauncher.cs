using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace ActionPocketLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            if (HasArgument(args, "--self-test"))
            {
                Environment.Exit(SelfTest.Run());
                return;
            }

            bool ownsInstance = false;
            using (Mutex instanceMutex = new Mutex(false, @"Local\ActionPocket.Launcher"))
            {
                try
                {
                    try { ownsInstance = instanceMutex.WaitOne(0, false); }
                    catch (AbandonedMutexException) { ownsInstance = true; }
                    if (!ownsInstance)
                        return;

                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    try
                    {
                        string graphDirectory = GraphConfiguration.Resolve(args);
                        Application.Run(new LauncherContext(graphDirectory));
                    }
                    catch (Exception error)
                    {
                        MessageBox.Show(error.Message, "Action Pocket 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
                finally
                {
                    if (ownsInstance)
                        instanceMutex.ReleaseMutex();
                }
            }
        }

        private static bool HasArgument(string[] args, string expected)
        {
            foreach (string value in args)
                if (string.Equals(value, expected, StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }
    }

    internal static class GraphConfiguration
    {
        private static readonly string ConfigFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ActionPocket",
            "graph-path.txt");

        public static string Resolve(string[] args)
        {
            string fromArgument = ReadArgument(args, "--graph-dir");
            string fromEnvironment = Environment.GetEnvironmentVariable("AP_GRAPH_DIR");
            string configured = ReadConfiguredPath();
            string candidate = FirstValue(fromArgument, fromEnvironment, configured);
            bool forceSelection = Contains(args, "--choose-graph");

            if (forceSelection)
                candidate = SelectDirectory();
            if (string.IsNullOrWhiteSpace(candidate))
                return null;

            string trimmed = candidate.Trim();
            if (!Path.IsPathRooted(trimmed))
                throw new InvalidOperationException("知识库目录必须使用绝对路径：" + trimmed);
            string fullPath = Path.GetFullPath(trimmed);
            if (!Directory.Exists(fullPath))
                throw new InvalidOperationException("知识库目录不存在：" + fullPath);
            if (!string.Equals(candidate, fromEnvironment, StringComparison.Ordinal))
                Save(fullPath);
            return fullPath;
        }

        private static string SelectDirectory()
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择 Action Pocket 使用的文件型知识库目录";
                dialog.ShowNewFolderButton = false;
                return dialog.ShowDialog() == DialogResult.OK ? dialog.SelectedPath : null;
            }
        }

        private static string ReadConfiguredPath()
        {
            try { return File.Exists(ConfigFile) ? File.ReadAllText(ConfigFile).Trim() : null; }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }

        private static void Save(string value)
        {
            string directory = Path.GetDirectoryName(ConfigFile);
            Directory.CreateDirectory(directory);
            File.WriteAllText(ConfigFile, value);
        }

        private static string ReadArgument(string[] args, string name)
        {
            for (int index = 0; index < args.Length; index++)
            {
                if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
                    return args[index + 1];
                string prefix = name + "=";
                if (args[index].StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    return args[index].Substring(prefix.Length);
            }
            return null;
        }

        private static string FirstValue(params string[] values)
        {
            foreach (string value in values)
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            return null;
        }

        private static bool Contains(string[] args, string expected)
        {
            foreach (string value in args)
                if (string.Equals(value, expected, StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }
    }

    internal sealed class LauncherContext : ApplicationContext
    {
        private const int SwHide = 0;
        private const int SwShow = 5;
        private const int SwRestore = 9;
        private const int StableShowTicksRequired = 2;
        private const int ServiceStartAttempts = 3;

        private readonly string root;
        private readonly int port;
        private readonly Process service;
        private readonly HotkeyWindow hotkey;
        private readonly NotifyIcon tray;
        private readonly System.Windows.Forms.Timer monitor;
        private Process shell;
        private bool showRequested;
        private int stableShowTicks;
        private bool stopping;

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        public LauncherContext(string graphDirectory)
        {
            root = AppDomain.CurrentDomain.BaseDirectory;
            RunningService runningService = StartReadyService(root, graphDirectory);
            port = runningService.Port;
            service = runningService.Process;
            shell = null;
            hotkey = null;
            tray = null;
            monitor = null;
            try
            {
                shell = StartShell(root, port);

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
                    tray.BalloonTipText = "关闭或最小化窗口后，可双击托盘图标或按 Ctrl+Alt+P 再次显示。";
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
            menu.Items.Add("退出 Action Pocket", null, delegate { ExitThread(); });
            return menu;
        }

        private static RunningService StartReadyService(string root, string graphDirectory)
        {
            Exception lastError = null;
            for (int attempt = 1; attempt <= ServiceStartAttempts; attempt++)
            {
                int candidatePort = PortReservation.FindAvailable();
                Process candidate = StartService(root, graphDirectory, candidatePort);
                try
                {
                    WaitUntilReady(candidate, candidatePort, TimeSpan.FromSeconds(10));
                    return new RunningService(candidate, candidatePort);
                }
                catch (InvalidOperationException error)
                {
                    lastError = error;
                    Stop(candidate);
                }
                catch (TimeoutException error)
                {
                    lastError = error;
                    Stop(candidate);
                }
            }
            throw new InvalidOperationException("知识源服务在重新选择端口后仍无法启动。", lastError);
        }

        private static Process StartService(string root, string graphDirectory, int port)
        {
            string appDirectory = Path.Combine(root, "app");
            string node = Path.Combine(appDirectory, "runtime", "node.exe");
            string entry = Path.Combine(appDirectory, "server-dist", "server", "app.js");
            RequireFile(node, "缺少内置 Node 运行时");
            RequireFile(entry, "缺少知识源服务");
            RequireDirectory(Path.Combine(appDirectory, "web-dist"), "缺少 Web 资源");

            ProcessStartInfo start = new ProcessStartInfo(node, Quote(entry));
            start.WorkingDirectory = appDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            if (!string.IsNullOrWhiteSpace(graphDirectory))
                start.EnvironmentVariables["AP_GRAPH_DIR"] = graphDirectory;
            start.EnvironmentVariables["AP_PORT"] = port.ToString();
            return Process.Start(start);
        }

        private static Process StartShell(string root, int port)
        {
            string shellDirectory = Path.Combine(root, "app", "shell");
            string executable = Path.Combine(shellDirectory, "ActionPocketShell.exe");
            RequireFile(executable, "缺少桌面壳");
            RequireFile(Path.Combine(shellDirectory, "resources.neu"), "缺少桌面壳资源");
            ProcessStartInfo start = new ProcessStartInfo(executable, "--url=http://127.0.0.1:" + port);
            start.WorkingDirectory = shellDirectory;
            start.UseShellExecute = false;
            return Process.Start(start);
        }

        private static void WaitUntilReady(Process process, int port, TimeSpan timeout)
        {
            Stopwatch timer = Stopwatch.StartNew();
            string url = "http://127.0.0.1:" + port + "/";
            while (timer.Elapsed < timeout)
            {
                if (process.HasExited)
                    throw new InvalidOperationException("知识源服务启动失败，退出码：" + process.ExitCode);
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                    request.Timeout = 500;
                    request.AllowAutoRedirect = false;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if (response.StatusCode == HttpStatusCode.OK)
                        {
                            Thread.Sleep(100);
                            if (process.HasExited)
                                throw new InvalidOperationException("知识源服务启动失败，退出码：" + process.ExitCode);
                            return;
                        }
                    }
                }
                catch (WebException) { }
                Thread.Sleep(100);
            }
            throw new TimeoutException("知识源服务在 10 秒内未就绪。");
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
                bool restart = showRequested;
                shell.Dispose();
                shell = null;
                stableShowTicks = 0;
                if (restart)
                    RequestShowShell();
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
                    }
                }
                else
                {
                    stableShowTicks = 0;
                }
            }
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
                ShowWindow(handle, SwHide);
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
            shell = StartShell(root, port);
        }

        private IntPtr FindShellWindow()
        {
            if (shell == null || HasExited(shell))
                return IntPtr.Zero;
            try
            {
                shell.Refresh();
                return shell.MainWindowHandle;
            }
            catch (InvalidOperationException) { return IntPtr.Zero; }
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

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static void RequireFile(string path, string message)
        {
            if (!File.Exists(path))
                throw new FileNotFoundException(message + "：" + path, path);
        }

        private static void RequireDirectory(string path, string message)
        {
            if (!Directory.Exists(path))
                throw new DirectoryNotFoundException(message + "：" + path);
        }

        private sealed class RunningService
        {
            public readonly Process Process;
            public readonly int Port;

            public RunningService(Process process, int port)
            {
                Process = process;
                Port = port;
            }
        }
    }

    internal static class FirstRunNotice
    {
        public static bool TryMarkShown()
        {
            try
            {
                string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ActionPocket");
                string marker = Path.Combine(directory, "tray-notice-shown");
                if (File.Exists(marker))
                    return false;
                Directory.CreateDirectory(directory);
                File.WriteAllText(marker, DateTime.UtcNow.ToString("O"));
                return true;
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }
    }

    internal static class PortReservation
    {
        public static int FindAvailable()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            try { return ((IPEndPoint)listener.LocalEndpoint).Port; }
            finally { listener.Stop(); }
        }
    }

    internal sealed class HotkeyWindow : NativeWindow, IDisposable
    {
        private const int WmHotkey = 0x0312;
        private const int HotkeyId = 0x4150;
        private const int ModAlt = 0x0001;
        private const int ModControl = 0x0002;
        private readonly Action toggleShell;
        private bool registered;

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr window, int id, int modifiers, uint key);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr window, int id);

        public HotkeyWindow(Action toggleShellAction)
        {
            toggleShell = toggleShellAction;
            CreateHandle(new CreateParams());
        }

        public bool Register()
        {
            registered = RegisterHotKey(Handle, HotkeyId, ModAlt | ModControl, 0x50);
            return registered;
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WmHotkey && message.WParam.ToInt32() == HotkeyId)
                toggleShell();
            base.WndProc(ref message);
        }

        public void Dispose()
        {
            if (registered)
                UnregisterHotKey(Handle, HotkeyId);
            DestroyHandle();
        }
    }

    internal static class SelfTest
    {
        public static int Run()
        {
            try
            {
                int port = PortReservation.FindAvailable();
                return port > 0 && port <= 65535 ? 0 : 1;
            }
            catch { return 1; }
        }
    }
}
