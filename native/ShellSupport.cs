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

    internal enum HotkeyRebindResult { Applied, CandidateUnavailable, RollbackFailed }

    /// <summary>Pure failure policy used after a candidate registration fails.</summary>
    internal static class HotkeyRebindPolicy
    {
        public static HotkeyRebindResult AfterCandidateFailure(HotkeyBinding previous, Func<HotkeyBinding, bool> restorePrevious)
        {
            if (previous == null) return HotkeyRebindResult.CandidateUnavailable;
            return restorePrevious(previous) ? HotkeyRebindResult.CandidateUnavailable : HotkeyRebindResult.RollbackFailed;
        }
    }

    /// <summary>Registers one validated global hotkey without installing a keyboard hook.</summary>
    internal sealed class HotkeyWindow : NativeWindow, IDisposable
    {
        private const int WmHotkey = 0x0312;
        private const int HotkeyId = 0x4150;
        private readonly Action toggleShell;
        private bool registered;
        private HotkeyBinding binding;

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr window, int id, int modifiers, uint key);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr window, int id);

        public HotkeyWindow(Action toggleShellAction)
        {
            toggleShell = toggleShellAction;
            CreateHandle(new CreateParams());
        }

        public HotkeyBinding Binding { get { return binding == null ? null : binding.Copy(); } }

        public bool Register(HotkeyBinding candidate)
        {
            HotkeyRules.Validate(candidate);
            binding = candidate.Copy();
            registered = RegisterHotKey(Handle, HotkeyId, HotkeyRules.Modifiers(candidate), (uint)candidate.key);
            return registered;
        }

        public HotkeyRebindResult Rebind(HotkeyBinding candidate)
        {
            HotkeyRules.Validate(candidate);
            if (registered && HotkeyRules.Equals(binding, candidate)) return HotkeyRebindResult.Applied;
            HotkeyBinding previous = binding == null ? null : binding.Copy();
            if (registered)
            {
                UnregisterHotKey(Handle, HotkeyId);
                registered = false;
            }
            if (Register(candidate)) return HotkeyRebindResult.Applied;
            binding = previous;
            return HotkeyRebindPolicy.AfterCandidateFailure(previous, Register);
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
