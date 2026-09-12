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
        private readonly Process service;
        private readonly Process shell;
        private readonly HotkeyWindow hotkey;
        private readonly NotifyIcon tray;
        private readonly System.Windows.Forms.Timer monitor;
        private bool stopping;

        public LauncherContext(string graphDirectory)
        {
            service = null;
            shell = null;
            hotkey = null;
            tray = null;
            monitor = null;
            try
            {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                int port = PortReservation.FindAvailable();
                service = StartService(root, graphDirectory, port);
                WaitUntilReady(service, port, TimeSpan.FromSeconds(10));
                shell = StartShell(root, port);

                hotkey = new HotkeyWindow(shell);
                if (!hotkey.Register())
                    MessageBox.Show("Ctrl+Alt+P 注册失败，可能已被其他程序占用。仍可通过托盘打开 Action Pocket。", "Action Pocket", MessageBoxButtons.OK, MessageBoxIcon.Warning);

                tray = new NotifyIcon();
                tray.Icon = SystemIcons.Application;
                tray.Text = "Action Pocket";
                tray.ContextMenuStrip = BuildTrayMenu();
                tray.DoubleClick += delegate { hotkey.ShowShell(); };
                tray.Visible = true;

                monitor = new System.Windows.Forms.Timer();
                monitor.Interval = 1000;
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
            menu.Items.Add("打开 Action Pocket", null, delegate { hotkey.ShowShell(); });
            menu.Items.Add("隐藏窗口", null, delegate { hotkey.HideShell(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitThread(); });
            return menu;
        }

        private static Process StartService(string root, string graphDirectory, int port)
        {
            string appDirectory = Path.Combine(root, "app");
            string node = Path.Combine(root, "runtime", "node.exe");
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
            string executable = Path.Combine(root, "ActionPocketShell.exe");
            RequireFile(executable, "缺少桌面壳");
            ProcessStartInfo start = new ProcessStartInfo(executable, "--url=http://127.0.0.1:" + port);
            start.WorkingDirectory = root;
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
                        if (response.StatusCode == HttpStatusCode.OK)
                            return;
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
            if (shell.HasExited)
            {
                ExitThread();
                return;
            }
            if (service.HasExited)
            {
                MessageBox.Show("知识源服务意外退出，Action Pocket 将关闭。", "Action Pocket", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitThread();
            }
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
        private const int SwHide = 0;
        private const int SwShow = 5;
        private readonly Process shell;
        private bool registered;

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr window, int id, int modifiers, uint key);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr window, int id);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        public HotkeyWindow(Process shellProcess)
        {
            shell = shellProcess;
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
                ToggleShell();
            base.WndProc(ref message);
        }

        public void ToggleShell()
        {
            IntPtr handle = FindMainWindow();
            if (handle == IntPtr.Zero)
                return;
            if (IsWindowVisible(handle)) HideShell();
            else ShowShell();
        }

        public void ShowShell()
        {
            IntPtr handle = FindMainWindow();
            if (handle == IntPtr.Zero)
                return;
            ShowWindow(handle, SwShow);
            SetForegroundWindow(handle);
        }

        public void HideShell()
        {
            IntPtr handle = FindMainWindow();
            if (handle != IntPtr.Zero)
                ShowWindow(handle, SwHide);
        }

        private IntPtr FindMainWindow()
        {
            try
            {
                shell.Refresh();
                if (shell.MainWindowHandle != IntPtr.Zero)
                    return shell.MainWindowHandle;
                shell.WaitForInputIdle(1000);
                shell.Refresh();
                return shell.MainWindowHandle;
            }
            catch (InvalidOperationException) { return IntPtr.Zero; }
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
