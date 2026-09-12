using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ActionPocketLauncher
{
    public sealed class LauncherSettingsDocument
    {
        public int version = 1;
        public HotkeyBinding hotkey = HotkeyBinding.Default();
    }

    public sealed class HotkeyBinding
    {
        public bool control;
        public bool alt;
        public bool shift;
        public bool windows;
        public int key;

        public static HotkeyBinding Default()
        {
            return new HotkeyBinding { control = true, alt = true, key = (int)Keys.P };
        }

        public HotkeyBinding Copy()
        {
            return new HotkeyBinding { control = control, alt = alt, shift = shift, windows = windows, key = key };
        }
    }

    /// <summary>Pure shortcut validation and display rules shared by settings UI and registration.</summary>
    internal static class HotkeyRules
    {
        public static void Validate(HotkeyBinding binding)
        {
            if (binding == null) throw new InvalidOperationException("显示/隐藏快捷键不能为空。");
            if (!binding.control && !binding.alt && !binding.shift && !binding.windows)
                throw new InvalidOperationException("快捷键必须包含 Ctrl、Alt、Shift 或 Win 中的至少一个修饰键。");
            if (!IsOrdinaryKey((Keys)binding.key))
                throw new InvalidOperationException("快捷键主键仅支持字母、数字、F1–F24 或空格。");
        }

        public static bool IsOrdinaryKey(Keys key)
        {
            return (key >= Keys.A && key <= Keys.Z)
                || (key >= Keys.D0 && key <= Keys.D9)
                || (key >= Keys.F1 && key <= Keys.F24)
                || key == Keys.Space;
        }

        public static bool Equals(HotkeyBinding left, HotkeyBinding right)
        {
            return left != null && right != null && left.control == right.control && left.alt == right.alt
                && left.shift == right.shift && left.windows == right.windows && left.key == right.key;
        }

        public static string Display(HotkeyBinding binding)
        {
            Validate(binding);
            string value = "";
            if (binding.control) value += "Ctrl+";
            if (binding.alt) value += "Alt+";
            if (binding.shift) value += "Shift+";
            if (binding.windows) value += "Win+";
            Keys key = (Keys)binding.key;
            if (key >= Keys.D0 && key <= Keys.D9) value += ((int)key - (int)Keys.D0).ToString();
            else if (key == Keys.Space) value += "Space";
            else value += key.ToString();
            return value;
        }

        public static int Modifiers(HotkeyBinding binding)
        {
            Validate(binding);
            int modifiers = 0;
            if (binding.alt) modifiers |= 0x0001;
            if (binding.control) modifiers |= 0x0002;
            if (binding.shift) modifiers |= 0x0004;
            if (binding.windows) modifiers |= 0x0008;
            return modifiers;
        }
    }

    /// <summary>
    /// Captures one configuration file before a multi-file settings commit and restores it with an
    /// atomic same-directory replacement. A missing original is restored by removing the new file.
    /// </summary>
    internal sealed class ConfigurationFileSnapshot
    {
        private readonly string path;
        private readonly bool existed;
        private readonly byte[] contents;

        private ConfigurationFileSnapshot(string filePath, bool fileExisted, byte[] fileContents)
        {
            path = filePath;
            existed = fileExisted;
            contents = fileContents;
        }

        public static ConfigurationFileSnapshot Capture(string path)
        {
            bool exists = File.Exists(path);
            return new ConfigurationFileSnapshot(path, exists, exists ? File.ReadAllBytes(path) : null);
        }

        public void Restore()
        {
            if (!existed)
            {
                if (File.Exists(path)) File.Delete(path);
                return;
            }
            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
            string temporary = path + ".rollback-" + Guid.NewGuid().ToString("N");
            try
            {
                File.WriteAllBytes(temporary, contents);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }

    /// <summary>
    /// Coordinates the two independently atomic configuration writes as one recoverable user action.
    /// Dependencies are actions so the native self-test can exercise second-write and rollback faults.
    /// </summary>
    internal static class SettingsPersistenceTransaction
    {
        public static void Commit(Action saveProjects, Action saveLauncherSettings, Action restoreProjects, Action restoreLauncherSettings)
        {
            try
            {
                saveProjects();
                saveLauncherSettings();
            }
            catch (Exception saveError)
            {
                Exception launcherRestoreError = null;
                Exception projectRestoreError = null;
                try { restoreLauncherSettings(); }
                catch (Exception error) { launcherRestoreError = error; }
                try { restoreProjects(); }
                catch (Exception error) { projectRestoreError = error; }

                if (launcherRestoreError != null || projectRestoreError != null)
                {
                    List<Exception> failures = new List<Exception> { saveError };
                    if (launcherRestoreError != null) failures.Add(launcherRestoreError);
                    if (projectRestoreError != null) failures.Add(projectRestoreError);
                    throw new AggregateException(
                        "设置保存失败，且旧配置未能完整恢复。请不要重启应用，并检查配置目录权限。",
                        failures);
                }
                throw new InvalidOperationException("设置保存失败，已恢复保存前的项目与快捷键配置。", saveError);
            }
        }
    }

    /// <summary>
    /// Stores launcher-only preferences separately from projects.v1.json so the Node service never
    /// needs to understand desktop shortcut settings. Writes replace the file atomically.
    /// </summary>
    internal static class LauncherSettingsStore
    {
        private static readonly string ConfigDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ActionPocket");
        internal static readonly string SettingsFile = Path.Combine(ConfigDirectory, "launcher-settings.v1.json");

        public static LauncherSettingsDocument Load()
        {
            if (!File.Exists(SettingsFile)) return new LauncherSettingsDocument();
            FileInfo info = new FileInfo(SettingsFile);
            if (info.Length > 64 * 1024) throw new InvalidOperationException("启动器设置文件过大。");
            LauncherSettingsDocument document = new JavaScriptSerializer().Deserialize<LauncherSettingsDocument>(File.ReadAllText(SettingsFile, Encoding.UTF8));
            if (document == null || document.version != 1) throw new InvalidOperationException("启动器设置文件无效。");
            if (document.hotkey == null) document.hotkey = HotkeyBinding.Default();
            HotkeyRules.Validate(document.hotkey);
            return document;
        }

        public static void Save(LauncherSettingsDocument document)
        {
            if (document == null) throw new InvalidOperationException("启动器设置不能为空。");
            HotkeyRules.Validate(document.hotkey);
            Directory.CreateDirectory(ConfigDirectory);
            document.version = 1;
            string temporary = SettingsFile + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(document), new UTF8Encoding(false));
            if (File.Exists(SettingsFile)) File.Replace(temporary, SettingsFile, null);
            else File.Move(temporary, SettingsFile);
        }
    }
}
