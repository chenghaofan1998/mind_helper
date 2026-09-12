using System;
using System.Runtime.InteropServices;

namespace ActionPocketLauncher
{
    internal enum BackdropMode { Mica, Acrylic, Opaque }

    /// <summary>
    /// Applies the Windows 11 Mica or Windows 10 Acrylic backdrop to the borderless Neutralino shell.
    /// When neither is available the shell falls back to an opaque near-white surface so text stays
    /// readable instead of showing a broken transparent window.
    /// </summary>
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
}
