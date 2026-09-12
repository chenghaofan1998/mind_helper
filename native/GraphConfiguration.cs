using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ActionPocketLauncher
{
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

    /// <summary>
    /// Loads, validates and atomically persists the provider-neutral project document. Projects are
    /// the user workspace; each project owns one or more content sources (current build: one local
    /// file source per project). Remote standard connectors plug into the same source shape later.
    /// </summary>
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
            if (Contains(args, "--choose-graph")) AddDirectoryProjectAtStartup();
            return new LaunchConfiguration { ProjectsFile = File.Exists(ProjectsFile) ? ProjectsFile : null };
        }

        public static void EnsureCurrentConfigurationImported(LaunchConfiguration configuration)
        {
            if (configuration == null) return;
            bool localProjectsAlreadyActive = !string.IsNullOrWhiteSpace(configuration.ProjectsFile)
                && string.Equals(Path.GetFullPath(configuration.ProjectsFile), Path.GetFullPath(ProjectsFile), StringComparison.OrdinalIgnoreCase);
            if (localProjectsAlreadyActive) return;

            ProjectsDocument destination = LoadProjects();
            bool changed = false;
            if (!string.IsNullOrWhiteSpace(configuration.GraphDirectory))
            {
                changed = AddProjectToDocument(destination, "directory", ValidateDirectory(configuration.GraphDirectory), null, configuration.GraphKind);
            }
            else if (!string.IsNullOrWhiteSpace(configuration.ProjectsFile))
            {
                ProjectsDocument source = LoadProjects(ValidateProjectsFile(configuration.ProjectsFile));
                foreach (ProjectEntry project in source.projects)
                {
                    if (project == null || project.sources == null || project.sources.Count != 1 || project.sources[0] == null || project.sources[0].scope == null)
                        throw new InvalidOperationException("外部项目配置无效。");
                    ProjectSourceEntry item = project.sources[0];
                    if (AddProjectToDocument(destination, item.scope.kind, item.scope.path, project.name, item.kind)) changed = true;
                }
            }
            // Persist only when something was actually imported; otherwise opening settings and
            // cancelling would create an empty projects.v1.json and change the on-disk configuration.
            if (changed) SaveProjects(destination);
        }

        // Startup-only convenience for the "--choose-graph" flag; there is no settings window yet at
        // this point, so the picker has no owner. The settings window owns its own dialogs instead.
        public static bool AddDirectoryProjectAtStartup()
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

        internal static ProjectsDocument LoadProjects(string path = null)
        {
            string selectedPath = string.IsNullOrWhiteSpace(path) ? ProjectsFile : path;
            if (!File.Exists(selectedPath)) return new ProjectsDocument();
            FileInfo info = new FileInfo(selectedPath);
            if (info.Length > 256 * 1024) throw new InvalidOperationException("项目配置文件过大。");
            ProjectsDocument document = new JavaScriptSerializer().Deserialize<ProjectsDocument>(File.ReadAllText(selectedPath, Encoding.UTF8));
            if (document == null || document.version != 1 || document.projects == null) throw new InvalidOperationException("项目配置文件无效。");
            return document;
        }

        internal static void SaveProjects(ProjectsDocument document)
        {
            Directory.CreateDirectory(ConfigDirectory);
            document.version = 1;
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

    /// <summary>
    /// Pure, UI-free rules shared by the settings window and the self-test: normalize only repairs
    /// derived bookkeeping (the active project pointer); validation only rejects what the service
    /// would reject later, so a saved file is always loadable.
    /// </summary>
    internal static class ProjectDocumentRules
    {
        public static void Normalize(ProjectsDocument document)
        {
            if (document.projects == null) document.projects = new List<ProjectEntry>();
            document.projects.RemoveAll(delegate(ProjectEntry project) { return project == null; });
            if (document.projects.Count == 0)
            {
                document.activeProjectId = null;
                return;
            }
            if (!ContainsProject(document, document.activeProjectId)) document.activeProjectId = document.projects[0].id;
        }

        public static bool ContainsProject(ProjectsDocument document, string projectId)
        {
            if (string.IsNullOrWhiteSpace(projectId)) return false;
            foreach (ProjectEntry project in document.projects)
                if (project != null && string.Equals(project.id, projectId, StringComparison.Ordinal)) return true;
            return false;
        }

        public static void Validate(ProjectsDocument document)
        {
            foreach (ProjectEntry project in document.projects)
            {
                if (project == null) throw new InvalidOperationException("项目配置包含无效条目。");
                string name = project.name == null ? "" : project.name.Trim();
                if (name.Length == 0) throw new InvalidOperationException("项目名称不能为空。");
                if (name.Length > 80) throw new InvalidOperationException("项目名称不能超过 80 个字符。");
                if (project.sources == null || project.sources.Count == 0) throw new InvalidOperationException("项目缺少来源：" + name);
                if (string.IsNullOrWhiteSpace(project.defaultSourceId)) throw new InvalidOperationException("项目缺少默认来源：" + name);
            }
        }
    }
}
