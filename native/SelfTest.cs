using System;
using System.Diagnostics;
using System.IO;
using System.Web.Script.Serialization;

namespace ActionPocketLauncher
{
    /// <summary>
    /// UI-free self-test used by the build script and by "<c>--self-test</c>". It covers the pure
    /// pieces (project serialization and dedup, shortcut rules, project document rules and restart
    /// policy) so a broken launcher fails the build instead of only failing on a real desktop.
    /// </summary>
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

                ProjectsDocument normalized = new ProjectsDocument();
                normalized.projects.Add(new ProjectEntry { id = "project-a", name = "A", defaultSourceId = "source-a" });
                normalized.projects.Add(new ProjectEntry { id = "project-b", name = "B", defaultSourceId = "source-b" });
                normalized.activeProjectId = "project-missing";
                ProjectDocumentRules.Normalize(normalized);
                bool normalizedActive = normalized.activeProjectId == "project-a";
                ProjectsDocument emptied = new ProjectsDocument { activeProjectId = "project-gone" };
                ProjectDocumentRules.Normalize(emptied);
                bool normalizedEmpty = emptied.activeProjectId == null;

                bool rejectedEmptyName = false;
                try
                {
                    ProjectEntry invalidProject = new ProjectEntry { id = "project-x", name = "  ", defaultSourceId = "source-x" };
                    invalidProject.sources.Add(new ProjectSourceEntry { id = "source-x", kind = "markdown-files", scope = new ProjectScopeEntry { kind = "directory", path = @"C:\x" } });
                    ProjectsDocument invalid = new ProjectsDocument();
                    invalid.projects.Add(invalidProject);
                    ProjectDocumentRules.Validate(invalid);
                }
                catch (InvalidOperationException) { rejectedEmptyName = true; }

                HotkeyBinding defaultHotkey = HotkeyBinding.Default();
                bool shortcutDisplay = HotkeyRules.Display(defaultHotkey) == "Ctrl+Alt+P" && HotkeyRules.Modifiers(defaultHotkey) == 0x0003;
                bool rejectedBareKey = false;
                try { HotkeyRules.Validate(new HotkeyBinding { key = (int)System.Windows.Forms.Keys.P }); }
                catch (InvalidOperationException) { rejectedBareKey = true; }
                LauncherSettingsDocument shortcutDocument = new LauncherSettingsDocument { hotkey = new HotkeyBinding { control = true, shift = true, key = (int)System.Windows.Forms.Keys.Space } };
                string shortcutJson = new JavaScriptSerializer().Serialize(shortcutDocument);
                LauncherSettingsDocument restoredShortcut = new JavaScriptSerializer().Deserialize<LauncherSettingsDocument>(shortcutJson);

                string projectState = "old-projects";
                string launcherState = "old-launcher";
                bool secondSaveRolledBack = false;
                try
                {
                    SettingsPersistenceTransaction.Commit(
                        delegate { projectState = "new-projects"; },
                        delegate { launcherState = "partial-launcher"; throw new IOException("injected second save failure"); },
                        delegate { projectState = "old-projects"; },
                        delegate { launcherState = "old-launcher"; });
                }
                catch (InvalidOperationException error)
                {
                    secondSaveRolledBack = error.InnerException is IOException
                        && projectState == "old-projects" && launcherState == "old-launcher";
                }
                bool hotkeyRollbackFailureVisible = HotkeyRebindPolicy.AfterCandidateFailure(
                    defaultHotkey,
                    delegate { return false; }) == HotkeyRebindResult.RollbackFailed;

                return port > 0 && port <= 65535 && restored != null && restored.projects.Count == 1
                    && starts == 3 && !willRetry
                    && importedLegacy && importedAdded && deduplicated && imported.projects.Count == 2
                    && normalizedActive && normalizedEmpty && rejectedEmptyName
                    && shortcutDisplay && rejectedBareKey && restoredShortcut != null
                    && HotkeyRules.Display(restoredShortcut.hotkey) == "Ctrl+Shift+Space"
                    && secondSaveRolledBack && hotkeyRollbackFailureVisible ? 0 : 1;
            }
            catch { return 1; }
        }
    }
}
