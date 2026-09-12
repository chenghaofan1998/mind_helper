using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ActionPocketLauncher
{
    /// <summary>Bounded automatic shell-restart policy, mirrored by the UI-free TypeScript state machine.</summary>
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

    /// <summary>Shows the one-time tray hint so a restored configuration is not silently invisible.</summary>
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

    /// <summary>Reserves an ephemeral loopback port for the local knowledge service.</summary>
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

    /// <summary>Registers the Ctrl+Alt+P global hotkey without any keyboard hook.</summary>
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
}
