using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace ActionPocketLauncher
{
    /// <summary>
    /// Starts and probes the child processes the launcher owns: the bundled Node knowledge service and
    /// the Neutralino desktop shell. Kept separate from <see cref="LauncherContext"/> so the tray and
    /// window lifecycle stays focused on user-visible behavior.
    /// </summary>
    internal static class ServiceRuntime
    {
        private const int ServiceStartAttempts = 3;

        internal sealed class RunningService
        {
            public readonly Process Process;
            public readonly int Port;

            public RunningService(Process process, int port)
            {
                Process = process;
                Port = port;
            }
        }

        public static RunningService StartReadyService(string root, LaunchConfiguration configuration)
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

        public static Process StartService(string root, LaunchConfiguration configuration, int port)
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

        public static Process StartShell(string root, int port)
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
}
