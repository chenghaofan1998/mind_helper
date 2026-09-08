using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace CommandPocketNative
{
    internal static class Program
    {
        public const string VersionLabel = "0.4";

        [STAThread]
        private static void Main(string[] args)
        {
            if (args != null && args.Length > 0 && args[0] == "--self-test")
            {
                Environment.Exit(SelfTest.Run());
                return;
            }
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new PocketAppContext());
        }
    }

    internal sealed class PocketAppContext : ApplicationContext
    {
        private readonly CommandStore store;
        private readonly NotifyIcon tray;
        private PocketForm pocket;
        private ManagerForm manager;

        public PocketAppContext()
        {
            store = new CommandStore();
            store.EnsureSeedData();

            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Information;
            tray.Text = "Command Pocket " + Program.VersionLabel;
            tray.Visible = true;
            tray.ContextMenuStrip = BuildTrayMenu();
            tray.DoubleClick += delegate { ShowPocket(); };

            ShowPocket();
        }

        private ContextMenuStrip BuildTrayMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开速查小窗", null, delegate { ShowPocket(); });
            menu.Items.Add("添加资料", null, delegate { ShowManager("import"); });
            menu.Items.Add("已整理内容", null, delegate { ShowManager("library"); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("隐藏小窗", null, delegate { if (pocket != null) pocket.Hide(); });
            menu.Items.Add("退出", null, delegate { ExitApp(); });
            return menu;
        }

        private void ShowPocket()
        {
            if (pocket == null || pocket.IsDisposed)
            {
                pocket = new PocketForm(store);
                pocket.OpenManagerRequested += delegate { ShowManager("library"); };
                pocket.ImportRequested += delegate { ShowManager("import"); };
            }
            pocket.Reload();
            pocket.Show();
            pocket.Activate();
            pocket.FocusSearch();
        }

        private void ShowManager(string tab)
        {
            if (manager == null || manager.IsDisposed)
            {
                manager = new ManagerForm(store);
                manager.LibraryChanged += delegate
                {
                    if (pocket != null && !pocket.IsDisposed)
                        pocket.Reload();
                };
            }
            manager.Show();
            manager.Activate();
            manager.SelectMode(tab);
        }

        private void ExitApp()
        {
            tray.Visible = false;
            tray.Dispose();
            if (pocket != null && !pocket.IsDisposed)
                pocket.Close();
            if (manager != null && !manager.IsDisposed)
                manager.Close();
            ExitThread();
        }
    }

    internal sealed class PocketForm : Form
    {
        private const int WmNcHitTest = 0x0084;
        private const int HtClient = 1;
        private const int HtCaption = 2;
        private const int HtLeft = 10;
        private const int HtRight = 11;
        private const int HtTop = 12;
        private const int HtTopLeft = 13;
        private const int HtTopRight = 14;
        private const int HtBottom = 15;
        private const int HtBottomLeft = 16;
        private const int HtBottomRight = 17;
        private const int WmHotkey = 0x0312;
        private const int HotkeyId = 0xA1B1;
        private const int ModAlt = 0x0001;
        private const int ModControl = 0x0002;
        private const int ResizeBorder = 8;
        private const int DragStrip = 26;
        private const int WmNcLeftButtonDown = 0x00A1;
        private const int CsDropShadow = 0x00020000;
        private const int CornerRadius = 18;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, int modifiers, uint vk);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private readonly CommandStore store;
        private readonly TextBox search;
        private readonly ComboBox sceneFilter;
        private readonly ListView results;
        private readonly TextBox detail;
        private readonly Label resultStatus;
        private readonly Button copyButton;
        private readonly Button managerButton;
        private readonly Button importButton;
        private List<CommandCard> cards = new List<CommandCard>();
        private List<CommandCard> currentMatches = new List<CommandCard>();
        private int currentIndex = -1;

        public event EventHandler OpenManagerRequested;
        public event EventHandler ImportRequested;

        public PocketForm(CommandStore store)
        {
            this.store = store;
            Text = "Command Pocket";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            Size = new Size(520, 360);
            MinimumSize = new Size(420, 280);
            BackColor = Ui.CommandBack;
            Font = Ui.BodyFont;
            Padding = new Padding(1);
            DoubleBuffered = true;
            ResizeRedraw = true;

            Panel top = new Panel();
            top.Dock = DockStyle.Top;
            top.Height = 138;
            top.Padding = new Padding(14, 10, 14, 10);
            top.BackColor = Ui.CommandBack;

            Label title = new Label();
            title.Text = "资料速查";
            title.Dock = DockStyle.Top;
            title.Height = 24;
            title.ForeColor = Ui.Ink;
            title.Font = Ui.TitleFont;

            Label subtitle = new Label();
            subtitle.Text = "搜结论、步骤、命令、攻略；Enter 复制";
            subtitle.Dock = DockStyle.Top;
            subtitle.Height = 22;
            subtitle.ForeColor = Ui.Muted;
            subtitle.Font = Ui.SmallFont;

            search = new TextBox();
            search.Dock = DockStyle.Bottom;
            search.Height = 34;
            search.BorderStyle = BorderStyle.None;
            search.BackColor = Ui.CommandInput;
            search.ForeColor = Ui.CommandInk;
            search.Font = Ui.SearchFont;
            search.TextChanged += delegate { SearchNow(); };
            search.KeyDown += SearchKeyDown;

            sceneFilter = new ComboBox();
            sceneFilter.Dock = DockStyle.Right;
            sceneFilter.Width = 132;
            sceneFilter.DropDownStyle = ComboBoxStyle.DropDownList;
            sceneFilter.FlatStyle = FlatStyle.Flat;
            sceneFilter.BackColor = Ui.CommandInput;
            sceneFilter.ForeColor = Ui.CommandInk;
            sceneFilter.Font = Ui.SmallFont;
            ReloadSceneChoices("全部");
            sceneFilter.SelectedIndexChanged += delegate { SearchNow(); };

            FlowLayoutPanel actions = new FlowLayoutPanel();
            actions.Dock = DockStyle.Bottom;
            actions.Height = 42;
            actions.Padding = new Padding(10, 4, 10, 4);
            actions.BackColor = Ui.CommandBack;
            actions.FlowDirection = FlowDirection.RightToLeft;
            actions.WrapContents = false;

            managerButton = new Button();
            managerButton.Text = "内容";
            Ui.StyleSecondaryButton(managerButton, 64);
            managerButton.Click += delegate { if (OpenManagerRequested != null) OpenManagerRequested(this, EventArgs.Empty); };

            importButton = new Button();
            importButton.Text = "添加";
            Ui.StyleSecondaryButton(importButton, 64);
            importButton.Click += delegate { if (ImportRequested != null) ImportRequested(this, EventArgs.Empty); };

            copyButton = new Button();
            copyButton.Text = "复制";
            Ui.StylePrimaryButton(copyButton, 64);
            copyButton.Click += delegate { CopySelected(); };

            actions.Controls.Add(managerButton);
            actions.Controls.Add(importButton);
            actions.Controls.Add(copyButton);

            top.Controls.Add(search);
            top.Controls.Add(subtitle);
            top.Controls.Add(title);

            results = new ListView();
            results.Dock = DockStyle.Fill;
            results.View = View.Details;
            results.FullRowSelect = true;
            results.HideSelection = false;
            results.BorderStyle = BorderStyle.None;
            results.HeaderStyle = ColumnHeaderStyle.None;
            results.OwnerDraw = true;
            results.SmallImageList = new ImageList { ImageSize = new Size(1, 24) };
            results.BackColor = Ui.CommandBack;
            results.ForeColor = Ui.CommandInk;
            results.Font = Ui.BodyFont;
            results.Columns.Add("结果", 340);
            results.Columns.Add("类型", 70);
            results.DrawColumnHeader += delegate(object sender, DrawListViewColumnHeaderEventArgs e) { };
            results.DrawSubItem += DrawResultSubItem;
            results.DoubleClick += delegate { CopySelected(); };
            results.SelectedIndexChanged += delegate { UpdateDetail(); };
            results.Visible = false;

            detail = new TextBox();
            detail.Dock = DockStyle.Fill;
            detail.Multiline = true;
            detail.ReadOnly = true;
            detail.ScrollBars = ScrollBars.Vertical;
            detail.BorderStyle = BorderStyle.None;
            detail.BackColor = Ui.CommandBack;
            detail.ForeColor = Ui.CommandInk;
            detail.Font = Ui.AnswerFont;

            Panel answerPanel = new Panel();
            answerPanel.Dock = DockStyle.Fill;
            answerPanel.Padding = new Padding(18, 10, 18, 10);
            answerPanel.BackColor = Ui.CommandBack;

            Label answerMark = new Label();
            answerMark.Dock = DockStyle.Left;
            answerMark.Width = 0;
            answerMark.Text = "";
            answerMark.TextAlign = ContentAlignment.TopCenter;
            answerMark.BackColor = Ui.CommandBack;
            answerMark.ForeColor = Ui.CommandAccent;
            answerMark.Font = Ui.QuestionFont;

            answerPanel.Controls.Add(detail);
            answerPanel.Controls.Add(answerMark);

            resultStatus = new Label();
            resultStatus.Dock = DockStyle.Bottom;
            resultStatus.Height = 24;
            resultStatus.Padding = new Padding(18, 2, 18, 4);
            resultStatus.TextAlign = ContentAlignment.MiddleLeft;
            resultStatus.BackColor = Ui.CommandBack;
            resultStatus.ForeColor = Ui.CommandMuted;
            resultStatus.Font = Ui.SmallFont;

            Controls.Add(results);
            Controls.Add(resultStatus);
            Controls.Add(answerPanel);
            Controls.Add(actions);
            Controls.Add(top);

            top.Visible = false;
            actions.Visible = false;
            top.Height = 0;
            actions.Height = 0;

            Panel topShell = new Panel();
            topShell.Dock = DockStyle.Top;
            topShell.Height = 82;
            topShell.BackColor = Ui.CommandBack;

            Panel compactSearch = new Panel();
            compactSearch.Dock = DockStyle.Fill;
            compactSearch.Padding = new Padding(18, 12, 18, 12);
            compactSearch.BackColor = Ui.CommandBack;

            Label askMark = new Label();
            askMark.Dock = DockStyle.Left;
            askMark.Width = 34;
            askMark.Text = "⌘";
            askMark.TextAlign = ContentAlignment.MiddleCenter;
            askMark.BackColor = Ui.CommandBack;
            askMark.ForeColor = Ui.CommandAccent;
            askMark.Font = Ui.QuestionFont;

            search.Dock = DockStyle.Fill;
            compactSearch.Controls.Add(sceneFilter);
            compactSearch.Controls.Add(search);
            compactSearch.Controls.Add(askMark);
            Panel dragHandle = new Panel();
            dragHandle.Dock = DockStyle.Top;
            dragHandle.Height = 24;
            dragHandle.Padding = new Padding(12, 0, 12, 0);
            dragHandle.BackColor = Ui.CommandChrome;
            dragHandle.Cursor = Cursors.SizeAll;
            dragHandle.MouseDown += BeginWindowDrag;

            Label menuGlyph = new Label();
            menuGlyph.Dock = DockStyle.Right;
            menuGlyph.Width = 44;
            menuGlyph.Text = "...";
            menuGlyph.TextAlign = ContentAlignment.MiddleCenter;
            menuGlyph.BackColor = Ui.CommandChrome;
            menuGlyph.ForeColor = Ui.CommandMuted;
            menuGlyph.Font = Ui.TitleFont;
            menuGlyph.Cursor = Cursors.Hand;

            Label topTitle = new Label();
            topTitle.Dock = DockStyle.Left;
            topTitle.Width = 160;
            topTitle.Text = "COMMAND POCKET  " + Program.VersionLabel;
            topTitle.TextAlign = ContentAlignment.MiddleLeft;
            topTitle.BackColor = Ui.CommandChrome;
            topTitle.ForeColor = Ui.CommandMuted;
            topTitle.Font = Ui.SmallFont;

            dragHandle.Controls.Add(menuGlyph);
            dragHandle.Controls.Add(topTitle);
            topShell.Controls.Add(compactSearch);
            topShell.Controls.Add(dragHandle);
            Controls.Add(topShell);

            ContextMenuStrip pocketMenu = BuildPocketMenu();
            ContextMenuStrip = pocketMenu;
            menuGlyph.Click += delegate { pocketMenu.Show(menuGlyph, new Point(0, menuGlyph.Height)); };
            dragHandle.ContextMenuStrip = pocketMenu;
            menuGlyph.ContextMenuStrip = pocketMenu;
            topTitle.ContextMenuStrip = pocketMenu;
            topShell.ContextMenuStrip = pocketMenu;
            compactSearch.ContextMenuStrip = pocketMenu;
            search.ContextMenuStrip = pocketMenu;
            results.ContextMenuStrip = pocketMenu;
            detail.ContextMenuStrip = pocketMenu;
            resultStatus.ContextMenuStrip = pocketMenu;

            Resize += delegate { ResizeResultColumns(); };
            ResizeResultColumns();
            ApplyRoundedRegion();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= CsDropShadow;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            RegisterHotKey(Handle, HotkeyId, ModAlt | ModControl, 0x50); // Ctrl+Alt+P 全局唤出/隐藏
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            UnregisterHotKey(Handle, HotkeyId);
            base.OnFormClosed(e);
        }

        private void ToggleGlobalHotkey()
        {
            if (Visible)
            {
                Hide();
            }
            else
            {
                Show();
                Activate();
                FocusSearch();
            }
        }

        private void BeginWindowDrag(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left)
                return;
            ReleaseCapture();
            SendMessage(Handle, WmNcLeftButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
        }

        protected override void OnSizeChanged(EventArgs e)
        {
            base.OnSizeChanged(e);
            ApplyRoundedRegion();
        }

        private void ApplyRoundedRegion()
        {
            if (Width <= 0 || Height <= 0)
                return;
            using (GraphicsPath path = RoundedRect(new Rectangle(0, 0, Width, Height), CornerRadius))
                Region = new Region(path);
        }

        private void PaintDragHandle(object sender, PaintEventArgs e)
        {
            Panel panel = sender as Panel;
            if (panel == null)
                return;
            using (Brush brush = new SolidBrush(Ui.CommandMuted))
            {
                int center = panel.Width / 2;
                for (int i = -1; i <= 1; i++)
                    e.Graphics.FillEllipse(brush, center + i * 7 - 2, 7, 4, 4);
            }
        }

        private void DrawResultSubItem(object sender, DrawListViewSubItemEventArgs e)
        {
            bool selected = e.Item.Selected;
            Rectangle row = e.Item.Bounds;
            row.X = 6;
            row.Width = results.ClientSize.Width - 12;
            row.Height -= 1;

            if (e.ColumnIndex == 0)
            {
                using (Brush brush = new SolidBrush(selected ? Ui.CommandSelected : Ui.CommandBack))
                    e.Graphics.FillRectangle(brush, row);
                using (Pen pen = new Pen(selected ? Ui.CommandAccent : Ui.CommandDivider))
                    e.Graphics.DrawLine(pen, row.Left + 6, row.Bottom, row.Right - 6, row.Bottom);
            }

            Rectangle textBounds = e.Bounds;
            textBounds.Y += 3;
            textBounds.Height -= 5;
            if (e.ColumnIndex == 0)
            {
                textBounds.X += 10;
                textBounds.Width -= 14;
                TextRenderer.DrawText(e.Graphics, e.SubItem.Text, Ui.BodyFont, textBounds, selected ? Ui.CommandInk : e.Item.ForeColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            }
            else
            {
                textBounds.X += 2;
                TextRenderer.DrawText(e.Graphics, e.SubItem.Text, Ui.SmallFont, textBounds, Ui.CommandMuted, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmNcHitTest)
            {
                Point screenPoint = new Point((short)((long)m.LParam & 0xffff), (short)(((long)m.LParam >> 16) & 0xffff));
                Point point = PointToClient(screenPoint);
                if (!ClientRectangle.Contains(point))
                {
                    base.WndProc(ref m);
                    return;
                }

                bool left = point.X <= ResizeBorder;
                bool right = point.X >= Width - ResizeBorder;
                bool top = point.Y <= ResizeBorder;
                bool bottom = point.Y >= Height - ResizeBorder;

                if (left && top) { m.Result = (IntPtr)HtTopLeft; return; }
                if (right && top) { m.Result = (IntPtr)HtTopRight; return; }
                if (left && bottom) { m.Result = (IntPtr)HtBottomLeft; return; }
                if (right && bottom) { m.Result = (IntPtr)HtBottomRight; return; }
                if (left) { m.Result = (IntPtr)HtLeft; return; }
                if (right) { m.Result = (IntPtr)HtRight; return; }
                if (top && (point.X < 44 || point.X > Width - 44)) { m.Result = (IntPtr)HtTop; return; }
                if (bottom) { m.Result = (IntPtr)HtBottom; return; }
                if (point.Y <= DragStrip)
                {
                    m.Result = (IntPtr)HtCaption;
                    return;
                }

                Control child = GetChildAtPoint(point, GetChildAtPointSkip.Invisible);
                if (child == search || child == results)
                {
                    m.Result = (IntPtr)HtClient;
                    return;
                }

                m.Result = (IntPtr)HtCaption;
                return;
            }
            else if (m.Msg == WmHotkey && (int)m.WParam == HotkeyId)
            {
                ToggleGlobalHotkey();
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = RoundedRect(new Rectangle(0, 0, Width - 1, Height - 1), CornerRadius))
            using (Pen border = new Pen(Ui.CommandBorder))
                e.Graphics.DrawPath(border, path);
            using (Pen accent = new Pen(Color.FromArgb(70, Ui.CommandAccent), 1))
                e.Graphics.DrawLine(accent, 18, 24, Width - 18, 24);
        }

        private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        private void ResizeResultColumns()
        {
            if (results.Columns.Count < 2)
                return;
            int width = Math.Max(160, results.ClientSize.Width - 72);
            results.Columns[0].Width = width;
            results.Columns[1].Width = 62;
        }

        public void Reload()
        {
            string selectedScene = CurrentScene();
            ReloadSceneChoices(selectedScene);
            RefreshPocketSceneMenu();
            cards = store.LoadCards();
            SearchNow();
        }

        private void ReloadSceneChoices(string selectedScene)
        {
            sceneFilter.Items.Clear();
            sceneFilter.Items.Add("全部");
            List<string> products = store.LoadProducts();
            for (int i = 0; i < products.Count; i++)
                sceneFilter.Items.Add(products[i]);
            int selectedIndex = sceneFilter.Items.IndexOf(selectedScene);
            sceneFilter.SelectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
        }

        private void RefreshPocketSceneMenu()
        {
            if (ContextMenuStrip == null)
                return;
            for (int i = 0; i < ContextMenuStrip.Items.Count; i++)
            {
                ToolStripMenuItem item = ContextMenuStrip.Items[i] as ToolStripMenuItem;
                if (item == null || item.Text != "产品")
                    continue;
                item.DropDownItems.Clear();
                AddSceneItem(item, "全部");
                List<string> products = store.LoadProducts();
                for (int j = 0; j < products.Count; j++)
                    AddSceneItem(item, products[j]);
                return;
            }
        }

        public void FocusSearch()
        {
            search.Focus();
            search.SelectAll();
        }

        private ContextMenuStrip BuildPocketMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("添加资料", null, delegate { if (ImportRequested != null) ImportRequested(this, EventArgs.Empty); });
            menu.Items.Add("已整理内容", null, delegate { if (OpenManagerRequested != null) OpenManagerRequested(this, EventArgs.Empty); });
            menu.Items.Add("复制当前结果", null, delegate { CopySelected(); });
            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem sceneMenu = new ToolStripMenuItem("产品");
            AddSceneItem(sceneMenu, "全部");
            List<string> products = store.LoadProducts();
            for (int i = 0; i < products.Count; i++)
                AddSceneItem(sceneMenu, products[i]);
            menu.Items.Add(sceneMenu);

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("隐藏", null, delegate { Hide(); });
            return menu;
        }

        private void AddSceneItem(ToolStripMenuItem parent, string scene)
        {
            ToolStripMenuItem item = new ToolStripMenuItem(scene);
            item.Click += delegate
            {
                sceneFilter.SelectedItem = scene;
                SearchNow();
            };
            parent.DropDownItems.Add(item);
        }

        private void SearchKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                Hide();
                e.Handled = true;
                return;
            }
            if (e.KeyCode == Keys.Oem3) // ` 键：循环切换产品
            {
                if (sceneFilter.Items.Count > 1)
                {
                    int next = (sceneFilter.SelectedIndex + 1) % sceneFilter.Items.Count;
                    sceneFilter.SelectedIndex = next;
                    SearchNow();
                }
                e.Handled = true;
                return;
            }
            if (e.KeyCode == Keys.Enter)
            {
                CopySelected();
                e.Handled = true;
                return;
            }
            if (e.KeyCode == Keys.Down)
            {
                MoveCurrent(1);
                e.Handled = true;
                return;
            }
            if (e.KeyCode == Keys.Up)
            {
                MoveCurrent(-1);
                e.Handled = true;
                return;
            }
        }

        private void MoveCurrent(int delta)
        {
            if (currentMatches.Count == 0)
                return;
            currentIndex += delta;
            if (currentIndex < 0)
                currentIndex = currentMatches.Count - 1;
            if (currentIndex >= currentMatches.Count)
                currentIndex = 0;
            UpdateDetail();
        }

        private void SearchNow()
        {
            string q = search.Text.Trim();
            List<CommandCard> matches = CommandSearch.Search(cards, q, CurrentScene(), 10);
            currentMatches = matches;
            currentIndex = matches.Count == 0 ? -1 : 0;
            results.BeginUpdate();
            results.Items.Clear();
            for (int i = 0; i < matches.Count; i++)
            {
                CommandCard card = matches[i];
                ListViewItem item = new ListViewItem(card.Title + "  ·  " + card.Body);
                item.SubItems.Add(card.KindLabel());
                item.Tag = card;
                item.ForeColor = Ui.CommandInk;
                results.Items.Add(item);
            }
            results.EndUpdate();
            if (results.Items.Count > 0)
                results.Items[0].Selected = true;
            UpdateDetail();
        }

        private string CurrentScene()
        {
            return sceneFilter.SelectedItem == null ? "全部" : sceneFilter.SelectedItem.ToString();
        }

        private CommandCard SelectedCard()
        {
            if (currentIndex < 0 || currentIndex >= currentMatches.Count)
                return null;
            return currentMatches[currentIndex];
        }

        #pragma warning disable 0162
        private void UpdateDetail()
        {
            CommandCard focusedCard = SelectedCard();
            if (focusedCard == null)
            {
                detail.Text = "打开即见推荐；输入关键词、中文需求或命令即查。\r\n\r\n没搜到？把网页、文档或笔记粘到后台，整理后入库。";
                resultStatus.Text = "Ctrl+Alt+P 全局唤出/隐藏 · ` 切换产品 · 右键添加";
                return;
            }
            detail.Text = focusedCard.Body + Environment.NewLine + Environment.NewLine +
                focusedCard.Desc;
            resultStatus.Text = (currentIndex + 1) + "/" + currentMatches.Count + "  ·  " + focusedCard.KindLabel() + "  ·  Enter 复制  ·  ↑↓ 切换";
            return;

            CommandCard card = SelectedCard();
            if (card == null)
            {
                detail.Text = "添加网页、文档或笔记后，会整理成摘要、步骤、要点和命令，可在这里搜索。";
                return;
            }
            detail.Text = card.Body + Environment.NewLine +
                card.Desc + Environment.NewLine +
                "类型: " + card.KindLabel() + "  来源: " + card.Source;
        }

        #pragma warning restore 0162
        private void CopySelected()
        {
            CommandCard card = SelectedCard();
            if (card == null)
                return;
            if (!DangerGuard.ConfirmCopy(this, card))
                return;
            Clipboard.SetText(card.Body);
            card.CopyCount++;
            card.LastUsedAt = DateTime.Now;
            store.BumpCopy(card.Id);
        }
    }

    internal sealed class ManagerForm : Form
    {
        private readonly CommandStore store;
        private readonly TabControl tabs;
        private readonly TextBox rawInput;
        private readonly Label importStatus;
        private readonly ListView recentList;
        private readonly ListView cardList;
        private readonly TextBox cardDetail;
        private readonly TextBox librarySearch;
        private readonly ComboBox librarySceneFilter;
        private readonly ComboBox importCollection;
        private List<CommandCard> pendingImportCards = new List<CommandCard>();
        private string inputSourceReference = "粘贴内容";
        private string loadedInputSnapshot = "";

        // 导入预览右侧字段化编辑器（一次编辑一张）
        private TextBox editorTitle;
        private TextBox editorAliases;
        private ComboBox editorProduct;
        private ComboBox editorKind;
        private ComboBox editorRisk;
        private CheckBox editorFav;
        private TextBox editorBody;
        private TextBox editorDesc;
        private TextBox editorSource;
        private bool editorLoading;
        private SplitContainer previewSplit;
        private SplitContainer importSplit;

        public event EventHandler LibraryChanged;

        public ManagerForm(CommandStore store)
        {
            this.store = store;
            Text = "Command Pocket";
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1040, 680);
            MinimumSize = new Size(860, 540);
            Font = Ui.BodyFont;
            BackColor = Ui.AppBack;

            tabs = new TabControl();
            tabs.Dock = DockStyle.Fill;
            tabs.Font = Ui.BodyFont;
            tabs.Appearance = TabAppearance.FlatButtons;
            tabs.SizeMode = TabSizeMode.Fixed;
            tabs.ItemSize = new Size(0, 1);
            Controls.Add(tabs);

            Panel managerHeader = new Panel();
            managerHeader.Dock = DockStyle.Top;
            managerHeader.Height = 58;
            managerHeader.Padding = new Padding(18, 12, 18, 10);
            managerHeader.BackColor = Ui.Surface;

            Label managerTitle = new Label();
            managerTitle.Text = "Command Pocket 后台  ·  " + Program.VersionLabel;
            managerTitle.Dock = DockStyle.Left;
            managerTitle.Width = 240;
            managerTitle.TextAlign = ContentAlignment.MiddleLeft;
            managerTitle.Font = Ui.TitleFont;
            managerTitle.ForeColor = Ui.Ink;

            FlowLayoutPanel managerNav = new FlowLayoutPanel();
            managerNav.Dock = DockStyle.Right;
            managerNav.Width = 260;
            managerNav.FlowDirection = FlowDirection.RightToLeft;
            managerNav.WrapContents = false;

            Button libraryModeButton = new Button();
            libraryModeButton.Text = "已整理";
            Ui.StyleSecondaryButton(libraryModeButton, 88);
            libraryModeButton.Click += delegate { SelectMode("library"); };

            Button importModeButton = new Button();
            importModeButton.Text = "导入工作台";
            Ui.StylePrimaryButton(importModeButton, 104);
            importModeButton.Click += delegate { SelectMode("import"); };

            managerNav.Controls.Add(libraryModeButton);
            managerNav.Controls.Add(importModeButton);
            managerHeader.Controls.Add(managerNav);
            managerHeader.Controls.Add(managerTitle);
            Controls.Add(managerHeader);

            TabPage importPage = new TabPage("添加资料");
            TabPage libraryPage = new TabPage("已整理");
            tabs.TabPages.Add(importPage);
            tabs.TabPages.Add(libraryPage);

            Label importHint = new Label();
            importHint.Dock = DockStyle.Top;
            importHint.Height = 72;
            importHint.Padding = new Padding(18, 14, 18, 8);
            importHint.BackColor = Ui.PanelBack;
            importHint.ForeColor = Ui.Muted;
            importHint.Font = Ui.SectionFont;
            importHint.TextAlign = ContentAlignment.MiddleLeft;
            importHint.Text = "后台流程：粘贴网页链接、正文、Markdown、TXT、攻略或命令笔记，先生成标准内容预览，确认后再保存到小窗。";

            rawInput = new TextBox();
            rawInput.Multiline = true;
            rawInput.ScrollBars = ScrollBars.Vertical;
            rawInput.Dock = DockStyle.Fill;
            rawInput.BorderStyle = BorderStyle.FixedSingle;
            rawInput.BackColor = Ui.InputBack;
            rawInput.ForeColor = Ui.Ink;
            rawInput.Font = Ui.MonoFont;
            rawInput.Text = "示例:\r\nhttps://example.com/cheatsheet\r\nfind . -name \"*.log\"\r\ngit reset --soft HEAD~1\r\ndocker system prune -a\r\nHESOYAM";

            FlowLayoutPanel importActions = new FlowLayoutPanel();
            importActions.Dock = DockStyle.Bottom;
            importActions.Height = 104;
            importActions.Padding = new Padding(18, 12, 18, 10);
            importActions.BackColor = Ui.PanelBack;
            importActions.WrapContents = true;

            Button importButton = new Button();
            importButton.Text = "生成标准内容";
            Ui.StylePrimaryButton(importButton, 116);
            importButton.Click += delegate { GenerateImportPreview(); };

            Button saveImportButton = new Button();
            saveImportButton.Text = "保存结果";
            Ui.StyleSecondaryButton(saveImportButton, 88);
            saveImportButton.Click += delegate { SaveImportPreview(); };

            Button openFileButton = new Button();
            openFileButton.Text = "打开文件";
            Ui.StyleSecondaryButton(openFileButton, 88);
            openFileButton.Click += delegate { OpenFileIntoInput(); };

            importCollection = new ComboBox();
            importCollection.Width = 104;
            importCollection.Height = 30;
            importCollection.DropDownStyle = ComboBoxStyle.DropDownList;
            ReloadCollectionChoices(importCollection, "Personal");

            Label collectionLabel = new Label();
            collectionLabel.Text = "归档到";
            collectionLabel.Width = 48;
            collectionLabel.Height = 30;
            collectionLabel.TextAlign = ContentAlignment.MiddleLeft;
            collectionLabel.ForeColor = Ui.Muted;

            Button clearButton = new Button();
            clearButton.Text = "清空";
            Ui.StyleSecondaryButton(clearButton, 72);
            clearButton.Click += delegate
            {
                rawInput.Clear();
                pendingImportCards = new List<CommandCard>();
                recentList.Items.Clear();
                inputSourceReference = "粘贴内容";
                loadedInputSnapshot = "";
                importStatus.Text = "先生成预览，再保存到资料库。";
                rawInput.Focus();
            };

            importStatus = new Label();
            importStatus.Width = 132;
            importStatus.Height = 30;
            importStatus.TextAlign = ContentAlignment.MiddleLeft;
            importStatus.ForeColor = Ui.Muted;
            importStatus.Text = "先生成预览，再保存到资料库。";

            importActions.Controls.Add(importButton);
            importActions.Controls.Add(saveImportButton);
            importActions.Controls.Add(openFileButton);
            importActions.Controls.Add(collectionLabel);
            importActions.Controls.Add(importCollection);
            importActions.Controls.Add(clearButton);
            importActions.Controls.Add(importStatus);
            importActions.SetFlowBreak(openFileButton, true);

            recentList = BuildCardList();
            recentList.Dock = DockStyle.Fill;
            recentList.SelectedIndexChanged += delegate { FillImportEditor(); };
            recentList.DoubleClick += delegate { EditSelectedPreviewCard(); };

            Label recentHint = BuildSectionLabel("标准内容预览", "这里是本次生成结果：摘要、步骤、要点、警告、命令和攻略。确认无误后保存。", 52);

            FlowLayoutPanel previewActions = new FlowLayoutPanel();
            previewActions.Dock = DockStyle.Bottom;
            previewActions.Height = 48;
            previewActions.Padding = new Padding(0, 10, 0, 0);
            previewActions.BackColor = Ui.AppBack;
            previewActions.FlowDirection = FlowDirection.RightToLeft;

            Button removePreviewButton = new Button();
            removePreviewButton.Text = "移除选中";
            Ui.StyleSecondaryButton(removePreviewButton, 88);
            removePreviewButton.Click += delegate { RemoveSelectedPreviewCard(); };

            Button editPreviewButton = new Button();
            editPreviewButton.Text = "高级编辑…";
            Ui.StyleSecondaryButton(editPreviewButton, 96);
            editPreviewButton.Click += delegate { EditSelectedPreviewCard(); };

            previewActions.Controls.Add(removePreviewButton);
            previewActions.Controls.Add(editPreviewButton);

            // 右侧：字段化预览/编辑器（宽度随分栏拖动自适应）
            Panel importEditorShell = new Panel();
            importEditorShell.Dock = DockStyle.Fill;
            importEditorShell.BackColor = Ui.AppBack;
            importEditorShell.Controls.Add(BuildImportEditorPanel());
            importEditorShell.Controls.Add(previewActions);

            SplitContainer previewSplitLocal = new SplitContainer();
            previewSplitLocal.Dock = DockStyle.Fill;
            previewSplitLocal.Orientation = Orientation.Vertical;
            previewSplitLocal.SplitterWidth = 1;
            previewSplitLocal.BackColor = Ui.Border;
            previewSplitLocal.Panel1.BackColor = Ui.AppBack;
            previewSplitLocal.Panel2.BackColor = Ui.AppBack;
            previewSplitLocal.Panel1.Controls.Add(recentList);
            previewSplitLocal.Panel2.Controls.Add(importEditorShell);
            previewSplit = previewSplitLocal;

            recentHint.Text = "生成结果：左侧点选卡片，右侧按字段预览/微调；改完统一入库。";

            SplitContainer importSplitLocal = new SplitContainer();
            importSplitLocal.Dock = DockStyle.Fill;
            importSplitLocal.SplitterWidth = 1;
            importSplitLocal.BackColor = Ui.Border;
            importSplitLocal.Panel1.BackColor = Ui.AppBack;
            importSplitLocal.Panel2.BackColor = Ui.AppBack;
            importSplit = importSplitLocal;

            Panel importInputPanel = new Panel();
            importInputPanel.Dock = DockStyle.Fill;
            importInputPanel.Padding = new Padding(18);
            importInputPanel.BackColor = Ui.AppBack;
            importInputPanel.Controls.Add(rawInput);
            importInputPanel.Controls.Add(importActions);
            importInputPanel.Controls.Add(importHint);

            Panel importPreviewPanel = new Panel();
            importPreviewPanel.Dock = DockStyle.Fill;
            importPreviewPanel.Padding = new Padding(18);
            importPreviewPanel.BackColor = Ui.AppBack;
            importPreviewPanel.Controls.Add(previewSplit);
            importPreviewPanel.Controls.Add(recentHint);

            importSplitLocal.Panel1.Controls.Add(importInputPanel);
            importSplitLocal.Panel2.Controls.Add(importPreviewPanel);
            importPage.Controls.Add(importSplitLocal);

            Label libraryHint = new Label();
            libraryHint.Dock = DockStyle.Top;
            libraryHint.Height = 58;
            libraryHint.Padding = new Padding(18, 12, 18, 6);
            libraryHint.BackColor = Ui.PanelBack;
            libraryHint.ForeColor = Ui.Muted;
            libraryHint.Font = Ui.SectionFont;
            libraryHint.TextAlign = ContentAlignment.MiddleLeft;
            libraryHint.Text = "这里仅用于查看和复制；日常使用回到小窗搜索。";

            librarySearch = new TextBox();
            librarySearch.Dock = DockStyle.Top;
            librarySearch.Height = 34;
            librarySearch.BorderStyle = BorderStyle.FixedSingle;
            librarySearch.BackColor = Ui.InputBack;
            librarySearch.ForeColor = Ui.Ink;
            librarySearch.Font = Ui.SearchFont;
            librarySearch.TextChanged += delegate { ReloadLibrary(); };

            librarySceneFilter = new ComboBox();
            librarySceneFilter.Dock = DockStyle.Top;
            librarySceneFilter.Height = 30;
            librarySceneFilter.DropDownStyle = ComboBoxStyle.DropDownList;
            ReloadCollectionChoices(librarySceneFilter, "全部");
            librarySceneFilter.SelectedIndexChanged += delegate { ReloadLibrary(); };
            Label libraryControlsHint = BuildSectionLabel("检索与筛选", "按关键词或场景缩小资料范围；日常使用仍回到前台便签。", 44);

            FlowLayoutPanel libraryActions = new FlowLayoutPanel();
            libraryActions.Dock = DockStyle.Top;
            libraryActions.Height = 52;
            libraryActions.Padding = new Padding(18, 10, 18, 8);
            libraryActions.BackColor = Ui.PanelBack;

            Button copyButton = new Button();
            copyButton.Text = "复制";
            Ui.StylePrimaryButton(copyButton, 72);
            copyButton.Click += delegate { CopySelectedLibraryCard(); };
            libraryActions.Controls.Add(copyButton);

            Button editButton = new Button();
            editButton.Text = "\u7f16\u8f91";
            Ui.StyleSecondaryButton(editButton, 72);
            editButton.Click += delegate { EditSelectedLibraryCard(); };
            libraryActions.Controls.Add(editButton);

            Button deleteButton = new Button();
            deleteButton.Text = "\u5220\u9664";
            Ui.StyleSecondaryButton(deleteButton, 72);
            deleteButton.Click += delegate { DeleteSelectedLibraryCard(); };
            libraryActions.Controls.Add(deleteButton);

            Button exportButton = new Button();
            exportButton.Text = "\u5bfc\u51fa";
            Ui.StyleSecondaryButton(exportButton, 72);
            exportButton.Click += delegate { ExportLibrary(); };
            libraryActions.Controls.Add(exportButton);

            Button restoreButton = new Button();
            restoreButton.Text = "\u5bfc\u5165\u5907\u4efd";
            Ui.StyleSecondaryButton(restoreButton, 88);
            restoreButton.Click += delegate { RestoreLibrary(); };
            libraryActions.Controls.Add(restoreButton);

            Button collectionsButton = new Button();
            collectionsButton.Text = "管理产品";
            Ui.StyleSecondaryButton(collectionsButton, 88);
            collectionsButton.Click += delegate { ManageProducts(); };
            libraryActions.Controls.Add(collectionsButton);

            cardList = BuildCardList();
            cardList.Dock = DockStyle.Fill;
            cardList.SelectedIndexChanged += delegate { UpdateCardDetail(); };
            cardList.DoubleClick += delegate { CopySelectedLibraryCard(); };
            Label cardListHint = BuildSectionLabel("已整理内容", "这里是长期资料库；选择一条后，下方显示完整预览。", 44);

            cardDetail = new TextBox();
            cardDetail.Dock = DockStyle.Bottom;
            cardDetail.Height = 120;
            cardDetail.Multiline = true;
            cardDetail.ReadOnly = true;
            cardDetail.ScrollBars = ScrollBars.Vertical;
            cardDetail.BorderStyle = BorderStyle.None;
            cardDetail.BackColor = Ui.InputBack;
            cardDetail.ForeColor = Ui.Ink;
            cardDetail.Font = Ui.SmallFont;
            Label cardDetailHint = BuildSectionLabel("当前预览", "用于确认内容和复制，不承担日常悬浮显示。", 44);

            libraryPage.Controls.Add(cardList);
            libraryPage.Controls.Add(cardListHint);
            libraryPage.Controls.Add(cardDetail);
            libraryPage.Controls.Add(cardDetailHint);
            libraryPage.Controls.Add(libraryActions);
            libraryPage.Controls.Add(librarySearch);
            libraryPage.Controls.Add(librarySceneFilter);
            libraryPage.Controls.Add(libraryControlsHint);
            libraryPage.Controls.Add(libraryHint);

            ReloadLibrary();
        }

        public void SelectMode(string mode)
        {
            tabs.SelectedIndex = mode == "import" ? 0 : 1;
            ReloadLibrary();
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            // 分栏配置（最小宽度 + 初始比例）：推迟到消息循环空闲、布局稳定后再做
            try
            {
                BeginInvoke(new MethodInvoker(delegate
                {
                    ApplySplitSetup(importSplit, 0.40f, 220, 280);
                    ApplySplitSetup(previewSplit, 0.38f, 80, 110);
                }));
            }
            catch
            {
            }
        }

        private static void ApplySplitSetup(SplitContainer split, float ratio, int min1, int min2)
        {
            if (split == null || split.Width < 120)
                return;
            try
            {
                split.Panel1MinSize = Math.Min(min1, split.Width / 3);
                split.Panel2MinSize = Math.Min(min2, split.Width / 3);
                int target = (int)(split.Width * ratio);
                int minOk = split.Panel1MinSize;
                int maxOk = split.Width - split.Panel2MinSize;
                if (target < minOk)
                    target = minOk;
                if (target > maxOk)
                    target = maxOk;
                if (target >= minOk && target <= maxOk)
                    split.SplitterDistance = target;
            }
            catch
            {
                // 布局未就绪时忽略，保持默认分栏
            }
        }

        private static Label BuildSectionLabel(string title, string description, int height)
        {
            Label label = new Label();
            label.Dock = DockStyle.Top;
            label.Height = height;
            label.Padding = new Padding(0, 0, 0, 10);
            label.BackColor = Ui.AppBack;
            label.ForeColor = Ui.Muted;
            label.Font = Ui.SmallFont;
            label.TextAlign = ContentAlignment.MiddleLeft;
            label.Text = title + Environment.NewLine + description;
            return label;
        }

        private static ListView BuildCardList()
        {
            ListView list = new ListView();
            list.View = View.Details;
            list.FullRowSelect = true;
            list.HideSelection = false;
            list.BorderStyle = BorderStyle.None;
            list.BackColor = Ui.Surface;
            list.ForeColor = Ui.Ink;
            list.Font = Ui.BodyFont;
            list.Columns.Add("标题", 260);
            list.Columns.Add("标准内容", 430);
            list.Columns.Add("类型", 80);
            return list;
        }

        private void ReloadCollectionChoices(ComboBox combo, string selected)
        {
            combo.Items.Clear();
            if (combo == librarySceneFilter)
                combo.Items.Add("全部");
            List<string> products = store.LoadProducts();
            for (int i = 0; i < products.Count; i++)
                combo.Items.Add(products[i]);
            int selectedIndex = combo.Items.IndexOf(selected);
            combo.SelectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
        }

        private void GenerateImportPreview()
        {
            string sourceText = ResolveInputText(rawInput.Text);
            string collection = importCollection.SelectedItem == null ? "Personal" : importCollection.SelectedItem.ToString();
            List<CommandCard> cards = CommandExtractor.Extract(sourceText, collection, inputSourceReference);
            ImportDiagnostics.Log("EXTRACT source=" + inputSourceReference + " chars=" + sourceText.Length + " cards=" + cards.Count);
            if (cards.Count == 0)
            {
                importStatus.Text = "没有识别到可用条目。";
                MessageBox.Show("没有识别到可整理的摘要、步骤、要点、命令或攻略。", "添加资料");
                return;
            }

            pendingImportCards = cards;
            recentList.Items.Clear();
            for (int i = 0; i < cards.Count; i++)
                recentList.Items.Add(ToItem(cards[i]));
            importStatus.Text = "已生成 " + cards.Count + " 条标准内容，请检查后保存。";
            if (recentList.Items.Count > 0)
                recentList.Items[0].Selected = true;
        }

        private void SaveImportPreview()
        {
            if (pendingImportCards.Count == 0)
                GenerateImportPreview();
            if (pendingImportCards.Count == 0)
                return;

            int savedCount = store.AddCards(pendingImportCards);
            ImportDiagnostics.Log("SAVE requested=" + pendingImportCards.Count + " added=" + savedCount);
            if (savedCount == 0)
            {
                importStatus.Text = "没有新增内容；这些条目已经在资料库里。";
                return;
            }
            pendingImportCards = new List<CommandCard>();
            rawInput.Clear();
            recentList.Items.Clear();
            inputSourceReference = "粘贴内容";
            loadedInputSnapshot = "";
            importStatus.Text = "已保存 " + savedCount + " 条，可在小窗搜索。";
            ReloadLibrary();
            if (LibraryChanged != null)
                LibraryChanged(this, EventArgs.Empty);
        }

        private void OpenFileIntoInput()
        {
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Title = "选择要整理的资料";
            dialog.Filter = "资料文件 (*.txt;*.md;*.markdown;*.html;*.htm)|*.txt;*.md;*.markdown;*.html;*.htm|所有文件 (*.*)|*.*";
            if (dialog.ShowDialog(this) != DialogResult.OK)
                return;
            try
            {
                string text = File.ReadAllText(dialog.FileName, Encoding.UTF8);
                if (dialog.FileName.EndsWith(".html", StringComparison.OrdinalIgnoreCase) || dialog.FileName.EndsWith(".htm", StringComparison.OrdinalIgnoreCase))
                    text = TextCleaner.FromHtml(text);
                rawInput.Text = text;
                inputSourceReference = dialog.FileName;
                loadedInputSnapshot = text;
                pendingImportCards = new List<CommandCard>();
                recentList.Items.Clear();
                importStatus.Text = "已读取文件，点击生成标准内容。";
            }
            catch (Exception ex)
            {
                MessageBox.Show("文件读取失败：\n" + ex.Message, "打开文件", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private string ResolveInputText(string raw)
        {
            string value = (raw ?? "").Trim();
            Uri uri;
            bool isUrl = Uri.TryCreate(value, UriKind.Absolute, out uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
            if (isUrl)
            {
                try
                {
                    ImportDiagnostics.Log("FETCH start url=" + value);
                    importStatus.Text = "正在读取网页…";
                    importStatus.Refresh();
                    using (WebClient client = new TimeoutWebClient())
                    {
                        client.Encoding = Encoding.UTF8;
                        client.Headers.Add("User-Agent", "CommandPocket/0.2");
                        string html = client.DownloadString(value);
                        string cleaned = TextCleaner.FromHtml(html);
                        inputSourceReference = value;
                        loadedInputSnapshot = "";
                        importStatus.Text = "已读取网页，正在整理。";
                        ImportDiagnostics.Log("FETCH success url=" + value + " html=" + html.Length + " cleaned=" + cleaned.Length);
                        return cleaned;
                    }
                }
                catch (Exception ex)
                {
                    ImportDiagnostics.Log("FETCH failed url=" + value + " error=" + ex.GetType().Name + ": " + ex.Message);
                    importStatus.Text = "网页读取失败，请粘贴正文。";
                    MessageBox.Show("网页读取失败，可以复制网页正文后再整理。\n\n" + ex.Message, "添加资料");
                    return raw;
                }
            }
            if (raw != loadedInputSnapshot)
                inputSourceReference = "粘贴内容";
            return raw;
        }

        private void ReloadLibrary()
        {
            string q = librarySearch.Text.Trim();
            string scene = librarySceneFilter.SelectedItem == null ? "全部" : librarySceneFilter.SelectedItem.ToString();
            List<CommandCard> cards = CommandSearch.Search(store.LoadCards(), q, scene, 200);
            cardList.Items.Clear();
            for (int i = 0; i < cards.Count; i++)
                cardList.Items.Add(ToItem(cards[i]));
            UpdateCardDetail();
        }

        private static ListViewItem ToItem(CommandCard card)
        {
            ListViewItem item = new ListViewItem(card.Title);
            item.SubItems.Add(card.Body);
            item.SubItems.Add(card.KindLabel());
            item.Tag = card;
            item.ForeColor = card.DisplayColor();
            return item;
        }

        private CommandCard SelectedPreviewCard()
        {
            if (recentList.SelectedItems.Count == 0)
                return null;
            return recentList.SelectedItems[0].Tag as CommandCard;
        }

        private void RefreshPreviewList()
        {
            recentList.Items.Clear();
            for (int i = 0; i < pendingImportCards.Count; i++)
                recentList.Items.Add(ToItem(pendingImportCards[i]));
            importStatus.Text = pendingImportCards.Count == 0 ? "预览已清空。" : "当前预览 " + pendingImportCards.Count + " 条，确认后保存。";
            if (recentList.Items.Count > 0)
                recentList.Items[0].Selected = true;
        }

        // ---------- 字段化编辑器：构造 ----------

        private Panel BuildImportEditorPanel()
        {
            editorTitle = MakeEditorBox(false, 30);
            editorAliases = MakeEditorBox(false, 30);
            editorProduct = MakeEditorCombo();
            editorKind = MakeEditorCombo();
            editorRisk = MakeEditorCombo();
            editorFav = new CheckBox();
            editorFav.Dock = DockStyle.Top;
            editorFav.Height = 26;
            editorFav.Text = "收藏（推荐时优先）";
            editorFav.ForeColor = Ui.Ink;
            editorFav.Font = Ui.SmallFont;
            editorBody = MakeEditorBox(true, 180);
            editorDesc = MakeEditorBox(true, 64);
            editorSource = MakeEditorBox(false, 30);

            List<string> products = store.LoadProducts();
            for (int i = 0; i < products.Count; i++)
                editorProduct.Items.Add(products[i]);
            editorKind.Items.Add("命令");
            editorKind.Items.Add("提示词");
            editorKind.Items.Add("步骤");
            editorKind.Items.Add("要点");
            editorKind.Items.Add("警告");
            editorKind.Items.Add("攻略");
            editorKind.Items.Add("数据");
            editorKind.Items.Add("文档");
            editorRisk.Items.Add("低");
            editorRisk.Items.Add("中");
            editorRisk.Items.Add("高");
            editorRisk.Items.Add("极高");

            editorTitle.TextChanged += delegate { ImportEditorChanged(); };
            editorAliases.TextChanged += delegate { ImportEditorChanged(); };
            editorBody.TextChanged += delegate { ImportEditorChanged(); };
            editorDesc.TextChanged += delegate { ImportEditorChanged(); };
            editorSource.TextChanged += delegate { ImportEditorChanged(); };
            editorProduct.SelectedIndexChanged += delegate { ImportEditorChanged(); };
            editorKind.SelectedIndexChanged += delegate { ImportEditorChanged(); };
            editorRisk.SelectedIndexChanged += delegate { ImportEditorChanged(); };
            editorFav.CheckedChanged += delegate { ImportEditorChanged(); };

            Panel panel = new Panel();
            panel.Dock = DockStyle.Fill;
            panel.AutoScroll = true;
            panel.Padding = new Padding(12, 4, 12, 0);
            panel.BackColor = Ui.AppBack;
            // Dock Top：先加的靠下，标题组最后加 = 视觉置顶
            AddEditorRow(panel, editorSource, "来源");
            AddEditorRow(panel, editorDesc, "何时用（一句话）");
            AddEditorRow(panel, editorBody, "正文（命令 / 提示词 / 文本）");
            AddEditorRow(panel, editorFav, null);
            AddEditorRow(panel, editorRisk, "风险（高/极高复制前会确认）");
            AddEditorRow(panel, editorKind, "类型");
            AddEditorRow(panel, editorProduct, "产品");
            AddEditorRow(panel, editorAliases, "别名（逗号分隔，供中英检索）");
            AddEditorRow(panel, editorTitle, "标题");
            return panel;
        }

        private static void AddEditorRow(Panel panel, Control control, string label)
        {
            if (control.Dock != DockStyle.Top)
                control.Dock = DockStyle.Top;
            panel.Controls.Add(control);
            if (label != null && label.Length > 0)
            {
                Label fieldLabel = new Label();
                fieldLabel.Dock = DockStyle.Top;
                fieldLabel.Height = 22;
                fieldLabel.Padding = new Padding(0, 6, 0, 0);
                fieldLabel.Text = label;
                fieldLabel.ForeColor = Ui.Muted;
                fieldLabel.Font = Ui.SmallFont;
                panel.Controls.Add(fieldLabel);
            }
        }

        private static TextBox MakeEditorBox(bool multiline, int height)
        {
            TextBox box = new TextBox();
            box.Dock = DockStyle.Top;
            box.BorderStyle = BorderStyle.FixedSingle;
            box.BackColor = Ui.InputBack;
            box.ForeColor = Ui.Ink;
            box.Font = multiline ? Ui.MonoFont : Ui.BodyFont;
            box.Multiline = multiline;
            box.ScrollBars = multiline ? ScrollBars.Vertical : ScrollBars.None;
            box.Height = height;
            return box;
        }

        private static ComboBox MakeEditorCombo()
        {
            ComboBox combo = new ComboBox();
            combo.Dock = DockStyle.Top;
            combo.Height = 28;
            combo.DropDownStyle = ComboBoxStyle.DropDownList;
            return combo;
        }

        // ---------- 字段化编辑器：填充 / 写回 ----------

        private void FillImportEditor()
        {
            CommandCard card = SelectedPreviewCard();
            editorLoading = true;
            if (card == null)
            {
                editorTitle.Text = "";
                editorAliases.Text = "";
                editorBody.Text = "";
                editorDesc.Text = "";
                editorSource.Text = "";
                editorProduct.SelectedIndex = -1;
                editorKind.SelectedIndex = -1;
                editorRisk.SelectedIndex = -1;
                editorFav.Checked = false;
                editorLoading = false;
                return;
            }
            editorTitle.Text = card.Title ?? "";
            editorAliases.Text = card.Aliases ?? "";
            editorBody.Text = card.Body ?? "";
            editorDesc.Text = card.Desc ?? "";
            editorSource.Text = card.Source ?? "";
            SelectComboValue(editorProduct, card.Product);
            SelectComboValue(editorKind, CommandCard.KindLabelFor(card.Kind));
            SelectComboValue(editorRisk, Risk.Label(card.Risk));
            editorFav.Checked = card.IsFavorite;
            editorLoading = false;
        }

        private static void SelectComboValue(ComboBox combo, string value)
        {
            int index = -1;
            if (value != null)
            {
                for (int i = 0; i < combo.Items.Count; i++)
                {
                    if (String.Equals(combo.Items[i].ToString(), value, StringComparison.OrdinalIgnoreCase))
                    {
                        index = i;
                        break;
                    }
                }
            }
            combo.SelectedIndex = index;
        }

        private void ImportEditorChanged()
        {
            if (editorLoading)
                return;
            CommandCard card = SelectedPreviewCard();
            if (card == null)
                return;
            card.Title = editorTitle.Text.Trim();
            card.Aliases = editorAliases.Text.Trim();
            card.Body = editorBody.Text.Trim();
            card.Desc = editorDesc.Text.Trim();
            card.Source = editorSource.Text.Trim();
            if (editorProduct.SelectedItem != null)
                card.Product = editorProduct.SelectedItem.ToString();
            if (editorKind.SelectedItem != null)
                card.Kind = CommandCard.KindFromChinese(editorKind.SelectedItem.ToString());
            if (editorRisk.SelectedItem != null)
                card.Risk = Risk.FromChinese(editorRisk.SelectedItem.ToString());
            card.IsFavorite = editorFav.Checked;
            card.UpdatedAt = DateTime.Now;
            if (recentList.SelectedItems.Count > 0)
            {
                ListViewItem item = recentList.SelectedItems[0];
                item.Text = card.Title.Length == 0 ? (card.Body ?? "") : card.Title;
                item.SubItems[1].Text = card.Body ?? "";
                item.SubItems[2].Text = card.KindLabel();
            }
        }

        private void EditSelectedPreviewCard()
        {
            CommandCard card = SelectedPreviewCard();
            if (card == null)
                return;
            using (CardEditForm form = new CardEditForm(card, store.LoadProducts()))
            {
                if (form.ShowDialog(this) != DialogResult.OK)
                    return;
                form.ApplyTo(card);
                card.UpdatedAt = DateTime.Now;
            }
            RefreshPreviewList();
        }

        private void RemoveSelectedPreviewCard()
        {
            CommandCard card = SelectedPreviewCard();
            if (card == null)
                return;
            pendingImportCards.Remove(card);
            RefreshPreviewList();
        }

        private CommandCard SelectedLibraryCard()
        {
            if (cardList.SelectedItems.Count == 0)
                return null;
            return cardList.SelectedItems[0].Tag as CommandCard;
        }

        private void UpdateCardDetail()
        {
            CommandCard card = SelectedLibraryCard();
            if (card == null)
            {
                cardDetail.Text = "";
                return;
            }
            cardDetail.Text = card.Body + Environment.NewLine +
                card.Desc + Environment.NewLine +
                "类型: " + card.KindLabel() + "  产品: " + card.Product + Environment.NewLine +
                "来源: " + card.Source;
        }

        private void CopySelectedLibraryCard()
        {
            CommandCard card = SelectedLibraryCard();
            if (card == null)
                return;
            if (!DangerGuard.ConfirmCopy(this, card))
                return;
            Clipboard.SetText(card.Body);
            card.CopyCount++;
            card.LastUsedAt = DateTime.Now;
            store.BumpCopy(card.Id);
        }

        private void EditSelectedLibraryCard()
        {
            CommandCard card = SelectedLibraryCard();
            if (card == null)
                return;
            using (CardEditForm form = new CardEditForm(card, store.LoadProducts()))
            {
                if (form.ShowDialog(this) != DialogResult.OK)
                    return;
                form.ApplyTo(card);
                store.UpsertCard(card);
            }
            ReloadLibrary();
            if (LibraryChanged != null)
                LibraryChanged(this, EventArgs.Empty);
        }

        private void DeleteSelectedLibraryCard()
        {
            CommandCard card = SelectedLibraryCard();
            if (card == null)
                return;
            DialogResult result = MessageBox.Show("\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u5df2\u4fdd\u5b58\u5185\u5bb9\u5417\uff1f\n\n" + card.Title, "\u5220\u9664\u5185\u5bb9", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
            if (result != DialogResult.OK)
                return;
            store.DeleteCard(card.Id);
            ReloadLibrary();
            if (LibraryChanged != null)
                LibraryChanged(this, EventArgs.Empty);
        }

        private void ExportLibrary()
        {
            SaveFileDialog dialog = new SaveFileDialog();
            dialog.Title = "导出资料库备份";
            dialog.Filter = "Command Pocket 备份 (*.jsonl)|*.jsonl|所有文件 (*.*)|*.*";
            dialog.FileName = "command-pocket-cards-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".jsonl";
            if (dialog.ShowDialog(this) != DialogResult.OK)
                return;
            store.ExportCards(dialog.FileName);
            MessageBox.Show("\u5df2\u5bfc\u51fa\u5230\uff1a\n" + dialog.FileName, "\u5bfc\u51fa\u5b8c\u6210");
        }

        private void RestoreLibrary()
        {
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Title = "导入 Command Pocket 备份";
            dialog.Filter = "Command Pocket 备份 (*.jsonl)|*.jsonl|所有文件 (*.*)|*.*";
            if (dialog.ShowDialog(this) != DialogResult.OK)
                return;
            try
            {
                int added = store.ImportCards(dialog.FileName);
                ReloadLibrary();
                if (LibraryChanged != null)
                    LibraryChanged(this, EventArgs.Empty);
                MessageBox.Show("\u5df2\u6062\u590d " + added + " \u6761\u65b0\u5185\u5bb9\u3002", "\u5bfc\u5165\u5b8c\u6210");
            }
            catch (Exception ex)
            {
                MessageBox.Show("\u5907\u4efd\u5bfc\u5165\u5931\u8d25\uff1a\n" + ex.Message, "\u5bfc\u5165\u5907\u4efd", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void ManageProducts()
        {
            using (ProductEditForm form = new ProductEditForm(store.LoadProducts()))
            {
                if (form.ShowDialog(this) != DialogResult.OK)
                    return;
                store.SaveProducts(form.Products());
            }
            ReloadCollectionChoices(importCollection, importCollection.SelectedItem == null ? "" : importCollection.SelectedItem.ToString());
            ReloadCollectionChoices(librarySceneFilter, "全部");
            if (LibraryChanged != null)
                LibraryChanged(this, EventArgs.Empty);
        }
    }

    internal sealed class ProductEditForm : Form
    {
        private readonly TextBox input;

        public ProductEditForm(List<string> products)
        {
            Text = "管理产品";
            StartPosition = FormStartPosition.CenterParent;
            Size = new Size(440, 460);
            MinimumSize = new Size(380, 320);
            BackColor = Ui.AppBack;
            Font = Ui.BodyFont;
            Padding = new Padding(18);

            Label hint = new Label();
            hint.Dock = DockStyle.Top;
            hint.Height = 60;
            hint.Text = "每行一个产品（如 Linux / Git / Codex / PyAgent）。\n产品 = 内容空间：归档、筛选、前台切换、推荐都按产品隔离。";
            hint.ForeColor = Ui.Muted;

            input = new TextBox();
            input.Dock = DockStyle.Fill;
            input.Multiline = true;
            input.ScrollBars = ScrollBars.Vertical;
            input.BorderStyle = BorderStyle.FixedSingle;
            input.BackColor = Ui.InputBack;
            input.ForeColor = Ui.Ink;
            input.Font = Ui.BodyFont;
            input.Text = String.Join(Environment.NewLine, products.ToArray());

            FlowLayoutPanel actions = new FlowLayoutPanel();
            actions.Dock = DockStyle.Bottom;
            actions.Height = 48;
            actions.FlowDirection = FlowDirection.RightToLeft;
            actions.Padding = new Padding(0, 10, 0, 0);

            Button save = new Button();
            save.Text = "保存";
            save.DialogResult = DialogResult.OK;
            Ui.StylePrimaryButton(save, 72);

            Button cancel = new Button();
            cancel.Text = "取消";
            cancel.DialogResult = DialogResult.Cancel;
            Ui.StyleSecondaryButton(cancel, 72);

            actions.Controls.Add(save);
            actions.Controls.Add(cancel);
            Controls.Add(input);
            Controls.Add(actions);
            Controls.Add(hint);
            AcceptButton = save;
            CancelButton = cancel;
        }

        public List<string> Products()
        {
            List<string> result = new List<string>();
            Dictionary<string, bool> seen = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            string[] lines = input.Text.Split(new string[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < lines.Length; i++)
            {
                string value = lines[i].Trim();
                if (value.Length == 0 || seen.ContainsKey(value))
                    continue;
                seen[value] = true;
                result.Add(value);
            }
            if (result.Count == 0)
                result.Add("Personal");
            return result;
        }
    }

    internal sealed class CardEditForm : Form
    {
        private static readonly string[] KindItems = new string[]
        {
            "命令", "提示词", "步骤", "要点", "警告", "攻略", "数据", "文档"
        };

        private static readonly string[] RiskItems = new string[]
        {
            "低", "中", "高", "极高"
        };

        private readonly TextBox titleInput;
        private readonly TextBox aliasesInput;
        private readonly ComboBox productCombo;
        private readonly ComboBox kindCombo;
        private readonly CheckBox favInput;
        private readonly ComboBox riskCombo;
        private readonly TextBox descInput;
        private readonly TextBox contentInput;
        private readonly TextBox sourceInput;

        public CardEditForm(CommandCard card, List<string> products)
        {
            Text = "编辑速查卡";
            StartPosition = FormStartPosition.CenterParent;
            Size = new Size(660, 620);
            MinimumSize = new Size(560, 480);
            Font = Ui.BodyFont;
            BackColor = Ui.AppBack;
            Padding = new Padding(18);

            Label heading = new Label();
            heading.Text = "编辑卡片（标题/别名供中英双语检索）";
            heading.Dock = DockStyle.Top;
            heading.Height = 32;
            heading.Font = Ui.TitleFont;
            heading.ForeColor = Ui.Ink;

            titleInput = BuildTextBox(card.Title, false);
            aliasesInput = BuildTextBox(card.Aliases, false);
            contentInput = BuildTextBox(card.Body, true);
            descInput = BuildTextBox(card.Desc, true);
            sourceInput = BuildTextBox(card.Source, false);

            favInput = new CheckBox();
            favInput.Dock = DockStyle.Top;
            favInput.Height = 28;
            favInput.Text = "收藏（推荐时优先）";
            favInput.Checked = card.IsFavorite;
            favInput.Font = Ui.SmallFont;
            favInput.ForeColor = Ui.Ink;

            productCombo = BuildCombo(products.ToArray(), card.Product);
            kindCombo = BuildCombo(KindItems, CommandCard.KindLabelFor(card.Kind));
            riskCombo = BuildCombo(RiskItems, Risk.Label(card.Risk));

            Panel fields = new Panel();
            fields.Dock = DockStyle.Fill;
            fields.AutoScroll = true;
            fields.BackColor = Ui.AppBack;
            fields.Controls.Add(contentInput);
            fields.Controls.Add(BuildFieldLabel("内容（命令 / 提示词 / 文本）"));
            fields.Controls.Add(descInput);
            fields.Controls.Add(BuildFieldLabel("何时用（一句话）"));
            fields.Controls.Add(riskCombo);
            fields.Controls.Add(BuildFieldLabel("风险"));
            fields.Controls.Add(favInput);
            fields.Controls.Add(kindCombo);
            fields.Controls.Add(BuildFieldLabel("类型"));
            fields.Controls.Add(productCombo);
            fields.Controls.Add(BuildFieldLabel("产品"));
            fields.Controls.Add(sourceInput);
            fields.Controls.Add(BuildFieldLabel("来源"));
            fields.Controls.Add(aliasesInput);
            fields.Controls.Add(BuildFieldLabel("别名（逗号分隔，如 tar, 压缩, 打包）"));
            fields.Controls.Add(titleInput);
            fields.Controls.Add(BuildFieldLabel("标题"));

            FlowLayoutPanel actions = new FlowLayoutPanel();
            actions.Dock = DockStyle.Bottom;
            actions.Height = 52;
            actions.FlowDirection = FlowDirection.RightToLeft;
            actions.Padding = new Padding(0, 12, 0, 0);

            Button ok = new Button();
            ok.Text = "保存修改";
            Ui.StylePrimaryButton(ok, 92);
            ok.DialogResult = DialogResult.OK;

            Button cancel = new Button();
            cancel.Text = "取消";
            Ui.StyleSecondaryButton(cancel, 72);
            cancel.DialogResult = DialogResult.Cancel;

            actions.Controls.Add(ok);
            actions.Controls.Add(cancel);
            Controls.Add(fields);
            Controls.Add(actions);
            Controls.Add(heading);
            AcceptButton = ok;
            CancelButton = cancel;
        }

        public void ApplyTo(CommandCard card)
        {
            string title = titleInput.Text.Trim();
            string body = contentInput.Text.Trim();
            if (title.Length == 0)
                title = body.Length == 0 ? card.Title : body;
            if (body.Length == 0)
                body = card.Body;
            card.Title = title;
            card.Aliases = aliasesInput.Text.Trim();
            card.Body = body;
            card.Desc = descInput.Text.Trim();
            card.Product = productCombo.SelectedItem == null ? card.Product : productCombo.SelectedItem.ToString();
            card.Kind = kindCombo.SelectedItem == null ? card.Kind : CommandCard.KindFromChinese(kindCombo.SelectedItem.ToString());
            card.Risk = riskCombo.SelectedItem == null ? card.Risk : Risk.FromChinese(riskCombo.SelectedItem.ToString());
            card.Source = sourceInput.Text.Trim();
            card.IsFavorite = favInput.Checked;
            if (card.Desc.Length == 0)
                card.Desc = CommandClassifier.Describe(card.Body, card.Kind);
            card.Tags = CommandCard.JoinTokens(card.Tags, CommandClassifier.Domain(card.Body));
            card.UpdatedAt = DateTime.Now;
        }

        private static ComboBox BuildCombo(string[] items, string selected)
        {
            ComboBox combo = new ComboBox();
            combo.DropDownStyle = ComboBoxStyle.DropDownList;
            combo.Dock = DockStyle.Top;
            combo.Height = 30;
            for (int i = 0; i < items.Length; i++)
                combo.Items.Add(items[i]);
            int index = -1;
            for (int i = 0; i < items.Length; i++)
            {
                if (items[i] == selected)
                {
                    index = i;
                    break;
                }
            }
            combo.SelectedIndex = index >= 0 ? index : 0;
            return combo;
        }

        private static TextBox BuildTextBox(string value, bool multiline)
        {
            TextBox box = new TextBox();
            box.Dock = DockStyle.Top;
            box.Text = value ?? "";
            box.BorderStyle = BorderStyle.FixedSingle;
            box.BackColor = Ui.InputBack;
            box.ForeColor = Ui.Ink;
            box.Font = multiline ? Ui.MonoFont : Ui.BodyFont;
            box.Multiline = multiline;
            box.ScrollBars = multiline ? ScrollBars.Vertical : ScrollBars.None;
            box.Height = multiline ? 150 : 30;
            return box;
        }

        private static Label BuildFieldLabel(string text)
        {
            Label label = new Label();
            label.Dock = DockStyle.Top;
            label.Height = 26;
            label.Padding = new Padding(0, 8, 0, 0);
            label.Text = text;
            label.ForeColor = Ui.Muted;
            label.Font = Ui.SmallFont;
            return label;
        }
    }

    internal sealed class CommandCard
    {
        public const string KindCommand = "command";
        public const string KindPrompt = "prompt";
        public const string KindStep = "step";
        public const string KindPoint = "point";
        public const string KindWarning = "warning";
        public const string KindGuide = "guide";
        public const string KindData = "data";
        public const string KindDoc = "doc";

        public string Id;
        public string Product;        // 归属产品（原 Collection）
        public string Title;          // 标题，中英均可
        public string Aliases;        // 别名，逗号分隔（双语检索关键）
        public string Kind;           // command|prompt|step|point|warning|guide|data|doc
        public string Body;           // 正文：命令 / prompt 模板 / 步骤文本
        public string Desc;           // "何时用"一句话
        public string Tags;           // 逗号分隔
        public string Source;         // 来源 URL / 文件 / 粘贴
        public string Risk;           // low|medium|high|critical
        public string Purpose;        // 目的句（“我刚用它干什么”的原话，检索钥匙）
        public string RiskScope;      // 风险明细·动什么：本机/项目/全局/文件
        public string RiskMutation;   // 风险明细·改删什么：覆盖/删除/不可逆/无
        public string RiskRevert;     // 风险明细·能否还原：yes/no/unknown
        public bool RiskLabeled;      // 是否人工标注过风险(false=未标注→展示按黄)
        public bool IsFavorite;
        public int Heat;              // 主流热度 seed 0..5（预置，不随用户数据变）
        public int CopyCount;         // 个人复制次数（个人频率信号）
        public DateTime LastUsedAt;   // 最近一次复制
        public DateTime CreatedAt;
        public DateTime UpdatedAt;

        public static CommandCard CreateCommand(string title, string body, string product, string source, string extraAliases)
        {
            DateTime now = DateTime.Now;
            string kind = CommandCard.KindCommand;
            string tagTokens = "";
            CommandClassifier.ClassifyCommand(body, out kind, out tagTokens);
            return new CommandCard
            {
                Id = Guid.NewGuid().ToString("N"),
                Product = product,
                Title = title,
                Aliases = JoinTokens(extraAliases, FirstToken(body)),
                Kind = kind,
                Body = body,
                Desc = CommandClassifier.Describe(body, kind),
                Tags = JoinTokens(tagTokens, CommandClassifier.Domain(body)),
                Source = source,
                Risk = "low",
                Purpose = "",
                RiskScope = "",
                RiskMutation = "",
                RiskRevert = "unknown",
                RiskLabeled = false,
                IsFavorite = false,
                Heat = 0,
                CopyCount = 0,
                LastUsedAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };
        }

        public static CommandCard CreateKnowledge(string title, string body, string kind, string product, string source)
        {
            DateTime now = DateTime.Now;
            return new CommandCard
            {
                Id = Guid.NewGuid().ToString("N"),
                Product = product,
                Title = title,
                Aliases = "",
                Kind = kind,
                Body = body,
                Desc = "",
                Tags = kind,
                Source = source,
                Risk = kind == KindWarning ? "medium" : "low",
                Purpose = "",
                RiskScope = "",
                RiskMutation = "",
                RiskRevert = "unknown",
                RiskLabeled = false,
                IsFavorite = false,
                Heat = 0,
                CopyCount = 0,
                LastUsedAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };
        }

        public string KindLabel()
        {
            return KindLabelFor(Kind);
        }

        public static string KindLabelFor(string kind)
        {
            if (kind == KindPrompt) return "提示词";
            if (kind == KindStep) return "步骤";
            if (kind == KindPoint) return "要点";
            if (kind == KindWarning) return "警告";
            if (kind == KindGuide) return "攻略";
            if (kind == KindData) return "数据";
            if (kind == KindDoc) return "文档";
            return "命令";
        }

        public static string KindFromChinese(string value)
        {
            if (value == "提示词") return KindPrompt;
            if (value == "步骤") return KindStep;
            if (value == "要点") return KindPoint;
            if (value == "警告") return KindWarning;
            if (value == "攻略") return KindGuide;
            if (value == "数据") return KindData;
            if (value == "文档") return KindDoc;
            return KindCommand;
        }

        public Color DisplayColor()
        {
            if (Kind == KindDoc) return Ui.Primary;
            if (Kind == KindStep) return Color.FromArgb(79, 70, 229);
            if (Kind == KindPoint) return Ui.Ink;
            if (Kind == KindWarning) return Color.FromArgb(180, 83, 9);
            if (Kind == KindData) return Color.FromArgb(37, 99, 235);
            if (Kind == KindGuide) return Color.FromArgb(147, 51, 234);
            return CommandPocketNative.Risk.Color(Risk);
        }

        public static int RecScore(CommandCard card, DateTime now)
        {
            // 首屏推荐：收藏 > 个人近期复制频率 > 主流热度(Heat seed)
            int score = card.IsFavorite ? 5 : 0;
            if (card.CopyCount > 0)
            {
                int days = Math.Max(0, (int)(now - card.LastUsedAt).TotalDays);
                if (days < 30)
                    score += Math.Min(3, card.CopyCount);
                else if (days < 90)
                    score += 1;
            }
            score += Math.Min(Math.Max(card.Heat, 0), 5);
            return score;
        }

        public static string JoinTokens(params string[] values)
        {
            Dictionary<string, bool> seen = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            List<string> parts = new List<string>();
            for (int i = 0; i < values.Length; i++)
            {
                if (String.IsNullOrWhiteSpace(values[i]))
                    continue;
                string[] tokens = values[i].Split(new char[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries);
                for (int j = 0; j < tokens.Length; j++)
                {
                    string token = tokens[j].Trim();
                    if (token.Length == 0 || seen.ContainsKey(token))
                        continue;
                    seen[token] = true;
                    parts.Add(token);
                }
            }
            return String.Join(", ", parts.ToArray());
        }

        public string[] AliasArray()
        {
            return SplitTokens(Aliases);
        }

        public string[] TagArray()
        {
            return SplitTokens(Tags);
        }

        public static string[] SplitTokens(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
                return new string[0];
            string[] raw = value.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> result = new List<string>();
            for (int i = 0; i < raw.Length; i++)
            {
                string token = raw[i].Trim();
                if (token.Length > 0)
                    result.Add(token);
            }
            return result.ToArray();
        }

        private static string FirstToken(string body)
        {
            string[] parts = body.Trim().Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            return parts.Length == 0 ? "" : parts[0];
        }
    }

    internal static class Ui
    {
        public static readonly Color CommandBack = Color.FromArgb(15, 23, 32);
        public static readonly Color CommandChrome = Color.FromArgb(11, 17, 24);
        public static readonly Color CommandInput = Color.FromArgb(21, 31, 42);
        public static readonly Color CommandSelected = Color.FromArgb(24, 47, 61);
        public static readonly Color CommandInk = Color.FromArgb(232, 240, 246);
        public static readonly Color CommandMuted = Color.FromArgb(127, 146, 160);
        public static readonly Color CommandAccent = Color.FromArgb(45, 212, 191);
        public static readonly Color CommandDanger = Color.FromArgb(251, 113, 133);
        public static readonly Color CommandBorder = Color.FromArgb(42, 61, 74);
        public static readonly Color CommandDivider = Color.FromArgb(27, 39, 50);

        public static readonly Color Paper = CommandBack;
        public static readonly Color PaperTop = CommandChrome;
        public static readonly Color Surface = Color.FromArgb(255, 255, 255);
        public static readonly Color AppBack = Color.FromArgb(246, 248, 250);
        public static readonly Color PanelBack = Color.FromArgb(241, 245, 249);
        public static readonly Color InputBack = Color.FromArgb(255, 255, 255);
        public static readonly Color Ink = Color.FromArgb(15, 23, 42);
        public static readonly Color Muted = Color.FromArgb(100, 116, 139);
        public static readonly Color Primary = Color.FromArgb(13, 148, 136);
        public static readonly Color Danger = Color.FromArgb(190, 18, 60);
        public static readonly Color Border = Color.FromArgb(226, 232, 240);
        public static readonly Color PaperBorder = CommandBorder;
        public static readonly Color HandleDot = CommandAccent;
        public static readonly Color SelectedPaper = Color.FromArgb(224, 242, 254);
        public static readonly Color SelectedBorder = Color.FromArgb(14, 165, 233);
        public static readonly Color RowDivider = Color.FromArgb(226, 232, 240);

        public static readonly Font BodyFont = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        public static readonly Font SmallFont = new Font("Segoe UI", 8.7f, FontStyle.Regular);
        public static readonly Font SectionFont = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        public static readonly Font TitleFont = new Font("Segoe UI", 11f, FontStyle.Bold);
        public static readonly Font SearchFont = new Font("Segoe UI", 12f, FontStyle.Regular);
        public static readonly Font AnswerFont = new Font("Segoe UI", 10.2f, FontStyle.Regular);
        public static readonly Font QuestionFont = new Font("Segoe UI", 14f, FontStyle.Bold);
        public static readonly Font MonoFont = new Font("Consolas", 10f, FontStyle.Regular);

        public static void StylePrimaryButton(Button button, int width)
        {
            StyleButton(button, width, Primary, Color.White);
        }

        public static void StyleSecondaryButton(Button button, int width)
        {
            StyleButton(button, width, Surface, Ink);
        }

        public static void StyleDangerButton(Button button, int width)
        {
            StyleButton(button, width, Danger, Color.White);
        }

        private static void StyleButton(Button button, int width, Color back, Color fore)
        {
            button.Width = width;
            button.Height = 34;
            button.Margin = new Padding(5, 0, 0, 0);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = back == Primary ? Primary : Border;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.MouseOverBackColor = back == Primary ? Color.FromArgb(15, 118, 110) : Color.FromArgb(248, 250, 252);
            button.FlatAppearance.MouseDownBackColor = back == Primary ? Color.FromArgb(17, 94, 89) : Color.FromArgb(241, 245, 249);
            button.BackColor = back;
            button.ForeColor = fore;
            button.Font = SmallFont;
            button.UseVisualStyleBackColor = false;
        }
    }

    internal static class TextCleaner
    {
        public static string FromHtml(string html)
        {
            if (String.IsNullOrEmpty(html))
                return "";

            string focusedHtml = FocusArticle(html);
            string text = Regex.Replace(focusedHtml, "<script[\\s\\S]*?</script>", " ", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "<style[\\s\\S]*?</style>", " ", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "<noscript[\\s\\S]*?</noscript>", " ", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "<br\\s*/?>", "\n", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "</(p|li|h[1-6]|div|section|article|pre|blockquote|tr)\\s*>", "\n", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "<[^>]+>", " ");
            text = WebUtility.HtmlDecode(text);
            text = Regex.Replace(text, "[ \\t]+", " ");
            text = Regex.Replace(text, "\\n\\s+", "\n");
            text = Regex.Replace(text, "\\n{3,}", "\n\n");
            return text.Trim();
        }

        private static string FocusArticle(string html)
        {
            Match intro = Regex.Match(html, "<div\\b[^>]*class\\s*=\\s*[\"'][^\"']*\\barticle-intro\\b[^\"']*[\"'][^>]*>", RegexOptions.IgnoreCase);
            if (intro.Success)
                return html.Substring(intro.Index);

            Match article = Regex.Match(html, "<article\\b[\\s\\S]*?</article\\s*>", RegexOptions.IgnoreCase);
            if (article.Success)
                return article.Value;

            MatchCollection headings = Regex.Matches(html, "<h1\\b", RegexOptions.IgnoreCase);
            if (headings.Count > 0)
                return html.Substring(headings[headings.Count - 1].Index);
            return html;
        }
    }

    internal static class ImportDiagnostics
    {
        public static void Log(string message)
        {
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CommandPocketNative");
                if (!Directory.Exists(dir))
                    Directory.CreateDirectory(dir);
                string clean = Regex.Replace(message ?? "", "[\\r\\n]+", " ");
                File.AppendAllText(Path.Combine(dir, "diagnostics.log"), DateTime.Now.ToString("s") + " " + clean + Environment.NewLine, Encoding.UTF8);
            }
            catch
            {
            }
        }
    }

    internal sealed class TimeoutWebClient : WebClient
    {
        protected override WebRequest GetWebRequest(Uri address)
        {
            WebRequest request = base.GetWebRequest(address);
            request.Timeout = 15000;
            HttpWebRequest httpRequest = request as HttpWebRequest;
            if (httpRequest != null)
            {
                httpRequest.ReadWriteTimeout = 15000;
                httpRequest.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            }
            return request;
        }
    }

    internal static class CommandExtractor
    {
        private static readonly string[] Prefixes = new string[]
        {
            "git", "docker", "kubectl", "npm", "pnpm", "yarn", "node", "python", "pip",
            "find", "grep", "awk", "sed", "tar", "curl", "wget", "ffmpeg", "adb",
            "vim", "nvim", "chmod", "chown", "rm", "mv", "cp", "du", "df", "lsof",
            "netstat", "ss", "mysql", "psql", "sqlite3", "sudo", "ssh", "scp", "rsync",
            "brew", "winget", "choco", "make", "cmake", "cargo", "go", "java", "mvn",
            "gradle", "code", "man", "col", "colrm", "whereis"
        };

        public static List<CommandCard> Extract(string raw, string collection)
        {
            return Extract(raw, collection, "");
        }

        public static List<CommandCard> Extract(string raw, string collection, string sourceReference)
        {
            List<CommandCard> cards = new List<CommandCard>();
            Dictionary<string, bool> seen = new Dictionary<string, bool>();
            string[] lines = raw.Split(new string[] { "\r\n", "\n" }, StringSplitOptions.None);
            string summary = BuildSummary(lines);
            if (summary.Length > 0)
            {
                cards.Add(CommandCard.CreateKnowledge("资料摘要", summary, CommandCard.KindDoc, collection, Source(sourceReference, "自动摘要")));
                seen[summary.ToLowerInvariant()] = true;
            }
            for (int i = 0; i < lines.Length; i++)
            {
                string command = ParseLine(lines[i]);
                string content = command == null ? ParseKnowledgeLine(lines[i]) : command;
                if (content == null)
                    continue;
                string key = content.ToLowerInvariant();
                if (seen.ContainsKey(key))
                    continue;
                seen[key] = true;
                if (command != null)
                {
                    string title = TitleFor(command, i > 0 ? lines[i - 1] : "");
                    cards.Add(CommandCard.CreateCommand(title, command, collection, Source(sourceReference, lines[i].Trim()), ""));
                }
                else
                {
                    string kind = KnowledgeKind(lines[i]);
                    string title = KnowledgeTitle(content, kind);
                    cards.Add(CommandCard.CreateKnowledge(title, content, kind, collection, Source(sourceReference, lines[i].Trim())));
                }
                if (cards.Count >= 120)
                    break;
            }
            return cards;
        }

        private static string Source(string reference, string excerpt)
        {
            string value = (excerpt ?? "").Trim();
            if (value.Length > 160)
                value = value.Substring(0, 160);
            if (String.IsNullOrWhiteSpace(reference))
                return value;
            return reference.Trim() + (value.Length == 0 ? "" : " · " + value);
        }

        private static string BuildSummary(string[] lines)
        {
            List<string> picked = new List<string>();
            for (int i = 0; i < lines.Length && picked.Count < 3; i++)
            {
                if (ParseLine(lines[i]) != null)
                    continue; // 命令行不纳入摘要，避免与命令卡重复
                if (IsWarningText(lines[i]))
                    continue; // 警示行独立成警告卡，不并入摘要
                string clean = CleanKnowledgeText(lines[i]);
                if (IsUsefulKnowledge(clean))
                    picked.Add(clean);
            }
            return String.Join("；", picked.ToArray());
        }

        private static bool IsWarningText(string line)
        {
            string lower = (line ?? "").ToLowerInvariant();
            return lower.Contains("warning") || lower.Contains("danger") || line.Contains("注意") || line.Contains("风险") || line.Contains("不要");
        }

        private static string ParseKnowledgeLine(string line)
        {
            string clean = CleanKnowledgeText(line);
            if (!IsUsefulKnowledge(clean))
                return null;
            return clean;
        }

        private static string CleanKnowledgeText(string line)
        {
            string value = (line ?? "").Trim();
            value = Regex.Replace(value, "^#{1,6}\\s+", "").Trim();
            value = Regex.Replace(value, "^[-*•]\\s+", "").Trim();
            value = Regex.Replace(value, "^\\d+[\\.)、]\\s+", "").Trim();
            value = Regex.Replace(value, "^步骤\\s*\\d*[:：、.]?\\s*", "", RegexOptions.IgnoreCase).Trim();
            return value;
        }

        private static bool IsUsefulKnowledge(string value)
        {
            if (String.IsNullOrEmpty(value))
                return false;
            if (value.Length < 8 || value.Length > 260)
                return false;
            if (Regex.IsMatch(value, "^[\\W_]+$"))
                return false;
            if (value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return false;
            return true;
        }

        private static string KnowledgeKind(string originalLine)
        {
            string line = (originalLine ?? "").Trim();
            string lower = line.ToLowerInvariant();
            if (Regex.IsMatch(line, "^#{1,6}\\s+"))
                return CommandCard.KindDoc;
            if (Regex.IsMatch(line, "^\\d+[\\.)、]\\s+") || lower.StartsWith("step ") || line.StartsWith("步骤"))
                return CommandCard.KindStep;
            if (lower.Contains("warning") || lower.Contains("danger") || line.Contains("注意") || line.Contains("风险") || line.Contains("不要"))
                return CommandCard.KindWarning;
            return CommandCard.KindPoint;
        }

        private static string KnowledgeTitle(string content, string kind)
        {
            if (kind == CommandCard.KindDoc)
                return content.Length > 28 ? content.Substring(0, 28) : content;
            if (kind == CommandCard.KindStep)
                return content.Length > 26 ? "步骤：" + content.Substring(0, 26) : "步骤：" + content;
            if (kind == CommandCard.KindWarning)
                return content.Length > 26 ? "注意：" + content.Substring(0, 26) : "注意：" + content;
            return content.Length > 30 ? content.Substring(0, 30) : content;
        }

        private static string ParseLine(string line)
        {
            string candidate = line.Trim();
            if (candidate.Length == 0)
                return null;
            candidate = Regex.Replace(candidate, "^[-*•\\d\\.)\\s]+", "").Trim();
            candidate = Regex.Replace(candidate, "^(\\$|>|PS>)\\s+", "").Trim();
            if (candidate.StartsWith("`") && candidate.EndsWith("`") && candidate.Length > 2)
                candidate = candidate.Substring(1, candidate.Length - 2);

            string lower = candidate.ToLowerInvariant();
            if (Regex.IsMatch(candidate, "[\\u4e00-\\u9fff]"))
                return null; // 命令行不含中文字符（避免把标题/说明误判为命令）
            for (int i = 0; i < Prefixes.Length; i++)
            {
                if (lower.StartsWith(Prefixes[i] + " "))
                    return candidate;
            }
            if (Regex.IsMatch(candidate, "^(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\\s+", RegexOptions.IgnoreCase))
                return candidate;
            if (Regex.IsMatch(candidate, "^/(gamemode|give|tp|time|weather|effect)\\b", RegexOptions.IgnoreCase))
                return candidate;
            if (Regex.IsMatch(candidate, "^[A-Z0-9]{5,}$") && candidate.Length <= 24)
                return candidate;
            return null;
        }

        private static string TitleFor(string command, string context)
        {
            string lower = command.ToLowerInvariant();
            if (lower.Contains("find"))
                return "查找文件";
            if (lower.Contains("git reset"))
                return "回退 Git 提交或状态";
            if (lower.Contains("docker") && lower.Contains("prune"))
                return "清理 Docker 未使用资源";
            if (lower.Contains("lsof") || lower.Contains("netstat"))
                return "查看端口或网络占用";
            if (lower.Contains("ffmpeg"))
                return "处理媒体文件";
            if (Regex.IsMatch(command, "^[A-Z0-9]{5,}$"))
                return context.Trim().Length > 0 ? context.Trim() : "单机游戏代码";
            return command.Length > 42 ? command.Substring(0, 42) : command;
        }
    }

    internal static class CommandSearch
    {
        // 中英术语词典：查询命中一组中任一 token，卡片命中同组另一 token 即加分（双向检索）
        private static readonly string[][] TermMap = new string[][]
        {
            new string[] { "压缩", "打包", "解压", "tar", "zip", "gzip" },
            new string[] { "端口", "占用", "lsof", "netstat" },
            new string[] { "撤销", "回退", "回滚", "reset", "revert" },
            new string[] { "清理", "prune", "clean" },
            new string[] { "查找", "搜索", "find", "grep", "rg" },
            new string[] { "删除", "移除", "rm", "delete", "del" },
            new string[] { "复制", "拷贝", "cp", "copy" },
            new string[] { "移动", "重命名", "mv", "rename" },
            new string[] { "权限", "chmod", "chown" },
            new string[] { "进程", "ps", "kill", "top", "htop" },
            new string[] { "网络", "curl", "wget", "ping", "ssh" },
            new string[] { "创建目录", "mkdir" },
            new string[] { "日志", "tail", "log" },
            new string[] { "提交", "commit" },
            new string[] { "推送", "拉取", "push", "pull", "fetch" }
        };

        public static List<CommandCard> Search(List<CommandCard> cards, string query, int limit)
        {
            return Search(cards, query, "全部", limit);
        }

        public static List<CommandCard> Search(List<CommandCard> cards, string query, string product, int limit)
        {
            DateTime now = DateTime.Now;
            List<ScoredCard> scored = new List<ScoredCard>();
            string q = Normalize(query);
            for (int i = 0; i < cards.Count; i++)
            {
                CommandCard card = cards[i];
                if (!ProductMatch(card, product))
                    continue;
                int score = Score(card, q);
                if (score > 0 || q.Length == 0)
                    scored.Add(new ScoredCard(card, score));
            }
            scored.Sort(delegate(ScoredCard a, ScoredCard b)
            {
                if (b.Score != a.Score)
                    return b.Score.CompareTo(a.Score);
                int recA = CommandCard.RecScore(a.Card, now);
                int recB = CommandCard.RecScore(b.Card, now);
                if (recB != recA)
                    return recB.CompareTo(recA);
                return b.Card.UpdatedAt.CompareTo(a.Card.UpdatedAt);
            });
            List<CommandCard> result = new List<CommandCard>();
            for (int i = 0; i < scored.Count && i < limit; i++)
                result.Add(scored[i].Card);
            return result;
        }

        private static bool ProductMatch(CommandCard card, string product)
        {
            if (String.IsNullOrEmpty(product) || product == "全部")
                return true;
            return String.Equals(card.Product, product, StringComparison.OrdinalIgnoreCase);
        }

        private static int Score(CommandCard card, string q)
        {
            string pool = SearchPool(card);
            if (q.Length == 0)
                return CommandCard.RecScore(card, DateTime.Now);
            int score = 0;
            if (pool.Contains(q))
                score += 40;
            string[] terms = q.Split(new char[] { ' ', '，', ',', '、' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < terms.Length; i++)
            {
                string term = terms[i];
                if (pool.Contains(term))
                    score += 10;
                if (Normalize(card.Body).Contains(term))
                    score += 12;
                string[] aliases = card.AliasArray();
                for (int j = 0; j < aliases.Length; j++)
                {
                    if (Normalize(aliases[j]) == term || aliases[j] == term)
                        score += 15;
                }
                if (Normalize(card.Purpose).Contains(term))
                    score += 14; // 目的句(原话)命中：权重 ≥ 标题
                if (Normalize(card.Title).Contains(term))
                    score += 12; // 标题单独命中
            }
            for (int i = 0; i < TermMap.Length; i++)
            {
                string[] group = TermMap[i];
                if (!ContainsAny(q, group))
                    continue;
                if (ContainsAny(pool, group))
                    score += 8;
                if (ContainsAny(Normalize(card.Body), group))
                    score += 8; // 命令体含对应命令词（prune/lsof/reset…）再加分
            }
            if (score == 0)
                return 0; // 有输入但未命中：不显示（推荐/收藏只影响命中者排序，不凑数）
            // 命中后的加权：优先可执行/可复制的命令与提示词；资料摘要降权
            if (card.Kind == CommandCard.KindCommand || card.Kind == CommandCard.KindPrompt)
                score += 10;
            else if (card.Kind == CommandCard.KindGuide)
                score += 5;
            else if (card.Kind == CommandCard.KindDoc)
                score -= 8;
            return score;
        }

        private static string SearchPool(CommandCard card)
        {
            return Normalize(card.Title + " " + card.Aliases + " " + card.Body + " " + card.Desc + " " + card.Tags + " " + card.Product + " " + card.Source + " " + card.Purpose);
        }

        private static bool ContainsAny(string text, string[] tokens)
        {
            for (int i = 0; i < tokens.Length; i++)
            {
                if (text.Contains(tokens[i]))
                    return true;
            }
            return false;
        }

        private static string Normalize(string value)
        {
            return (value ?? "").ToLowerInvariant().Trim();
        }

        private sealed class ScoredCard
        {
            public readonly CommandCard Card;
            public readonly int Score;
            public ScoredCard(CommandCard card, int score)
            {
                Card = card;
                Score = score;
            }
        }
    }

    internal static class CommandClassifier
    {
        public static void ClassifyCommand(string body, out string kind, out string tagTokens)
        {
            tagTokens = "";
            if (String.IsNullOrWhiteSpace(body))
            {
                kind = CommandCard.KindCommand;
                return;
            }
            if (Regex.IsMatch(body, "^/\\S+") || Regex.IsMatch(body, "^[A-Z0-9]{5,}$"))
            {
                kind = CommandCard.KindGuide;   // 游戏代码 / 秘籍
                tagTokens = "game, cheat";
                return;
            }
            if (Regex.IsMatch(body, "^(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\\s+", RegexOptions.IgnoreCase))
            {
                kind = CommandCard.KindCommand;
                tagTokens = "sql, database";
                return;
            }
            kind = CommandCard.KindCommand;
        }

        public static string Domain(string body)
        {
            string lower = (body ?? "").Trim().ToLowerInvariant();
            if (lower.StartsWith("git ")) return "git";
            if (lower.StartsWith("docker ") || lower.StartsWith("docker-compose ")) return "docker";
            if (lower.StartsWith("ffmpeg ")) return "media";
            if (lower.StartsWith("adb ")) return "android";
            if (lower.StartsWith("kubectl ")) return "k8s";
            if (lower.StartsWith("npm ") || lower.StartsWith("pnpm ") || lower.StartsWith("yarn ")) return "node";
            if (lower.StartsWith("python ") || lower.StartsWith("pip ")) return "python";
            if (lower.StartsWith("ssh ") || lower.StartsWith("scp ") || lower.StartsWith("rsync ")) return "network";
            if (lower.StartsWith("mysql ") || lower.StartsWith("psql ") || lower.StartsWith("sqlite3 ")) return "sql";
            if (lower.StartsWith("chmod ") || lower.StartsWith("chown ") || lower.StartsWith("rm ") || lower.StartsWith("mv ") || lower.StartsWith("cp ")) return "linux";
            return "";
        }

        public static string Describe(string body, string kind)
        {
            string lower = (body ?? "").ToLowerInvariant();
            if (kind == CommandCard.KindGuide)
                return "游戏控制台代码、快捷键或秘籍速查。";
            if (lower.StartsWith("git "))
                return "Git 工作流命令，适合版本控制场景速查。";
            if (lower.StartsWith("docker "))
                return "Docker 容器或镜像管理命令。";
            if (Regex.IsMatch(body, "^(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\\s+", RegexOptions.IgnoreCase))
                return "数据库操作命令。";
            return "从导入资料中抽取的可复制指令。";
        }
    }

    internal static class DangerGuard
    {
        // 高风险复制确认（粘贴/执行前再看一眼）；high/critical 才拦截
        public static bool ConfirmCopy(IWin32Window owner, CommandCard card)
        {
            if (card.Risk != "high" && card.Risk != "critical")
                return true;
            DialogResult result = MessageBox.Show(owner,
                "这是一条高风险内容，粘贴/执行前请再确认一次：\r\n\r\n" + card.Body +
                "\r\n\r\n是否仍要复制？",
                "Command Pocket · 风险确认",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            return result == DialogResult.Yes;
        }
    }

    internal static class Risk
    {
        public static string Label(string risk)
        {
            if (risk == "critical")
                return "极高";
            if (risk == "high")
                return "高";
            if (risk == "medium")
                return "中";
            return "低";
        }

        public static string FromChinese(string label)
        {
            if (label == "高") return "high";
            if (label == "中") return "medium";
            if (label == "极高") return "critical";
            return "low";
        }

        public static Color Color(string risk)
        {
            if (risk == "critical" || risk == "high")
                return System.Drawing.Color.FromArgb(180, 40, 20);
            if (risk == "medium")
                return System.Drawing.Color.FromArgb(148, 92, 0);
            return System.Drawing.Color.FromArgb(25, 100, 65);
        }
    }

    internal static class SelfTest
    {
        public static int Run()
        {
            try
            {
                return RunCore();
            }
            catch (Exception ex)
            {
                return Fail(ex.Message);
            }
        }

        private static int RunCore()
        {
            // 1) HTML 清洗
            string html = "<html><body><h1>Docker 清理</h1><p>docker system prune -a</p><p>注意：会删除未使用镜像。</p></body></html>";
            string text = TextCleaner.FromHtml(html);
            if (!text.Contains("docker system prune -a"))
                return Fail("html clean failed");

            // 2) 抽取：命令 / 警告 / 摘要 kind 映射
            List<CommandCard> cards = CommandExtractor.Extract(text, "SelfTest", "https://example.test/docker");
            CommandCard pruneCard = cards.Find(delegate(CommandCard card) { return card.Body == "docker system prune -a"; });
            if (pruneCard == null)
                return Fail("command extraction failed");
            if (pruneCard.Kind != CommandCard.KindCommand || pruneCard.Risk != "low")
                return Fail("command default risk should be low: " + pruneCard.Kind + "/" + pruneCard.Risk);
            if (cards.Find(delegate(CommandCard card) { return card.Kind == CommandCard.KindWarning; }) == null)
                return Fail("warning kind missing");
            if (cards.Find(delegate(CommandCard card) { return card.Kind == CommandCard.KindDoc; }) == null)
                return Fail("doc(summary) kind missing");
            if (cards.Find(delegate(CommandCard card) { return card.Body == "docker 清理"; }) != null)
                return Fail("cjk heading mis-parsed as command");
            CommandCard summaryCard = cards.Find(delegate(CommandCard card) { return card.Kind == CommandCard.KindDoc; });
            if (summaryCard != null && (summaryCard.Body.Contains("docker system prune -a") || summaryCard.Body.Contains("注意")))
                return Fail("summary should exclude command/warning lines");
            if (cards.Find(delegate(CommandCard card) { return !card.Source.StartsWith("https://example.test/docker"); }) != null)
                return Fail("source tracking failed");

            // 3) 文章抽取与导航过滤
            StringBuilder runoobFixture = new StringBuilder("<html><body><header><h1>菜鸟教程</h1></header><ul>");
            for (int i = 0; i < 160; i++)
                runoobFixture.Append("<li>导航条目 ").Append(i).Append("</li>");
            runoobFixture.Append("</ul><div class=\"article-intro\"><h1>Linux col命令</h1><p>Linux col命令用于过滤控制字符。</p><pre>col [-bfx][-l&lt;缓冲区列数&gt;]\nman man | col -b &gt; man_help</pre></div><footer><h1>站点导航</h1></footer></body></html>");
            List<CommandCard> runoobCards = CommandExtractor.Extract(TextCleaner.FromHtml(runoobFixture.ToString()), "Linux", "https://www.runoob.com/linux/linux-comm-col.html");
            if (runoobCards.Find(delegate(CommandCard card) { return card.Body.StartsWith("col "); }) == null ||
                runoobCards.Find(delegate(CommandCard card) { return card.Body.StartsWith("man man | col"); }) == null)
                return Fail("runoob article extraction failed");
            if (runoobCards.Find(delegate(CommandCard card) { return card.Body.Contains("导航条目"); }) != null)
                return Fail("runoob navigation filtering failed");

            // 4) 中英双语 / 术语检索 + 产品隔离 + 别名
            List<CommandCard> byChinese = CommandSearch.Search(cards, "清理", "SelfTest", 10);
            if (byChinese.Count == 0 || byChinese[0].Body != "docker system prune -a")
                return Fail("chinese term search failed");
            List<CommandCard> byCommand = CommandSearch.Search(cards, "docker system prune -a", "SelfTest", 10);
            if (byCommand.Count == 0)
                return Fail("command search failed");
            List<CommandCard> wrongProduct = CommandSearch.Search(cards, "清理", "Git", 10);
            if (wrongProduct.Count != 0)
                return Fail("product isolation failed");
            cards.Add(CommandCard.CreateCommand("查看网络连接", "netstat -an", "SelfTest", "t", "端口, 网络, 占用"));
            List<CommandCard> byAlias = CommandSearch.Search(cards, "端口", "SelfTest", 10);
            if (byAlias.Count == 0 || byAlias[0].Body != "netstat -an")
                return Fail("alias search failed");

            // 5) 编辑后重新命中
            CommandCard editable = cards[0];
            editable.Title = "Edited title";
            editable.Body = "git status";
            editable.Kind = CommandCard.KindCommand;
            editable.Desc = CommandClassifier.Describe(editable.Body, editable.Kind);
            if (CommandSearch.Search(cards, "git status", "SelfTest", 10).Count == 0)
                return Fail("edited preview search failed");
            cards[0].IsFavorite = true; // 收藏卡不应泄漏进无命中搜索
            List<CommandCard> noHit = CommandSearch.Search(cards, "完全不存在的词zzz", "SelfTest", 10);
            if (noHit.Count != 0)
                return Fail("no-match search leaked recommendations");
            cards[0].IsFavorite = false;
            List<CommandCard> hitOne = CommandSearch.Search(cards, "netstat", "SelfTest", 10);
            if (hitOne.Count == 0)
                return Fail("exact hit search empty");

            // 6) 存储 roundtrip / 去重 / 复制统计 / 收藏推荐 / 产品名单 / 备份恢复
            string tempDir = Path.Combine(Path.GetTempPath(), "CommandPocketSelfTest-" + Guid.NewGuid().ToString("N"));
            CommandStore store = new CommandStore(tempDir);
            int added = store.AddCards(cards);
            int duplicateAdded = store.AddCards(cards);
            if (added <= 0 || duplicateAdded != 0)
                return Fail("store dedup failed");
            List<CommandCard> loaded = store.LoadCards();
            CommandCard persisted = loaded.Find(delegate(CommandCard card) { return card.Body == "git status"; });
            if (persisted == null || persisted.Title != "Edited title")
                return Fail("store roundtrip failed");
            CommandCard bumpTarget = loaded[0];
            store.BumpCopy(bumpTarget.Id);
            List<CommandCard> afterBump = store.LoadCards();
            CommandCard bumped = afterBump.Find(delegate(CommandCard card) { return card.Id == bumpTarget.Id; });
            if (bumped == null || bumped.CopyCount != 1)
                return Fail("copy bump failed");
            CommandCard favCard = afterBump[afterBump.Count - 1];
            favCard.IsFavorite = true;
            store.UpsertCard(favCard);
            List<CommandCard> recs = CommandSearch.Search(store.LoadCards(), "", "SelfTest", 10);
            if (recs.Count == 0 || recs[0].Id != favCard.Id)
                return Fail("favorite recommendation failed");
            store.SaveProducts(new List<string> { "Linux", "SelfTest", "SelfTest" });
            if (store.LoadProducts().Count != 2)
                return Fail("products persistence failed");
            string exportPath = Path.Combine(tempDir, "backup.jsonl");
            store.ExportCards(exportPath);
            if (!File.Exists(exportPath) || new FileInfo(exportPath).Length == 0)
                return Fail("store export failed");
            string restoreDir = Path.Combine(tempDir, "restore");
            CommandStore restoredStore = new CommandStore(restoreDir);
            int restored = restoredStore.ImportCards(exportPath);
            if (restored != store.LoadCards().Count || restoredStore.LoadCards().Count != store.LoadCards().Count)
                return Fail("store restore failed");

            // 7) v1 TSV 自动迁移 + 备份 + 不重复迁移
            string v1Dir = Path.Combine(Path.GetTempPath(), "CommandPocketV1Test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(v1Dir);
            string v1Tsv = Path.Combine(v1Dir, "cards.tsv");
            List<string> v1Lines = new List<string>();
            v1Lines.Add(V1Row("a1", "打包压缩目录", "tar -czf x.tar.gz mydir", "压缩用", "Terminal", "Linux", "速查", "Linux, tar", "low", "All", "Linux", "https://x/y", "", false));
            v1Lines.Add(V1Row("a2", "撤销提交", "git reset --soft HEAD~1", "回退", "Git", "Git", "撤销", "Git, git", "medium", "All", "Git", "pasted", "", false));
            File.WriteAllLines(v1Tsv, v1Lines.ToArray(), Encoding.UTF8);
            File.WriteAllLines(Path.Combine(v1Dir, "collections.txt"), new string[] { "Linux", "Git" }, Encoding.UTF8);
            CommandStore migratedStore = new CommandStore(v1Dir);
            List<CommandCard> migrated = migratedStore.LoadCards();
            if (migrated.Count != 2)
                return Fail("v1 migration count failed: " + migrated.Count);
            CommandCard migratedTar = migrated.Find(delegate(CommandCard card) { return card.Body == "tar -czf x.tar.gz mydir"; });
            if (migratedTar == null || migratedTar.Product != "Linux" || migratedTar.Kind != CommandCard.KindCommand)
                return Fail("v1 migration mapping failed");
            if (migrated.Find(delegate(CommandCard card) { return card.Risk == "medium"; }) == null)
                return Fail("v1 risk mapping failed");
            if (!File.Exists(Path.Combine(v1Dir, "cards.jsonl")) || Directory.GetFiles(v1Dir, "cards.tsv.v1-backup-*").Length == 0)
                return Fail("v1 migration backup failed");
            CommandStore migratedAgain = new CommandStore(v1Dir);
            if (migratedAgain.LoadCards().Count != 2)
                return Fail("v1 migration re-run failed");
            List<string> migratedProducts = migratedAgain.LoadProducts();
            if (migratedProducts.Count != 2 || migratedProducts[0] != "Linux")
                return Fail("v1 collections migration failed");

            Directory.Delete(tempDir, true);
            Directory.Delete(v1Dir, true);
            Console.WriteLine("Self-test passed.");
            return 0;
        }

        private static string V1Row(string id, string title, string command, string desc, string app, string category, string scenario, string tags, string risk, string platform, string collection, string source, string notes, bool fav)
        {
            long ticks = DateTime.Now.Ticks;
            return String.Join("\t", new string[]
            {
                id, B64(title), B64(command), B64(desc), B64(app), B64(category), B64(scenario),
                B64(tags), risk, B64(platform), B64(collection), B64(source), B64(notes),
                fav ? "1" : "0", ticks.ToString(), ticks.ToString()
            });
        }

        private static string B64(string value)
        {
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? ""));
        }

        private static int Fail(string message)
        {
            Console.Error.WriteLine("Self-test failed: " + message);
            return 1;
        }
    }

    internal sealed class CommandStore
    {
        private const string TimeFormat = "yyyy-MM-dd HH:mm:ss";

        private readonly string dir;
        private readonly string cardsPath;
        private readonly string productsPath;

        public CommandStore() : this(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CommandPocketNative"))
        {
        }

        public CommandStore(string directory)
        {
            dir = directory;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            cardsPath = Path.Combine(dir, "cards.jsonl");
            productsPath = Path.Combine(dir, "profiles.json");
            MigrateV1IfNeeded();
        }

        // ---------- 首次数据 ----------

        public void EnsureSeedData()
        {
            List<string> products = LoadProducts();
            if (products.Count == 0)
            {
                SaveProducts(DefaultProducts());
                products = LoadProducts();
            }
            if (File.Exists(cardsPath))
                return;
            List<CommandCard> cards = new List<CommandCard>();
            cards.Add(SeedCard("Linux", "tar 打包 / 解压", "tar -czf x.tar.gz mydir", CommandCard.KindCommand, "压缩, 打包, 解压, 归档, tar", 4, "low", "把 mydir 压缩成 x.tar.gz；解压用 tar -xzf x.tar.gz"));
            cards.Add(SeedCard("Linux", "查看端口占用", "lsof -i :3000", CommandCard.KindCommand, "端口, 占用, 网络", 3, "low", "查看哪个进程占用了 3000 端口"));
            cards.Add(SeedCard("Git", "撤销上次提交但保留改动", "git reset --soft HEAD~1", CommandCard.KindCommand, "撤销, 回退, 回滚, reset", 3, "medium", "回退最近一次提交，改动保留在工作区"));
            cards.Add(SeedCard("Docker", "清理未使用资源", "docker system prune -a", CommandCard.KindCommand, "清理, 回收, prune", 2, "medium", "删除未使用的镜像、容器、网络（有风险）"));
            cards.Add(SeedCard("Codex", "执行代码库任务", "codex exec \"修复 src 下编译错误并运行测试\"", CommandCard.KindPrompt, "codex, 修复, 重构, 测试", 3, "low", "让 Codex 直接在仓库里执行修复任务；正文可换成任意任务描述"));
            cards.Add(SeedCard("PyAgent", "运行代理整理任务", "pyagent run \"把这段需求整理成实现步骤\"", CommandCard.KindPrompt, "pyagent, 代理, 整理", 2, "low", "把一段原材料交给 PyAgent 整理成结构化结果"));
            cards.Add(SeedCard("Game", "GTA 恢复生命和护甲", "HESOYAM", CommandCard.KindGuide, "GTA, 秘籍, 加血", 2, "low", "单机游戏控制台代码"));
            SaveCards(cards);
        }

        private static CommandCard SeedCard(string product, string title, string body, string kind, string aliases, int heat, string risk, string desc)
        {
            DateTime now = DateTime.Now;
            return new CommandCard
            {
                Id = Guid.NewGuid().ToString("N"),
                Product = product,
                Title = title,
                Aliases = aliases,
                Kind = kind,
                Body = body,
                Desc = desc,
                Tags = CommandCard.JoinTokens(CommandClassifier.Domain(body), kind),
                Source = "预置",
                Risk = risk,
                IsFavorite = false,
                Heat = heat,
                CopyCount = 0,
                LastUsedAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };
        }

        private static List<string> DefaultProducts()
        {
            return new List<string> { "Linux", "Codex", "PyAgent", "Git", "Docker", "Game", "Personal" };
        }

        // ---------- 产品（profiles.json，当前为产品名单） ----------

        public List<string> LoadProducts()
        {
            List<string> result = new List<string>();
            if (File.Exists(productsPath))
            {
                string[] lines = File.ReadAllLines(productsPath, Encoding.UTF8);
                for (int i = 0; i < lines.Length; i++)
                {
                    string[] tokens = lines[i].Split(',');
                    for (int j = 0; j < tokens.Length; j++)
                        AddUnique(result, CleanProductToken(tokens[j]));
                }
            }
            else
            {
                string legacy = Path.Combine(dir, "collections.txt");
                if (File.Exists(legacy))
                {
                    string[] lines = File.ReadAllLines(legacy, Encoding.UTF8);
                    for (int i = 0; i < lines.Length; i++)
                        AddUnique(result, lines[i].Trim());
                }
                if (result.Count == 0)
                    result = DefaultProducts();
                SaveProducts(result);
            }
            if (result.Count == 0)
                result.Add("Personal");
            return result;
        }

        public void SaveProducts(List<string> products)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('[');
            List<string> cleaned = new List<string>();
            for (int i = 0; i < products.Count; i++)
                AddUnique(cleaned, products[i] == null ? "" : products[i].Trim());
            for (int i = 0; i < cleaned.Count; i++)
            {
                if (i > 0)
                    sb.Append(',');
                sb.Append(Esc(cleaned[i]));
            }
            sb.Append(']');
            File.WriteAllText(productsPath, sb.ToString() + Environment.NewLine, Encoding.UTF8);
        }

        private static string CleanProductToken(string value)
        {
            string s = (value ?? "").Trim();
            if (s.Length >= 2 && s[0] == '"' && s[s.Length - 1] == '"')
                s = s.Substring(1, s.Length - 2);
            s = s.Replace(",", "").Trim();
            return s;
        }

        private static void AddUnique(List<string> list, string value)
        {
            string v = (value ?? "").Trim();
            if (v.Length == 0 || v == "[" || v == "]")
                return;
            for (int i = 0; i < list.Count; i++)
            {
                if (String.Equals(list[i], v, StringComparison.OrdinalIgnoreCase))
                    return;
            }
            list.Add(v);
        }

        // ---------- 卡片（cards.jsonl） ----------

        public List<CommandCard> LoadCards()
        {
            List<CommandCard> cards = new List<CommandCard>();
            if (!File.Exists(cardsPath))
                return cards;
            string[] lines = File.ReadAllLines(cardsPath, Encoding.UTF8);
            for (int i = 0; i < lines.Length; i++)
            {
                CommandCard card = ReadCard(lines[i]);
                if (card != null)
                    cards.Add(card);
            }
            return cards;
        }

        public int AddCards(List<CommandCard> cards)
        {
            List<CommandCard> all = LoadCards();
            Dictionary<string, bool> seen = new Dictionary<string, bool>();
            for (int i = 0; i < all.Count; i++)
                seen[DedupKey(all[i])] = true;
            int added = 0;
            for (int i = 0; i < cards.Count; i++)
            {
                string key = DedupKey(cards[i]);
                if (seen.ContainsKey(key))
                    continue;
                seen[key] = true;
                all.Add(cards[i]);
                added++;
            }
            if (added > 0)
                SaveCards(all);
            return added;
        }

        public void UpsertCard(CommandCard card)
        {
            List<CommandCard> all = LoadCards();
            bool found = false;
            for (int i = 0; i < all.Count; i++)
            {
                if (all[i].Id == card.Id)
                {
                    all[i] = card;
                    found = true;
                    break;
                }
            }
            if (!found)
                all.Add(card);
            SaveCards(all);
        }

        public void DeleteCard(string id)
        {
            List<CommandCard> all = LoadCards();
            int before = all.Count;
            all.RemoveAll(delegate(CommandCard card) { return card.Id == id; });
            if (all.Count != before)
                SaveCards(all);
        }

        public void BumpCopy(string id)
        {
            List<CommandCard> all = LoadCards();
            bool changed = false;
            for (int i = 0; i < all.Count; i++)
            {
                if (all[i].Id == id)
                {
                    all[i].CopyCount++;
                    all[i].LastUsedAt = DateTime.Now;
                    all[i].UpdatedAt = DateTime.Now;
                    changed = true;
                    break;
                }
            }
            if (changed)
                SaveCards(all);
        }

        public void ExportCards(string destinationPath)
        {
            if (!File.Exists(cardsPath))
                SaveCards(new List<CommandCard>());
            File.Copy(cardsPath, destinationPath, true);
        }

        public int ImportCards(string sourcePath)
        {
            if (!File.Exists(sourcePath))
                throw new FileNotFoundException("找不到备份文件。", sourcePath);
            string[] lines = File.ReadAllLines(sourcePath, Encoding.UTF8);
            List<CommandCard> cards = new List<CommandCard>();
            for (int i = 0; i < lines.Length; i++)
            {
                if (String.IsNullOrWhiteSpace(lines[i]))
                    continue;
                CommandCard card = ReadCard(lines[i]);
                if (card == null)
                    throw new InvalidDataException("备份格式无效，第 " + (i + 1) + " 行无法读取。");
                cards.Add(card);
            }
            return AddCards(cards);
        }

        private void SaveCards(List<CommandCard> cards)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < cards.Count; i++)
                sb.Append(WriteCard(cards[i])).Append(Environment.NewLine);
            string tempPath = cardsPath + ".tmp";
            File.WriteAllText(tempPath, sb.ToString(), Encoding.UTF8);
            if (File.Exists(cardsPath))
                File.Replace(tempPath, cardsPath, cardsPath + ".bak", true);
            else
                File.Move(tempPath, cardsPath);
        }

        private static string DedupKey(CommandCard card)
        {
            return ((card.Body ?? "") + "|" + (card.Product ?? "")).Trim().ToLowerInvariant();
        }

        // ---------- v1 迁移 ----------

        private void MigrateV1IfNeeded()
        {
            if (File.Exists(cardsPath))
                return;
            string legacyTsv = Path.Combine(dir, "cards.tsv");
            if (!File.Exists(legacyTsv))
                return;
            List<CommandCard> migrated = new List<CommandCard>();
            string[] lines = File.ReadAllLines(legacyTsv, Encoding.UTF8);
            for (int i = 0; i < lines.Length; i++)
            {
                CommandCard card = ParseV1Card(lines[i]);
                if (card != null)
                    migrated.Add(card);
            }
            SaveCards(migrated);
            string backup = Path.Combine(dir, "cards.tsv.v1-backup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            File.Move(legacyTsv, backup);
            ImportDiagnostics.Log("MIGRATE v1 cards=" + migrated.Count + " backup=" + backup);
        }

        private static CommandCard ParseV1Card(string line)
        {
            string[] p = line.Split('\t');
            if (p.Length < 16)
                return null;
            try
            {
                string command = UnB64(p[2]);
                string category = UnB64(p[5]);
                string collection = UnB64(p[10]);
                DateTime updated = new DateTime(Int64.Parse(p[15]));
                return new CommandCard
                {
                    Id = p[0],
                    Title = UnB64(p[1]),
                    Aliases = "",
                    Kind = V1Kind(category),
                    Body = command,
                    Desc = UnB64(p[3]),
                    Tags = CommandCard.JoinTokens(UnB64(p[7]), CommandClassifier.Domain(command)),
                    Source = UnB64(p[11]),
                    Risk = p[8],
                    Product = collection.Length == 0 ? "Personal" : collection,
                    IsFavorite = p[13] == "1",
                    Heat = 0,
                    CopyCount = 0,
                    LastUsedAt = updated,
                    CreatedAt = new DateTime(Int64.Parse(p[14])),
                    UpdatedAt = updated
                };
            }
            catch
            {
                return null;
            }
        }

        private static string V1Kind(string category)
        {
            if (category == "Summary") return CommandCard.KindDoc;
            if (category == "Step") return CommandCard.KindStep;
            if (category == "Point") return CommandCard.KindPoint;
            if (category == "Warning") return CommandCard.KindWarning;
            if (category == "Game") return CommandCard.KindGuide;
            return CommandCard.KindCommand;
        }

        private static string B64(string value)
        {
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? ""));
        }

        private static string UnB64(string value)
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(value));
        }

        // ---------- JSON ----------

        private static string WriteCard(CommandCard c)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('{');
            Field(sb, "id", c.Id);
            Field(sb, "product", c.Product);
            Field(sb, "title", c.Title);
            Field(sb, "aliases", c.Aliases);
            Field(sb, "kind", c.Kind);
            Field(sb, "body", c.Body);
            Field(sb, "desc", c.Desc);
            Field(sb, "tags", c.Tags);
            Field(sb, "source", c.Source);
            Field(sb, "risk", c.Risk);
            Field(sb, "purpose", c.Purpose);
            Field(sb, "rs", c.RiskScope);
            Field(sb, "rm", c.RiskMutation);
            Field(sb, "rr", c.RiskRevert);
            sb.Append(",\"fav\":").Append(c.IsFavorite ? "true" : "false").Append(',');
            sb.Append("\"rlabeled\":").Append(c.RiskLabeled ? "true" : "false").Append(',');
            sb.Append("\"heat\":").Append(c.Heat).Append(',');
            sb.Append("\"copies\":").Append(c.CopyCount).Append(',');
            Field(sb, "used", c.LastUsedAt.ToString(TimeFormat, System.Globalization.CultureInfo.InvariantCulture));
            Field(sb, "created", c.CreatedAt.ToString(TimeFormat, System.Globalization.CultureInfo.InvariantCulture));
            Field(sb, "updated", c.UpdatedAt.ToString(TimeFormat, System.Globalization.CultureInfo.InvariantCulture));
            if (sb[sb.Length - 1] == ',')
                sb.Length--;
            sb.Append('}');
            return sb.ToString();
        }

        private static void Field(StringBuilder sb, string key, string value)
        {
            if (sb[sb.Length - 1] != '{' && sb[sb.Length - 1] != ',')
                sb.Append(',');
            sb.Append('\"').Append(key).Append("\":").Append(Esc(value));
        }

        private static string Esc(string value)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('\"');
            string s = value ?? "";
            for (int i = 0; i < s.Length; i++)
            {
                char ch = s[i];
                if (ch == '\\') sb.Append("\\\\");
                else if (ch == '\"') sb.Append("\\\"");
                else if (ch == '\n') sb.Append("\\n");
                else if (ch == '\r') sb.Append("\\r");
                else if (ch == '\t') sb.Append("\\t");
                else if (ch < ' ')
                    sb.Append("\\u").Append(((int)ch).ToString("x4"));
                else
                    sb.Append(ch);
            }
            sb.Append('\"');
            return sb.ToString();
        }

        private static CommandCard ReadCard(string line)
        {
            if (String.IsNullOrWhiteSpace(line) || line[0] != '{')
                return null;
            try
            {
                CommandCard c = new CommandCard();
                int pos = 1;
                while (pos < line.Length)
                {
                    SkipWs(line, ref pos);
                    if (pos >= line.Length || line[pos] == '}')
                        break;
                    string key = ReadJsonString(line, ref pos);
                    SkipWs(line, ref pos);
                    if (pos >= line.Length || line[pos] != ':')
                        return null;
                    pos++;
                    SkipWs(line, ref pos);
                    if (pos >= line.Length)
                        return null;
                    char ch = line[pos];
                    string value = "";
                    if (ch == '\"')
                        value = ReadJsonString(line, ref pos);
                    if (key == "id") c.Id = value;
                    else if (key == "product") c.Product = value;
                    else if (key == "title") c.Title = value;
                    else if (key == "aliases") c.Aliases = value;
                    else if (key == "kind") c.Kind = value;
                    else if (key == "body") c.Body = value;
                    else if (key == "desc") c.Desc = value;
                    else if (key == "tags") c.Tags = value;
                    else if (key == "source") c.Source = value;
                    else if (key == "risk") c.Risk = value;
                    else if (key == "purpose") c.Purpose = value;
                    else if (key == "rs") c.RiskScope = value;
                    else if (key == "rm") c.RiskMutation = value;
                    else if (key == "rr") c.RiskRevert = value;
                    else if (key == "rlabeled")
                    {
                        c.RiskLabeled = StartsWith(line, pos, "true");
                        pos += c.RiskLabeled ? 4 : 5;
                    }
                    else if (key == "fav")
                    {
                        c.IsFavorite = StartsWith(line, pos, "true");
                        pos += c.IsFavorite ? 4 : 5;
                    }
                    else if (key == "heat") c.Heat = ReadInt(line, ref pos);
                    else if (key == "copies") c.CopyCount = ReadInt(line, ref pos);
                    else if (key == "used") c.LastUsedAt = ParseTime(value);
                    else if (key == "created") c.CreatedAt = ParseTime(value);
                    else if (key == "updated") c.UpdatedAt = ParseTime(value);
                    else
                    {
                        // 未知 key：宽容跳过（字符串值消费整串；裸值跳到分隔符）
                        if (ch == '"')
                            ReadJsonString(line, ref pos);
                        else
                            SkipRawValue(line, ref pos);
                    }
                    SkipWs(line, ref pos);
                    if (pos < line.Length && line[pos] == ',')
                        pos++;
                }
                if (c.Id == null || c.Body == null)
                    return null;
                if (c.Product == null) c.Product = "Personal";
                if (c.Kind == null) c.Kind = CommandCard.KindCommand;
                if (c.Risk == null) c.Risk = "low";
                if (c.Purpose == null) c.Purpose = "";
                if (c.RiskScope == null) c.RiskScope = "";
                if (c.RiskMutation == null) c.RiskMutation = "";
                if (c.RiskRevert == null || c.RiskRevert == "") c.RiskRevert = "unknown";
                if (c.LastUsedAt == DateTime.MinValue) c.LastUsedAt = c.UpdatedAt;
                if (c.CreatedAt == DateTime.MinValue) c.CreatedAt = DateTime.Now;
                if (c.UpdatedAt == DateTime.MinValue) c.UpdatedAt = DateTime.Now;
                return c;
            }
            catch
            {
                return null;
            }
        }

        private static DateTime ParseTime(string value)
        {
            DateTime result;
            if (DateTime.TryParseExact(value, TimeFormat, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out result))
                return result;
            return DateTime.MinValue;
        }

        private static void SkipRawValue(string line, ref int pos)
        {
            while (pos < line.Length && line[pos] != ',' && line[pos] != '}')
                pos++;
        }

        private static void SkipWs(string line, ref int pos)
        {
            while (pos < line.Length && (line[pos] == ' ' || line[pos] == '\t'))
                pos++;
        }

        private static string ReadJsonString(string line, ref int pos)
        {
            if (line[pos] != '\"')
                return "";
            pos++;
            StringBuilder sb = new StringBuilder();
            while (pos < line.Length)
            {
                char ch = line[pos];
                if (ch == '\\')
                {
                    pos++;
                    if (pos >= line.Length)
                        break;
                    char esc = line[pos];
                    if (esc == 'n') sb.Append('\n');
                    else if (esc == 'r') sb.Append('\r');
                    else if (esc == 't') sb.Append('\t');
                    else if (esc == 'u')
                    {
                        if (pos + 4 < line.Length)
                        {
                            string hex = line.Substring(pos + 1, 4);
                            sb.Append((char)Convert.ToInt32(hex, 16));
                            pos += 4;
                        }
                    }
                    else
                        sb.Append(esc);
                }
                else if (ch == '\"')
                {
                    pos++;
                    return sb.ToString();
                }
                else
                    sb.Append(ch);
                pos++;
            }
            return sb.ToString();
        }

        private static int ReadInt(string line, ref int pos)
        {
            int sign = 1;
            int value = 0;
            if (pos < line.Length && line[pos] == '-')
            {
                sign = -1;
                pos++;
            }
            while (pos < line.Length && line[pos] >= '0' && line[pos] <= '9')
            {
                value = value * 10 + (line[pos] - '0');
                pos++;
            }
            return value * sign;
        }

        private static bool StartsWith(string line, int pos, string token)
        {
            if (pos + token.Length > line.Length)
                return false;
            for (int i = 0; i < token.Length; i++)
            {
                if (line[pos + i] != token[i])
                    return false;
            }
            return true;
        }
    }
}
