using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
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
                        LaunchConfiguration configuration = GraphConfiguration.Resolve(args);
                        Application.Run(new LauncherContext(configuration));
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

    internal sealed class LaunchConfiguration
    {
        public string GraphDirectory;
        public string GraphKind;
        public string ProjectsFile;
    }

    public sealed class ProjectsDocument
    {
        public int version = 1;
        public string activeProjectId;
        public List<ProjectEntry> projects = new List<ProjectEntry>();
    }

    public sealed class ProjectEntry
    {
        public string id;
        public string name;
        public List<ProjectSourceEntry> sources = new List<ProjectSourceEntry>();
        public string defaultSourceId;
    }

    public sealed class ProjectSourceEntry
    {
        public string id;
        public string kind;
        public ProjectScopeEntry scope;
    }

    public sealed class ProjectScopeEntry
    {
        public string kind;
        public string path;
    }

    internal static class GraphConfiguration
    {
        private static readonly string ConfigDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ActionPocket");
        private static readonly string LegacyFile = Path.Combine(ConfigDirectory, "graph-path.txt");
        public static readonly string ProjectsFile = Path.Combine(ConfigDirectory, "projects.v1.json");

        public static LaunchConfiguration Resolve(string[] args)
        {
            string explicitProjects = Environment.GetEnvironmentVariable("AP_PROJECTS_FILE");
            if (!string.IsNullOrWhiteSpace(explicitProjects)) return new LaunchConfiguration { ProjectsFile = ValidateProjectsFile(explicitProjects) };
            string explicitGraph = FirstValue(ReadArgument(args, "--graph-dir"), Environment.GetEnvironmentVariable("AP_GRAPH_DIR"));
            if (!string.IsNullOrWhiteSpace(explicitGraph))
            {
                string graphKind = Environment.GetEnvironmentVariable("AP_GRAPH_KIND");
                if (graphKind != "logseq-files") graphKind = "markdown-files";
                return new LaunchConfiguration { GraphDirectory = ValidateDirectory(explicitGraph), GraphKind = graphKind };
            }
            MigrateLegacyConfiguration();
            if (Contains(args, "--choose-graph")) AddDirectoryProject();
            return new LaunchConfiguration { ProjectsFile = File.Exists(ProjectsFile) ? ProjectsFile : null };
        }

        public static void EnsureCurrentConfigurationImported(LaunchConfiguration configuration)
        {
            if (configuration == null) return;
            bool localProjectsAlreadyActive = !string.IsNullOrWhiteSpace(configuration.ProjectsFile)
                && string.Equals(Path.GetFullPath(configuration.ProjectsFile), Path.GetFullPath(ProjectsFile), StringComparison.OrdinalIgnoreCase);
            if (localProjectsAlreadyActive) return;

            ProjectsDocument destination = LoadProjects();
            if (!string.IsNullOrWhiteSpace(configuration.GraphDirectory))
            {
                AddProjectToDocument(destination, "directory", ValidateDirectory(configuration.GraphDirectory), null, configuration.GraphKind);
            }
            else if (!string.IsNullOrWhiteSpace(configuration.ProjectsFile))
            {
                ProjectsDocument source = LoadProjects(ValidateProjectsFile(configuration.ProjectsFile));
                foreach (ProjectEntry project in source.projects)
                {
                    if (project == null || project.sources == null || project.sources.Count != 1 || project.sources[0] == null || project.sources[0].scope == null)
                        throw new InvalidOperationException("外部项目配置无效。");
                    ProjectSourceEntry item = project.sources[0];
                    AddProjectToDocument(destination, item.scope.kind, item.scope.path, project.name, item.kind);
                }
            }
            SaveProjects(destination);
        }

        public static bool AddDirectoryProject()
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "添加一个文件夹项目";
                dialog.ShowNewFolderButton = false;
                if (dialog.ShowDialog() != DialogResult.OK) return false;
                AddProject("directory", ValidateDirectory(dialog.SelectedPath));
                return true;
            }
        }

        public static bool AddMarkdownProject()
        {
            using (OpenFileDialog dialog = new OpenFileDialog())
            {
                dialog.Title = "添加一个 Markdown 文件项目";
                dialog.Filter = "Markdown (*.md;*.markdown)|*.md;*.markdown";
                dialog.Multiselect = false;
                dialog.CheckFileExists = true;
                if (dialog.ShowDialog() != DialogResult.OK) return false;
                string path = Path.GetFullPath(dialog.FileName);
                string extension = Path.GetExtension(path);
                if (!File.Exists(path) || !(extension.Equals(".md", StringComparison.OrdinalIgnoreCase) || extension.Equals(".markdown", StringComparison.OrdinalIgnoreCase)))
                    throw new InvalidOperationException("只能添加已存在的 .md 或 .markdown 文件。");
                AddProject("file", path);
                return true;
            }
        }

        private static void AddProject(string scopeKind, string path)
        {
            ProjectsDocument document = LoadProjects();
            if (!AddProjectToDocument(document, scopeKind, path, null, null))
                throw new InvalidOperationException("这个项目已经添加。");
            SaveProjects(document);
        }

        internal static bool AddProjectToDocument(ProjectsDocument document, string scopeKind, string path, string preferredName, string sourceKind)
        {
            if (scopeKind != "directory" && scopeKind != "file") throw new InvalidOperationException("项目 scope.kind 无效。");
            path = scopeKind == "directory" ? ValidateDirectory(path) : ValidateMarkdownFile(path);
            foreach (ProjectEntry existing in document.projects)
                if (existing != null && existing.sources != null && existing.sources.Count > 0 && existing.sources[0] != null
                    && existing.sources[0].scope != null && string.Equals(existing.sources[0].scope.path, path, StringComparison.OrdinalIgnoreCase))
                    return false;
            string projectId = "project-" + Guid.NewGuid().ToString("N");
            string sourceId = "source-" + Guid.NewGuid().ToString("N");
            string name = string.IsNullOrWhiteSpace(preferredName)
                ? (scopeKind == "file" ? Path.GetFileNameWithoutExtension(path) : new DirectoryInfo(path).Name)
                : preferredName.Trim();
            if (string.IsNullOrWhiteSpace(name)) name = "Markdown 项目";
            string kind = sourceKind == "logseq-files" ? "logseq-files" : "markdown-files";
            ProjectEntry project = new ProjectEntry { id = projectId, name = name, defaultSourceId = sourceId };
            project.sources.Add(new ProjectSourceEntry { id = sourceId, kind = kind, scope = new ProjectScopeEntry { kind = scopeKind, path = path } });
            document.projects.Add(project);
            if (string.IsNullOrWhiteSpace(document.activeProjectId)) document.activeProjectId = projectId;
            return true;
        }

        private static ProjectsDocument LoadProjects(string path = null)
        {
            string selectedPath = string.IsNullOrWhiteSpace(path) ? ProjectsFile : path;
            if (!File.Exists(selectedPath)) return new ProjectsDocument();
            FileInfo info = new FileInfo(selectedPath);
            if (info.Length > 256 * 1024) throw new InvalidOperationException("项目配置文件过大。");
            ProjectsDocument document = new JavaScriptSerializer().Deserialize<ProjectsDocument>(File.ReadAllText(selectedPath, Encoding.UTF8));
            if (document == null || document.version != 1 || document.projects == null) throw new InvalidOperationException("项目配置文件无效。");
            return document;
        }

        private static void SaveProjects(ProjectsDocument document)
        {
            Directory.CreateDirectory(ConfigDirectory);
            string temporary = ProjectsFile + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(document), new UTF8Encoding(false));
            if (File.Exists(ProjectsFile)) File.Replace(temporary, ProjectsFile, null);
            else File.Move(temporary, ProjectsFile);
        }

        private static void MigrateLegacyConfiguration()
        {
            if (File.Exists(ProjectsFile) || !File.Exists(LegacyFile)) return;
            string value = File.ReadAllText(LegacyFile).Trim();
            if (!string.IsNullOrWhiteSpace(value)) AddProject("directory", ValidateDirectory(value));
        }

        private static string ValidateDirectory(string value)
        {
            string trimmed = value.Trim();
            if (!Path.IsPathRooted(trimmed)) throw new InvalidOperationException("知识库目录必须使用绝对路径：" + trimmed);
            string path = Path.GetFullPath(trimmed);
            if (!Directory.Exists(path)) throw new InvalidOperationException("知识库目录不存在：" + path);
            return path;
        }

        private static string ValidateMarkdownFile(string value)
        {
            string path = Path.GetFullPath(value.Trim());
            string extension = Path.GetExtension(path);
            if (!Path.IsPathRooted(value.Trim()) || !File.Exists(path)
                || !(extension.Equals(".md", StringComparison.OrdinalIgnoreCase) || extension.Equals(".markdown", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("Markdown 项目必须是已存在的绝对 .md 或 .markdown 文件：" + path);
            return path;
        }

        private static string ValidateProjectsFile(string value)
        {
            if (!Path.IsPathRooted(value.Trim())) throw new InvalidOperationException("项目配置文件必须使用绝对路径。");
            string path = Path.GetFullPath(value.Trim());
            if (!File.Exists(path)) throw new InvalidOperationException("项目配置文件不存在：" + path);
            return path;
        }

        private static string ReadArgument(string[] args, string name)
        {
            for (int index = 0; index < args.Length; index++)
            {
                if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length) return args[index + 1];
                string prefix = name + "=";
                if (args[index].StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return args[index].Substring(prefix.Length);
            }
            return null;
        }

        private static string FirstValue(params string[] values)
        {
            foreach (string value in values) if (!string.IsNullOrWhiteSpace(value)) return value;
            return null;
        }

        private static bool Contains(string[] args, string expected)
        {
            foreach (string value in args) if (string.Equals(value, expected, StringComparison.OrdinalIgnoreCase)) return true;
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
            : this(launchConfiguration, StartShell)
        {
        }

        internal LauncherContext(LaunchConfiguration launchConfiguration, Func<string, int, Process> startShell)
        {
            root = AppDomain.CurrentDomain.BaseDirectory;
            configuration = launchConfiguration;
            shellStarter = startShell;
            shellRestartPolicy = new ShellRestartPolicy(MaximumAutomaticShellFailures);
            RunningService runningService = StartReadyService(root, configuration);
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
            menu.Items.Add("添加文件夹项目…", null, delegate { AddProject(GraphConfiguration.AddDirectoryProject); });
            menu.Items.Add("添加 Markdown 项目…", null, delegate { AddProject(GraphConfiguration.AddMarkdownProject); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出 Action Pocket", null, delegate { ExitThread(); });
            return menu;
        }

        private void AddProject(Func<bool> picker)
        {
            try
            {
                GraphConfiguration.EnsureCurrentConfigurationImported(configuration);
                if (!picker()) return;
                configuration.GraphDirectory = null;
                configuration.ProjectsFile = GraphConfiguration.ProjectsFile;
                RestartForConfiguration();
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "Action Pocket 添加项目失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void RestartForConfiguration()
        {
            RunningService replacement = StartReadyService(root, configuration);
            Stop(shell);
            Stop(service);
            service = replacement.Process;
            port = replacement.Port;
            shellHandle = IntPtr.Zero;
            shellRestartPolicy.Reset();
            shell = shellStarter(root, port);
            showRequested = true;
        }

        private static RunningService StartReadyService(string root, LaunchConfiguration configuration)
        {
            Exception lastError = null;
            for (int attempt = 1; attempt <= ServiceStartAttempts; attempt++)
            {
                int candidatePort = PortReservation.FindAvailable();
                Process candidate = StartService(root, configuration, candidatePort);
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

        private static Process StartService(string root, LaunchConfiguration configuration, int port)
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
            if (!string.IsNullOrWhiteSpace(configuration.GraphDirectory))
            {
                start.EnvironmentVariables.Remove("AP_PROJECTS_FILE");
                start.EnvironmentVariables.Remove("AP_PROJECTS_JSON");
                start.EnvironmentVariables["AP_GRAPH_DIR"] = configuration.GraphDirectory;
                start.EnvironmentVariables["AP_GRAPH_KIND"] = configuration.GraphKind ?? "markdown-files";
            }
            else if (!string.IsNullOrWhiteSpace(configuration.ProjectsFile))
            {
                start.EnvironmentVariables.Remove("AP_GRAPH_DIR");
                start.EnvironmentVariables.Remove("AP_GRAPH_KIND");
                start.EnvironmentVariables.Remove("AP_PROJECTS_JSON");
                start.EnvironmentVariables["AP_PROJECTS_FILE"] = configuration.ProjectsFile;
            }
            start.EnvironmentVariables["AP_PORT"] = port.ToString();
            Process process = Process.Start(start);
            if (process == null) throw new InvalidOperationException("知识源服务进程未能启动。");
            return process;
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
            Process process = Process.Start(start);
            if (process == null) throw new InvalidOperationException("桌面壳进程未能启动。");
            return process;
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

    internal sealed class ShellRestartPolicy
    {
        private readonly int maximumFailures;
        private int failures;
        private int remainingDelayTicks;

        public ShellRestartPolicy(int maximumAutomaticFailures)
        {
            maximumFailures = maximumAutomaticFailures;
        }

        public bool RegisterFailure()
        {
            failures++;
            if (failures >= maximumFailures)
            {
                remainingDelayTicks = 0;
                return false;
            }
            remainingDelayTicks = failures * 4;
            return true;
        }

        public bool TickReady()
        {
            if (remainingDelayTicks > 0) remainingDelayTicks--;
            return remainingDelayTicks == 0;
        }

        public void Reset()
        {
            failures = 0;
            remainingDelayTicks = 0;
        }
    }

    internal enum BackdropMode { Mica, Acrylic, Opaque }

    internal static class SystemBackdrop
    {
        private const int DwmSystemBackdropType = 38;
        private const int DwmMica = 2;
        private const int WcaAccentPolicy = 19;
        private const int AccentEnableGradient = 1;
        private const int AccentEnableAcrylicBlurBehind = 4;
        private const int GclBackgroundBrush = -10;
        private const uint LwaAlpha = 0x2;
        private static IntPtr opaqueBrush;

        [StructLayout(LayoutKind.Sequential)]
        private struct AccentPolicy { public int State; public int Flags; public int Color; public int Animation; }

        [StructLayout(LayoutKind.Sequential)]
        private struct WindowCompositionAttributeData { public int Attribute; public IntPtr Data; public int Size; }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

        [DllImport("user32.dll")]
        private static extern int SetWindowCompositionAttribute(IntPtr window, ref WindowCompositionAttributeData data);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateSolidBrush(uint color);

        [DllImport("user32.dll", EntryPoint = "SetClassLongPtr")]
        private static extern IntPtr SetClassLongPtr(IntPtr window, int index, IntPtr value);

        [DllImport("user32.dll")]
        private static extern bool SetLayeredWindowAttributes(IntPtr window, uint colorKey, byte alpha, uint flags);

        [DllImport("user32.dll")]
        private static extern bool InvalidateRect(IntPtr window, IntPtr rectangle, bool erase);

        internal static BackdropMode Resolve(Func<int> applyMica, Func<int> applyAcrylic)
        {
            try
            {
                if (applyMica() == 0) return BackdropMode.Mica;
                return applyAcrylic() != 0 ? BackdropMode.Acrylic : BackdropMode.Opaque;
            }
            catch (DllNotFoundException) { return BackdropMode.Opaque; }
            catch (EntryPointNotFoundException) { return BackdropMode.Opaque; }
        }

        public static bool Apply(IntPtr window)
        {
            BackdropMode mode = Resolve(
                delegate { return ApplyMica(window); },
                delegate { return ApplyAccent(window, AccentEnableAcrylicBlurBehind, unchecked((int)0xB8F8FAFC)); });
            if (mode != BackdropMode.Opaque) return true;
            ApplyOpaqueFallback(window);
            return false;
        }

        private static int ApplyMica(IntPtr window)
        {
            int backdrop = DwmMica;
            return DwmSetWindowAttribute(window, DwmSystemBackdropType, ref backdrop, sizeof(int));
        }

        private static int ApplyAccent(IntPtr window, int state, int color)
        {
            AccentPolicy policy = new AccentPolicy { State = state, Color = color };
            int size = Marshal.SizeOf(policy);
            IntPtr pointer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(policy, pointer, false);
                WindowCompositionAttributeData data = new WindowCompositionAttributeData { Attribute = WcaAccentPolicy, Data = pointer, Size = size };
                return SetWindowCompositionAttribute(window, ref data);
            }
            finally { Marshal.FreeHGlobal(pointer); }
        }

        private static void ApplyOpaqueFallback(IntPtr window)
        {
            try { ApplyAccent(window, AccentEnableGradient, unchecked((int)0xFFF8FAFC)); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            if (opaqueBrush == IntPtr.Zero) opaqueBrush = CreateSolidBrush(0x00FCFAF8);
            if (opaqueBrush != IntPtr.Zero) SetClassLongPtr(window, GclBackgroundBrush, opaqueBrush);
            SetLayeredWindowAttributes(window, 0, 255, LwaAlpha);
            InvalidateRect(window, IntPtr.Zero, true);
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
                ProjectsDocument sample = new ProjectsDocument { activeProjectId = "project-self-test" };
                ProjectEntry project = new ProjectEntry { id = "project-self-test", name = "Self test", defaultSourceId = "source-self-test" };
                project.sources.Add(new ProjectSourceEntry { id = "source-self-test", kind = "markdown-files", scope = new ProjectScopeEntry { kind = "directory", path = @"C:\self-test" } });
                sample.projects.Add(project);
                string json = new JavaScriptSerializer().Serialize(sample);
                ProjectsDocument restored = new JavaScriptSerializer().Deserialize<ProjectsDocument>(json);

                ShellRestartPolicy restartPolicy = new ShellRestartPolicy(3);
                int starts = 0;
                Func<string, int, Process> failingStarter = delegate
                {
                    starts++;
                    throw new InvalidOperationException("injected shell failure");
                };
                bool willRetry = true;
                for (int attempt = 0; attempt < 3; attempt++)
                {
                    try { failingStarter("test", port); }
                    catch (InvalidOperationException) { willRetry = restartPolicy.RegisterFailure(); }
                }

                BackdropMode acrylicFailure = SystemBackdrop.Resolve(delegate { return -1; }, delegate { return 0; });
                BackdropMode missingApi = SystemBackdrop.Resolve(delegate { return -1; }, delegate { throw new EntryPointNotFoundException(); });

                string temporaryRoot = Path.Combine(Path.GetTempPath(), "action-pocket-self-test-" + Guid.NewGuid().ToString("N"));
                string legacyGraph = Path.Combine(temporaryRoot, "legacy");
                string addedGraph = Path.Combine(temporaryRoot, "added");
                Directory.CreateDirectory(legacyGraph);
                Directory.CreateDirectory(addedGraph);
                ProjectsDocument imported = new ProjectsDocument();
                bool importedLegacy = GraphConfiguration.AddProjectToDocument(imported, "directory", legacyGraph, "Legacy", "markdown-files");
                bool importedAdded = GraphConfiguration.AddProjectToDocument(imported, "directory", addedGraph, "Added", "markdown-files");
                bool deduplicated = !GraphConfiguration.AddProjectToDocument(imported, "directory", legacyGraph, "Legacy", "markdown-files");
                Directory.Delete(temporaryRoot, true);

                return port > 0 && port <= 65535 && restored != null && restored.projects.Count == 1
                    && starts == 3 && !willRetry && acrylicFailure == BackdropMode.Opaque && missingApi == BackdropMode.Opaque
                    && importedLegacy && importedAdded && deduplicated && imported.projects.Count == 2 ? 0 : 1;
            }
            catch { return 1; }
        }
    }
}
