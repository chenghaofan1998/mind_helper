using System;
using System.Threading;
using System.Windows.Forms;

namespace ActionPocketLauncher
{
    /// <summary>
    /// Entry point for the Windows desktop launcher. It enforces a single running instance and hands
    /// control to <see cref="LauncherContext"/>. See the sibling files for project configuration and
    /// the settings window (GraphConfiguration/SettingsWindow), the shell lifecycle (LauncherContext),
    /// the OS backdrop (DesktopBackdrop), shell support types (ShellSupport) and the self-test.
    /// </summary>
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

    /// <summary>Resolved startup configuration: either an explicit projects file or a legacy graph directory.</summary>
    internal sealed class LaunchConfiguration
    {
        public string GraphDirectory;
        public string GraphKind;
        public string ProjectsFile;
    }
}
