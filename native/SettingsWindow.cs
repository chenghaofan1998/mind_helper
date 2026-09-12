using System;
using System.Drawing;
using System.Windows.Forms;

namespace ActionPocketLauncher
{
    /// <summary>
    /// Independent WinForms settings window, separate from the Neutralino shell. Edits are staged in
    /// memory and only reach disk when the user presses 保存; the launcher then atomically persists
    /// projects.v1.json and restarts the service and shell. All file and folder pickers are owned by
    /// this window so they never fall behind the desktop shell.
    /// </summary>
    internal sealed class ProjectSettingsWindow : Form
    {
        private readonly ProjectsDocument document;
        private readonly ListBox projectList;
        private readonly TextBox nameBox;
        private readonly ComboBox kindBox;
        private readonly TextBox pathBox;
        private readonly Button defaultButton;
        private readonly Button deleteButton;
        private readonly Label statusLabel;
        private bool updating;

        public ProjectSettingsWindow(ProjectsDocument stagedDocument)
        {
            document = stagedDocument ?? new ProjectsDocument();
            ProjectDocumentRules.Normalize(document);

            Text = "Action Pocket 设置";
            Font = SystemFonts.MessageBoxFont;
            ClientSize = new Size(680, 480);
            MinimumSize = new Size(696, 519);
            StartPosition = FormStartPosition.CenterScreen;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowInTaskbar = true;

            Label instructions = new Label();
            instructions.SetBounds(12, 12, 656, 46);
            instructions.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            instructions.Text = "管理项目与来源。修改先在本窗口暂存，点击“保存”后才原子写入 projects.v1.json 并重启服务与小窗；“取消”不改变正在运行的配置。标准 Connector 后续通过同一来源模型接入，本窗口暂不提供其配置表单。";

            Button addFolder = new Button { Text = "添加文件夹…" };
            addFolder.SetBounds(12, 68, 132, 30);
            addFolder.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            addFolder.Click += delegate { AddFolderProject(); };

            Button addFile = new Button { Text = "添加 Markdown 文件…" };
            addFile.SetBounds(152, 68, 176, 30);
            addFile.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            addFile.Click += delegate { AddMarkdownProject(); };

            projectList = new ListBox();
            projectList.SetBounds(12, 110, 340, 300);
            projectList.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Bottom;
            projectList.IntegralHeight = false;
            projectList.SelectedIndexChanged += delegate { ShowSelectedProject(); };

            Label nameLabel = new Label { Text = "项目名称" };
            nameLabel.SetBounds(368, 110, 300, 18);
            nameLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            nameBox = new TextBox();
            nameBox.SetBounds(368, 130, 300, 24);
            nameBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            nameBox.MaxLength = 80;
            nameBox.TextChanged += delegate { CommitName(); };

            Label kindLabel = new Label { Text = "来源类型（仅文件夹项目可切换）" };
            kindLabel.SetBounds(368, 166, 300, 18);
            kindLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            kindBox = new ComboBox();
            kindBox.SetBounds(368, 186, 300, 24);
            kindBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            kindBox.DropDownStyle = ComboBoxStyle.DropDownList;
            kindBox.Items.Add("普通 Markdown 文件夹");
            kindBox.Items.Add("Logseq 文件夹");
            kindBox.SelectedIndexChanged += delegate { CommitKind(); };

            Label pathLabel = new Label { Text = "来源范围" };
            pathLabel.SetBounds(368, 222, 300, 18);
            pathLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            pathBox = new TextBox();
            pathBox.SetBounds(368, 242, 300, 60);
            pathBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            pathBox.ReadOnly = true;
            pathBox.Multiline = true;
            pathBox.ScrollBars = ScrollBars.Vertical;

            defaultButton = new Button { Text = "设为默认项目" };
            defaultButton.SetBounds(368, 312, 144, 30);
            defaultButton.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            defaultButton.Click += delegate { SetDefaultProject(); };

            deleteButton = new Button { Text = "删除项目" };
            deleteButton.SetBounds(524, 312, 144, 30);
            deleteButton.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            deleteButton.Click += delegate { DeleteProject(); };

            statusLabel = new Label();
            statusLabel.SetBounds(12, 418, 500, 20);
            statusLabel.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            statusLabel.ForeColor = SystemColors.GrayText;

            Button saveButton = new Button { Text = "保存" };
            saveButton.SetBounds(508, 440, 80, 30);
            saveButton.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            saveButton.Click += delegate { SaveAndClose(); };

            Button cancelButton = new Button { Text = "取消", DialogResult = DialogResult.Cancel };
            cancelButton.SetBounds(596, 440, 72, 30);
            cancelButton.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;

            CancelButton = cancelButton;

            Controls.Add(instructions);
            Controls.Add(addFolder);
            Controls.Add(addFile);
            Controls.Add(projectList);
            Controls.Add(nameLabel);
            Controls.Add(nameBox);
            Controls.Add(kindLabel);
            Controls.Add(kindBox);
            Controls.Add(pathLabel);
            Controls.Add(pathBox);
            Controls.Add(defaultButton);
            Controls.Add(deleteButton);
            Controls.Add(statusLabel);
            Controls.Add(saveButton);
            Controls.Add(cancelButton);

            RefreshList(document.activeProjectId);
            Shown += delegate { Activate(); BringToFront(); };
        }

        public ProjectsDocument Document { get { return document; } }

        private ProjectEntry SelectedProject()
        {
            int index = projectList.SelectedIndex;
            if (index < 0 || index >= document.projects.Count) return null;
            return document.projects[index];
        }

        private static ProjectSourceEntry FirstSource(ProjectEntry project)
        {
            if (project == null || project.sources == null || project.sources.Count == 0) return null;
            return project.sources[0];
        }

        private static bool IsDirectory(ProjectEntry project)
        {
            ProjectSourceEntry source = FirstSource(project);
            return source != null && source.scope != null && source.scope.kind == "directory";
        }

        private static string Describe(ProjectEntry project)
        {
            if (project == null) return "";
            ProjectSourceEntry source = FirstSource(project);
            string name = string.IsNullOrWhiteSpace(project.name) ? "（未命名）" : project.name;
            string scope = source == null || source.scope == null ? "来源缺失"
                : source.scope.kind == "file" ? "单 Markdown 文件"
                : source.kind == "logseq-files" ? "Logseq 文件夹" : "Markdown 文件夹";
            return name + "    [" + scope + "]";
        }

        private int IndexOfProject(string projectId)
        {
            if (string.IsNullOrWhiteSpace(projectId)) return -1;
            for (int index = 0; index < document.projects.Count; index++)
                if (document.projects[index] != null && string.Equals(document.projects[index].id, projectId, StringComparison.Ordinal)) return index;
            return -1;
        }

        private string SelectedId()
        {
            ProjectEntry project = SelectedProject();
            return project == null ? document.activeProjectId : project.id;
        }

        private void RefreshList(string selectId)
        {
            projectList.BeginUpdate();
            projectList.Items.Clear();
            foreach (ProjectEntry project in document.projects) projectList.Items.Add(Describe(project));
            projectList.EndUpdate();
            int index = IndexOfProject(selectId);
            if (index < 0 && document.projects.Count > 0) index = 0;
            if (index >= 0) projectList.SelectedIndex = index;
            else ShowSelectedProject();
        }

        private void ShowSelectedProject()
        {
            ProjectEntry project = SelectedProject();
            bool hasProject = project != null;
            ProjectSourceEntry source = FirstSource(project);
            updating = true;
            try
            {
                nameBox.Enabled = hasProject;
                kindBox.Enabled = hasProject && IsDirectory(project);
                defaultButton.Enabled = hasProject;
                deleteButton.Enabled = hasProject;
                nameBox.Text = hasProject ? project.name ?? "" : "";
                pathBox.Text = source == null || source.scope == null ? "" : source.scope.path ?? "";
                if (hasProject && IsDirectory(project)) kindBox.SelectedIndex = source.kind == "logseq-files" ? 1 : 0;
                else kindBox.SelectedIndex = -1;
            }
            finally { updating = false; }
        }

        private void CommitName()
        {
            if (updating) return;
            ProjectEntry project = SelectedProject();
            if (project == null) return;
            project.name = nameBox.Text.Trim();
            UpdateSelectedItemText(project);
        }

        // Replacing a single item keeps the ListBox selection stable while the user types, unlike a
        // full rebuild which would fire selection events on every keystroke.
        private void UpdateSelectedItemText(ProjectEntry project)
        {
            int index = projectList.SelectedIndex;
            if (index < 0 || index >= projectList.Items.Count) return;
            string text = Describe(project);
            if (string.Equals(projectList.Items[index] as string, text, StringComparison.Ordinal)) return;
            projectList.Items[index] = text;
        }

        private void CommitKind()
        {
            if (updating) return;
            ProjectEntry project = SelectedProject();
            if (project == null || !IsDirectory(project)) return;
            FirstSource(project).kind = kindBox.SelectedIndex == 1 ? "logseq-files" : "markdown-files";
            RefreshList(SelectedId());
        }

        private void AddFolderProject()
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "添加一个文件夹项目";
                dialog.ShowNewFolderButton = false;
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                AddProject("directory", dialog.SelectedPath, "markdown-files");
            }
        }

        private void AddMarkdownProject()
        {
            using (OpenFileDialog dialog = new OpenFileDialog())
            {
                dialog.Title = "添加一个 Markdown 文件项目";
                dialog.Filter = "Markdown (*.md;*.markdown)|*.md;*.markdown";
                dialog.Multiselect = false;
                dialog.CheckFileExists = true;
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                AddProject("file", dialog.FileName, "markdown-files");
            }
        }

        private void AddProject(string scopeKind, string path, string sourceKind)
        {
            try
            {
                if (!GraphConfiguration.AddProjectToDocument(document, scopeKind, path, null, sourceKind))
                {
                    ShowStatus("这个项目已经添加。");
                    return;
                }
                ProjectEntry added = document.projects[document.projects.Count - 1];
                if (!ProjectDocumentRules.ContainsProject(document, document.activeProjectId)) document.activeProjectId = added.id;
                RefreshList(added.id);
                ShowStatus("已暂存新项目；点击“保存”后写入配置并重启。");
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "添加项目失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void SetDefaultProject()
        {
            ProjectEntry project = SelectedProject();
            if (project == null) return;
            document.activeProjectId = project.id;
            ShowStatus("已把“" + project.name + "”设为默认项目；点击“保存”后生效。");
        }

        private void DeleteProject()
        {
            ProjectEntry project = SelectedProject();
            if (project == null) return;
            bool lastProject = document.projects.Count <= 1;
            string message = lastProject
                ? "这是最后一个项目，删除后将没有任何项目。确定删除“" + project.name + "”吗？"
                : "确定删除项目“" + project.name + "”吗？";
            DialogResult choice = MessageBox.Show(this, message, "删除项目", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
            if (choice != DialogResult.OK) return;
            document.projects.Remove(project);
            ProjectDocumentRules.Normalize(document);
            RefreshList(document.activeProjectId);
            ShowStatus("已暂存删除；点击“保存”后写入配置并重启。");
        }

        private void SaveAndClose()
        {
            try
            {
                ProjectDocumentRules.Normalize(document);
                ProjectDocumentRules.Validate(document);
            }
            catch (InvalidOperationException error)
            {
                MessageBox.Show(this, error.Message, "无法保存项目配置", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            DialogResult = DialogResult.OK;
            Close();
        }

        private void ShowStatus(string message)
        {
            statusLabel.Text = message;
        }
    }
}
