// Command Pocket v5-pilot · 行为记忆"再来一次"
// 试点最小单文件：托盘 + Ctrl+Alt+P 小窗 → "再来一次"列表(排序) → Enter=复制走人。
// 铁律：零网络 / 零监听 / 零键盘钩子；剪贴板仅在热键唤起时读一次(可关)；数据纯本地 jsonl。
// 兼容旧库：cards.jsonl 宽容读写（缺字段默认值、未知 key 跳过）；v1 TSV 迁移逻辑不复用（旧库已是 jsonl）。
// 纯 csc 编译（Framework v4.0.30319 csc），无第三方依赖，C#5 兼容语法。

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace CommandPocketPilot
{
    internal static class Program
    {
        public const string VersionLabel = "v5-pilot";

        [STAThread]
        private static void Main(string[] args)
        {
            // 自测优先：build.ps1 在托盘可能已运行时也会调 --self-test，不能被单实例 Mutex 挡住
            if (args != null && args.Length > 0 && args[0] == "--self-test")
            {
                Environment.Exit(SelfTest.Run());
                return;
            }
            // 单实例：双开会并发写同一 jsonl 丢更新
            bool createdNew;
            using (Mutex single = new Mutex(true, "CommandPocketPilot_SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show("Command Pocket 已在运行，请从托盘图标唤出。",
                        "Command Pocket", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new PilotAppContext());
            }
        }
    }

    // ============================================================ 模型
    internal sealed class Card
    {
        public const string KindCommand = "command";

        public string Id;
        public string Product;      // 归属（旧字段保留，v5 不强调分组）
        public string Title;
        public string Aliases;
        public string Kind;
        public string Body;         // 命令（唯一实质内容）
        public string Desc;         // 说明
        public string Tags;
        public string Source;       // 来源：history/clipboard/manual
        public string Risk;         // low|high|critical（自动只判 high；critical 留给人工）
        public string Purpose;      // 一句人话（可选）
        public string RiskScope;    // 动什么
        public string RiskMutation; // 改删什么
        public string RiskRevert;   // 能否还原 yes|no|unknown
        public bool RiskLabeled;
        public bool IsFavorite;
        public int Heat;
        public int CopyCount;
        public DateTime LastUsedAt;
        public DateTime CreatedAt;
        public DateTime UpdatedAt;
    }

    internal static class Cards
    {
        // markUsed=false（历史导入/收录）：不伪造“用过”时间，排到真实使用之后，防止旧命令标“上次:今天”挤占首屏
        public static Card New(string body, string source, bool markUsed)
        {
            DateTime now = DateTime.Now;
            Card c = new Card();
            c.Id = Guid.NewGuid().ToString("N");
            c.Product = "Personal";
            c.Title = Truncate(body, 60);
            c.Aliases = "";
            c.Kind = Card.KindCommand;
            c.Body = body;
            c.Desc = "";
            c.Tags = "";
            c.Source = source;
            c.Risk = Rules.GuessRisk(body);
            c.Purpose = "";
            c.RiskScope = "";
            c.RiskMutation = "";
            c.RiskRevert = "unknown";
            c.RiskLabeled = false;
            c.IsFavorite = false;
            c.Heat = 0;
            c.CopyCount = 0;
            c.LastUsedAt = markUsed ? now : DateTime.MinValue;
            c.CreatedAt = now;
            c.UpdatedAt = now;
            return c;
        }

        public static bool IsDanger(Card c)
        {
            // 危险门实时判定：存储 risk 或现行规则命中任一即拦（防旧库缺省 risk=low 的旧危险命令绕过）
            if (c == null) return false;
            if (c.Risk == "high" || c.Risk == "critical") return true;
            return Rules.GuessRisk(c.Body) != "low";
        }

        public static string Truncate(string s, int max)
        {
            if (s == null) return "";
            if (s.Length <= max) return s;
            return s.Substring(0, max) + "…";
        }
    }

    // ============================================================ 规则（纯逻辑，SelfTest 与 Node 对拍共用口径）
    internal static class Rules
    {
        // 危险自动判红：只判 high（不可逆破坏/改写共享历史），从不判绿。
        // 窄表优先：宁可漏，不可误伤（确认疲劳 = 狼来了）。
        public static string GuessRisk(string body)
        {
            if (body == null) return "low";
            string t = body.Trim();
            if (t.Length == 0) return "low";
            string lower = t.ToLowerInvariant();
            bool high =
                ContainsAny(lower, new string[] {
                    "rm -rf", "rm -r", "rm -fr", "rm -f -r",
                    "remove-item -recurse", "remove-item -r",
                    "format c:", "format d:", "format /fs",
                    "format-volume",
                    "diskpart",
                    "dd if=",
                    "git push -f", "git push --force", "git push --force-with-lease",
                    "drop table", "drop database", "truncate table", "truncate database",
                    "rd /s", "del /s /q",
                    "reset --hard" });
            return high ? "high" : "low";
        }

        private static bool ContainsAny(string lower, string[] needles)
        {
            for (int i = 0; i < needles.Length; i++)
                if (lower.Contains(needles[i]))
                    return true;
            return false;
        }

        // 导入/预填时剔除敏感行（口令/token/私钥）——整行剔除，不落库。
        public static bool IsSensitive(string line)
        {
            if (line == null) return false;
            string lower = line.ToLowerInvariant();
            string[] markers = new string[] {
                "password", "passwd", "pwd=", "token", "secret",
                "api_key", "apikey", "authorization:", "bearer ",
                "private key", "id_rsa", "aws_access", "client_secret", "connectionstring" };
            for (int i = 0; i < markers.Length; i++)
                if (lower.Contains(markers[i]))
                    return true;
            return false;
        }

        // 剪贴板预填形状判定：保守，宁缺毋滥（避免骚扰）。
        public static bool IsCommandish(string text)
        {
            if (text == null) return false;
            string t = text.Trim();
            if (t.Length == 0 || t.Length > 800) return false;
            int newlines = 0;
            for (int i = 0; i < t.Length; i++)
                if (t[i] == '\n') newlines++;
            if (newlines > 6) return false;
            // 以中文句读结尾的整句自然语言 → 不算命令
            string trimmed = t.TrimEnd();
            char last = trimmed[trimmed.Length - 1];
            if (last == '。' || last == '？' || last == '！' || last == '，')
                return false;
            // 单行中文长句（无空格无分隔符）→ 不算命令
            bool hasSpace = t.IndexOf(' ') >= 0 || t.IndexOf('\t') >= 0 || t.IndexOf('=') >= 0;
            if (!hasSpace && ContainsCjk(t) && t.Length > 12)
                return false;
            return true;
        }

        private static bool ContainsCjk(string s)
        {
            for (int i = 0; i < s.Length; i++)
            {
                char ch = s[i];
                if (ch >= 0x4E00 && ch <= 0x9FFF)
                    return true;
            }
            return false;
        }

        // "再来一次"排序：最近干成过(lastUsedAt) 为主；未用过按创建时间；再并列看更新/复制次数；最后按标题（保证稳定）
        public static int CompareRecent(Card a, Card b)
        {
            DateTime ta = a.LastUsedAt == DateTime.MinValue ? a.CreatedAt : a.LastUsedAt;
            DateTime tb = b.LastUsedAt == DateTime.MinValue ? b.CreatedAt : b.LastUsedAt;
            int byTime = DateTime.Compare(tb, ta); // 新者在前
            if (byTime != 0) return byTime;
            int byCopies = b.CopyCount.CompareTo(a.CopyCount);
            if (byCopies != 0) return byCopies;
            int byUpdated = DateTime.Compare(b.UpdatedAt, a.UpdatedAt);
            if (byUpdated != 0) return byUpdated;
            return string.Compare(a.Title, b.Title, StringComparison.Ordinal);
        }

        public static bool BodyEquals(string x, string y)
        {
            return (x == null ? "" : x.Trim()).Equals(y == null ? "" : y.Trim(), StringComparison.OrdinalIgnoreCase);
        }
    }

    // ============================================================ jsonl 宽容读写（与旧库格式一致）
    internal static class Json
    {
        public const string TimeFormat = "yyyy-MM-dd HH:mm:ss";

        public static string WriteCard(Card c)
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
            sb.Append('"').Append(key).Append("\":").Append(Esc(value));
        }

        private static string Esc(string value)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            string s = value ?? "";
            for (int i = 0; i < s.Length; i++)
            {
                char ch = s[i];
                if (ch == '\\') sb.Append("\\\\");
                else if (ch == '"') sb.Append("\\\"");
                else if (ch == '\n') sb.Append("\\n");
                else if (ch == '\r') sb.Append("\\r");
                else if (ch == '\t') sb.Append("\\t");
                else if (ch < ' ')
                    sb.Append("\\u").Append(((int)ch).ToString("x4"));
                else
                    sb.Append(ch);
            }
            sb.Append('"');
            return sb.ToString();
        }

        // 宽容读：未知 key 跳过；缺字段补默认。返回 null 表示本行不是合法卡。
        public static Card ReadCard(string line)
        {
            if (String.IsNullOrWhiteSpace(line) || line[0] != '{')
                return null;
            try
            {
                Card c = new Card();
                int pos = 1;
                while (pos < line.Length)
                {
                    SkipWs(line, ref pos);
                    if (pos >= line.Length || line[pos] == '}')
                        break;
                    string key = ReadJsonString(line, ref pos);
                    SkipWs(line, ref pos);
                    if (pos >= line.Length || line[pos] != ':') return null;
                    pos++;
                    SkipWs(line, ref pos);
                    if (pos >= line.Length) return null;
                    char ch = line[pos];
                    string value = "";
                    if (ch == '"')
                        value = ReadJsonString(line, ref pos);
                    Assign(c, key, ch, value, line, ref pos);
                    SkipWs(line, ref pos);
                    if (pos < line.Length && line[pos] == ',')
                        pos++;
                }
                if (c.Id == null || c.Body == null) return null;
                if (c.Product == null) c.Product = "Personal";
                if (c.Kind == null) c.Kind = Card.KindCommand;
                if (c.Risk == null || c.Risk == "") c.Risk = "low";
                if (c.Purpose == null) c.Purpose = "";
                if (c.RiskScope == null) c.RiskScope = "";
                if (c.RiskMutation == null) c.RiskMutation = "";
                if (c.RiskRevert == null || c.RiskRevert == "") c.RiskRevert = "unknown";
                if (c.CopyCount < 0) c.CopyCount = 0;
                if (c.Heat < 0) c.Heat = 0;
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

        private static void Assign(Card c, string key, char ch, string value, string line, ref int pos)
        {
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
            else if (key == "rlabeled") { c.RiskLabeled = ch == '"' ? value == "true" : ReadTrue(line, ref pos); }
            else if (key == "fav") { c.IsFavorite = ch == '"' ? value == "true" : ReadTrue(line, ref pos); }
            else if (key == "heat") c.Heat = ReadInt(line, ref pos);
            else if (key == "copies") c.CopyCount = ReadInt(line, ref pos);
            else if (key == "used") c.LastUsedAt = ParseTime(value);
            else if (key == "created") c.CreatedAt = ParseTime(value);
            else if (key == "updated") c.UpdatedAt = ParseTime(value);
            else
            {
                // 未知 key：宽容跳过
                if (ch == '"')
                    ReadJsonString(line, ref pos);
                else
                    SkipRawValue(line, ref pos);
            }
        }

        private static bool ReadTrue(string line, ref int pos)
        {
            bool isTrue = StartsWith(line, pos, "true");
            pos += isTrue ? 4 : 5;
            return isTrue;
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
            // 未知 key 的裸值可能含嵌套对象/数组：按深度跳到真正的分隔符/结尾，避免提前截断整行解析
            int depth = 0;
            while (pos < line.Length)
            {
                char ch = line[pos];
                if (ch == '{' || ch == '[') depth++;
                else if (ch == '}' || ch == ']')
                {
                    if (depth == 0) return;
                    depth--;
                }
                else if (ch == ',' && depth == 0)
                    return;
                pos++;
            }
        }

        private static void SkipWs(string line, ref int pos)
        {
            while (pos < line.Length && (line[pos] == ' ' || line[pos] == '\t'))
                pos++;
        }

        private static string ReadJsonString(string line, ref int pos)
        {
            if (line[pos] != '"') return "";
            pos++;
            StringBuilder sb = new StringBuilder();
            while (pos < line.Length)
            {
                char ch = line[pos];
                if (ch == '\\')
                {
                    pos++;
                    if (pos >= line.Length) break;
                    char esc = line[pos];
                    if (esc == 'n') sb.Append('\n');
                    else if (esc == 'r') sb.Append('\r');
                    else if (esc == 't') sb.Append('\t');
                    else if (esc == 'u')
                    {
                        if (pos + 4 < line.Length)
                        {
                            string hex = line.Substring(pos + 1, 4);
                            int code;
                            if (Int32.TryParse(hex, System.Globalization.NumberStyles.HexNumber,
                                System.Globalization.CultureInfo.InvariantCulture, out code))
                                sb.Append((char)code);
                            else
                                sb.Append('?');
                            pos += 4;
                        }
                    }
                    else sb.Append(esc);
                }
                else if (ch == '"')
                {
                    pos++;
                    return sb.ToString();
                }
                else sb.Append(ch);
                pos++;
            }
            return sb.ToString();
        }

        private static int ReadInt(string line, ref int pos)
        {
            int sign = 1;
            int value = 0;
            if (pos < line.Length && line[pos] == '-') { sign = -1; pos++; }
            while (pos < line.Length && line[pos] >= '0' && line[pos] <= '9')
            {
                value = value * 10 + (line[pos] - '0');
                pos++;
            }
            return value * sign;
        }

        private static bool StartsWith(string line, int pos, string token)
        {
            if (pos + token.Length > line.Length) return false;
            for (int i = 0; i < token.Length; i++)
                if (line[pos + i] != token[i])
                    return false;
            return true;
        }
    }

    // ============================================================ 终端历史（只读文件，非监听）
    internal static class History
    {
        public static string DefaultPath()
        {
            // PSReadLine：Windows PowerShell 与 PS7(on Windows) 均写此路径
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Microsoft", "Windows", "PowerShell", "PSReadLine", "ConsoleHost_history.txt");
        }

        // 多源探测：在候选历史源中取“最后写入且非空”者（用户活跃 shell 可能不是 PowerShell → 否则读到陈年文件）
        public static SourceInfo BestSource()
        {
            List<string> candidates = new List<string>();
            candidates.Add(DefaultPath()); // PSReadLine（PS5.1 与 pwsh7-on-Windows 共用）
            string home = Environment.GetEnvironmentVariable("USERPROFILE");
            if (!String.IsNullOrEmpty(home))
                candidates.Add(Path.Combine(home, ".bash_history")); // Git Bash
            SourceInfo best = null;
            for (int i = 0; i < candidates.Count; i++)
            {
                try
                {
                    string p = candidates[i];
                    if (p == null || !File.Exists(p)) continue;
                    FileInfo fi = new FileInfo(p);
                    if (fi.Length == 0) continue;
                    SourceInfo cand = new SourceInfo();
                    cand.Path = p;
                    cand.Modified = fi.LastWriteTime;
                    if (best == null || cand.Modified > best.Modified)
                        best = cand;
                }
                catch
                {
                }
            }
            return best;
        }

        private const int TailBytes = 4 * 1024 * 1024;

        // 返回历史命令行（trim、去空、去 # 注释）。文件不存在/读失败返回 null。
        // 统一 FileShare.ReadWrite + 循环读满：PSReadLine 写盘瞬间不被锁，防止导入/建议静默全无（“命令不全”根因之一）。
        public static List<string> ReadLines(string path)
        {
            if (path == null || !File.Exists(path))
                return null;
            try
            {
                string text;
                using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    long len = fs.Length;
                    if (len == 0)
                        return new List<string>();
                    if (len <= TailBytes)
                    {
                        // StreamReader 自动识别 BOM（UTF-8/UTF-16）；无 BOM 时按 UTF-8
                        using (StreamReader sr = new StreamReader(fs, Encoding.UTF8, true))
                            text = sr.ReadToEnd();
                    }
                    else
                    {
                        // 大文件只取尾部（历史总是最近的行在后）：对齐编码单元边界并丢首残行
                        Encoding enc = PeekEncoding(fs);
                        bool wide = enc == Encoding.Unicode || enc == Encoding.BigEndianUnicode;
                        long start = len - TailBytes;
                        if (wide && (start & 1) == 1) start++;
                        fs.Seek(start, SeekOrigin.Begin);
                        text = enc.GetString(ReadFully(fs, (int)(len - start)));
                        int firstLf = text.IndexOf('\n');
                        if (firstLf >= 0) text = text.Substring(firstLf + 1);
                    }
                }
                string[] raw = text.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                List<string> result = new List<string>();
                for (int i = 0; i < raw.Length; i++)
                {
                    string t = raw[i].Trim();
                    if (t.Length == 0 || t.StartsWith("#"))
                        continue;
                    result.Add(t);
                }
                return result;
            }
            catch
            {
                return null;
            }
        }

        private static byte[] ReadFully(FileStream fs, int length)
        {
            byte[] buf = new byte[length];
            int off = 0;
            while (off < length)
            {
                int n = fs.Read(buf, off, length - off);
                if (n <= 0) break;
                off += n;
            }
            if (off != length)
                Array.Resize(ref buf, off);
            return buf;
        }

        private static Encoding PeekEncoding(FileStream fs)
        {
            // 读文件头 BOM 判断编码（调用方随后会 Seek 到自己要读的位置）
            fs.Seek(0, SeekOrigin.Begin);
            int b0 = fs.ReadByte();
            int b1 = fs.ReadByte();
            if (b0 == 0xFF && b1 == 0xFE) return Encoding.Unicode;
            if (b0 == 0xFE && b1 == 0xFF) return Encoding.BigEndianUnicode;
            int b2 = fs.ReadByte();
            if (b0 == 0xEF && b1 == 0xBB && b2 == 0xBF) return Encoding.UTF8;
            return Encoding.UTF8;
        }

        // 收集"高频但未入库"建议：count>=3 且非敏感且不在现有库中 → 最多 topN 条（按频次降序，频次并列按最近出现）。
        public static List<Suggestion> CollectSuggestions(List<string> historyLines, List<Card> existing, int topN, int minFreq)
        {
            List<Suggestion> result = new List<Suggestion>();
            if (historyLines == null) return result;

            Dictionary<string, int> count = new Dictionary<string, int>();
            Dictionary<string, string> lastSeen = new Dictionary<string, string>();
            Dictionary<string, int> lastIdx = new Dictionary<string, int>();
            List<string> order = new List<string>();
            Dictionary<string, bool> inLibrary = new Dictionary<string, bool>();
            for (int i = 0; i < existing.Count; i++)
                inLibrary[existing[i].Body == null ? "" : existing[i].Body.Trim().ToLowerInvariant()] = true;

            for (int i = 0; i < historyLines.Count; i++)
            {
                string line = historyLines[i];
                if (Rules.IsSensitive(line)) continue;
                string key = line.Trim().ToLowerInvariant();
                if (key.Length == 0) continue;
                if (inLibrary.ContainsKey(key)) continue;
                int c;
                count.TryGetValue(key, out c);
                count[key] = c + 1;
                lastSeen[key] = line;   // 保留原始行（大小写敏感的命令原样入库/展示）
                lastIdx[key] = i;       // 同频时按“最近一次出现”行号取新者
                if (c == 0) order.Add(key);
            }

            // 按频次降序；频次并列按最近出现行号降序（稳定，不依赖 List.Sort 稳定性）
            List<string> keys = new List<string>(order);
            keys.Sort(delegate(string a, string b)
            {
                int ca = count[a];
                int cb = count[b];
                if (cb != ca) return cb.CompareTo(ca);
                int ia = lastIdx[a];
                int ib = lastIdx[b];
                if (ib != ia) return ib.CompareTo(ia);
                return 0;
            });
            for (int i = 0; i < keys.Count && result.Count < topN; i++)
            {
                string k = keys[i];
                if (count[k] >= minFreq)
                {
                    Suggestion s = new Suggestion();
                    s.Body = lastSeen[k];
                    s.Freq = count[k];
                    result.Add(s);
                }
            }
            return result;
        }
    }

    internal sealed class Suggestion
    {
        public string Body;
        public int Freq;
    }

    internal sealed class SourceInfo
    {
        public string Path;
        public DateTime Modified;
    }

    // ============================================================ 存储（复用旧库目录与格式）
    internal sealed class PilotStore
    {
        private readonly string dir;
        private readonly string cardsPath;
        private readonly string metricsPath;
        private readonly string settingsPath;

        public PilotStore()
            : this(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CommandPocketNative"))
        {
        }

        public PilotStore(string directory)
        {
            dir = directory;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            cardsPath = Path.Combine(dir, "cards.jsonl");
            metricsPath = Path.Combine(dir, "metrics.jsonl");
            settingsPath = Path.Combine(dir, "settings.ini");
        }

        public string Dir { get { return dir; } }

        // ---------- 设置（settings.ini：每行 name=value，宽容） ----------
        public string ReadSetting(string name)
        {
            try
            {
                if (File.Exists(settingsPath))
                {
                    string prefix = name + "=";
                    string[] lines = File.ReadAllLines(settingsPath, Encoding.UTF8);
                    for (int i = 0; i < lines.Length; i++)
                    {
                        string t = lines[i].Trim();
                        if (t.StartsWith(prefix))
                            return t.Substring(prefix.Length).Trim();
                    }
                }
            }
            catch
            {
            }
            return "";
        }

        public void WriteSetting(string name, string value)
        {
            try
            {
                string prefix = name + "=";
                List<string> lines = new List<string>();
                bool replaced = false;
                if (File.Exists(settingsPath))
                {
                    string[] raw = File.ReadAllLines(settingsPath, Encoding.UTF8);
                    for (int i = 0; i < raw.Length; i++)
                    {
                        if (raw[i].Trim().StartsWith(prefix))
                        {
                            lines.Add(prefix + value);
                            replaced = true;
                        }
                        else if (raw[i].Trim().Length > 0)
                            lines.Add(raw[i].Trim());
                    }
                }
                if (!replaced)
                    lines.Add(prefix + value);
                File.WriteAllText(settingsPath, String.Join(Environment.NewLine, lines.ToArray()) + Environment.NewLine, Encoding.UTF8);
            }
            catch
            {
            }
        }

        public bool ReadFlag(string name)
        {
            return ReadSetting(name) == "1";
        }

        public void WriteFlag(string name, bool on)
        {
            WriteSetting(name, on ? "1" : "0");
        }

        public bool ReadSettingClipPeek()
        {
            return ReadSetting("clip") != "off";
        }

        public void WriteSettingClipPeek(bool on)
        {
            WriteSetting("clip", on ? "on" : "off");
        }

        // ---------- 卡 ----------
        public List<Card> LoadCards()
        {
            List<Card> result = new List<Card>();
            if (!File.Exists(cardsPath)) return result;
            try
            {
                string[] lines = File.ReadAllLines(cardsPath, Encoding.UTF8);
                for (int i = 0; i < lines.Length; i++)
                {
                    Card c = Json.ReadCard(lines[i]);
                    if (c != null)
                        result.Add(c);
                }
            }
            catch
            {
                // 读盘失败不崩：返回已解析部分，错误进流水（托盘常驻程序优先级=不崩）
                Metric("err", "load");
            }
            return result;
        }

        public int CountCards()
        {
            return LoadCards().Count;
        }

        public void SaveCards(List<Card> cards)
        {
            try
            {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < cards.Count; i++)
                    sb.Append(Json.WriteCard(cards[i])).Append(Environment.NewLine);
                string tempPath = cardsPath + ".tmp";
                File.WriteAllText(tempPath, sb.ToString(), Encoding.UTF8);
                if (File.Exists(cardsPath))
                    File.Replace(tempPath, cardsPath, cardsPath + ".bak", true);
                else
                    File.Move(tempPath, cardsPath);
            }
            catch (Exception ex)
            {
                // 写盘失败不崩：清残留 .tmp、流水告警（下次写盘重试）
                try { if (File.Exists(cardsPath + ".tmp")) File.Delete(cardsPath + ".tmp"); } catch { }
                Metric("err", "save:" + ex.Message);
            }
        }

        // 同 body 视为同卡：命中则更新来源/风险/时间；否则追加。返回 true=新增。
        public bool Upsert(Card card)
        {
            List<Card> all = LoadCards();
            bool added = true;
            for (int i = 0; i < all.Count; i++)
            {
                if (Rules.BodyEquals(all[i].Body, card.Body))
                {
                    added = false;
                    all[i].UpdatedAt = DateTime.Now;
                    // 来源保护：仅旧卡来源为空时才覆盖（反复导入不得把 clipboard/manual 洗成 history，信任链不失真）
                    if (String.IsNullOrEmpty(all[i].Source) || all[i].Source == "预置")
                        all[i].Source = card.Source;
                    if (all[i].Risk == "low" && card.Risk != "low")
                        all[i].Risk = card.Risk;
                    if (card.Purpose.Length > 0 && all[i].Purpose.Length == 0)
                        all[i].Purpose = card.Purpose;
                    // 命中旧卡：不动 LastUsedAt（保留真实使用时间），避免导入/预填把排序插队
                    card = null;
                    break;
                }
            }
            if (card != null)
                all.Add(card);
            SaveCards(all);
            return added;
        }

        // 多源导入（取最后写入者）：频次 Top-N 去重入库，保留原始大小写；新卡不伪造“用过”时间。返回给用户看的摘要。
        public string ImportHistory(int topN)
        {
            SourceInfo src = History.BestSource();
            if (src == null)
                return "未找到可读终端历史。已检查：\r\n\r\n" + CandidateListText();
            List<string> lines = History.ReadLines(src.Path);
            if (lines == null || lines.Count == 0)
                return "终端历史为空或不可读：\r\n" + src.Path;

            Dictionary<string, int> count = new Dictionary<string, int>();
            Dictionary<string, string> lastSeen = new Dictionary<string, string>();
            Dictionary<string, int> lastIdx = new Dictionary<string, int>();
            List<string> order = new List<string>();
            for (int i = 0; i < lines.Count; i++)
            {
                string line = lines[i];
                if (Rules.IsSensitive(line)) continue;
                string key = line.Trim().ToLowerInvariant();
                if (key.Length == 0) continue;
                int c;
                count.TryGetValue(key, out c);
                count[key] = c + 1;
                lastSeen[key] = line;   // 原始行（大小写敏感）
                lastIdx[key] = i;
                if (c == 0) order.Add(key);
            }
            order.Sort(delegate(string a, string b)
            {
                int ca = count[a];
                int cb = count[b];
                if (cb != ca) return cb.CompareTo(ca);
                return lastIdx[b].CompareTo(lastIdx[a]); // 同频取最近出现
            });
            int imported = 0;
            for (int i = 0; i < order.Count && imported < topN; i++)
            {
                Card c = Cards.New(lastSeen[order[i]], "history", false);
                if (Upsert(c))
                    imported++;
            }
            return "已从终端历史收录 " + imported + " 条（来源：\r\n" + src.Path +
                "\r\n\r\n文件最后写入：" + src.Modified.ToString("MM-dd HH:mm") + "）";
        }

        private string CandidateListText()
        {
            SourceInfo best = History.BestSource();
            string ps = History.DefaultPath();
            string home = Environment.GetEnvironmentVariable("USERPROFILE");
            string bash = String.IsNullOrEmpty(home) ? null : Path.Combine(home, ".bash_history");
            StringBuilder sb = new StringBuilder();
            sb.Append((ps != null && File.Exists(ps)) ? "有" : "无").Append("  PowerShell 历史 (PSReadLine)\r\n");
            sb.Append((bash != null && File.Exists(bash)) ? "有" : "无").Append("  Git Bash 历史 (.bash_history)\r\n");
            sb.Append("支持：PowerShell 5.1 / PowerShell 7 / Git Bash。CMD 无持久历史。");
            return sb.ToString();
        }

        public void BumpCopy(Card card)
        {
            if (card == null) return;
            List<Card> all = LoadCards();
            for (int i = 0; i < all.Count; i++)
            {
                if (all[i].Id == card.Id)
                {
                    all[i].CopyCount++;
                    all[i].LastUsedAt = DateTime.Now;
                    all[i].UpdatedAt = DateTime.Now;
                    break;
                }
            }
            SaveCards(all);
        }

        // ---------- 流水（只追加；本地可见可删） ----------
        public void Metric(string evt, string detail)
        {
            try
            {
                string now = DateTime.Now.ToString(Json.TimeFormat, System.Globalization.CultureInfo.InvariantCulture);
                string line = now + "|" + evt + (detail.Length == 0 ? "" : "|" + detail) + Environment.NewLine;
                File.AppendAllText(metricsPath, line, Encoding.UTF8);
            }
            catch
            {
            }
        }

        public int[] CountToday()
        {
            // [取(copy), 存(save+adopt)] 当日
            int copies = 0;
            int saves = 0;
            try
            {
                if (!File.Exists(metricsPath)) return new int[] { 0, 0 };
                string today = DateTime.Now.ToString("yyyy-MM-dd");
                string[] lines = File.ReadAllLines(metricsPath, Encoding.UTF8);
                for (int i = 0; i < lines.Length; i++)
                {
                    string line = lines[i];
                    if (line.Length < 10 || !line.StartsWith(today))
                        continue;
                    if (line.IndexOf("|copy", StringComparison.Ordinal) >= 0) copies++;
                    else if (line.IndexOf("|save", StringComparison.Ordinal) >= 0) saves++;
                    else if (line.IndexOf("|adopt", StringComparison.Ordinal) >= 0) saves++;
                }
            }
            catch
            {
            }
            return new int[] { copies, saves };
        }
    }

    // ============================================================ UI 配色（沿用旧深色系）
    internal static class Ui
    {
        public static readonly Color Back = Color.FromArgb(15, 23, 32);
        public static readonly Color Chrome = Color.FromArgb(11, 17, 24);
        public static readonly Color Input = Color.FromArgb(21, 31, 42);
        public static readonly Color Selected = Color.FromArgb(24, 47, 61);
        public static readonly Color Ink = Color.FromArgb(232, 240, 246);
        public static readonly Color Muted = Color.FromArgb(127, 146, 160);
        public static readonly Color Accent = Color.FromArgb(45, 212, 191);
        public static readonly Color AccentDim = Color.FromArgb(30, 120, 115);
        public static readonly Color Danger = Color.FromArgb(251, 113, 133);
        public static readonly Color Warn = Color.FromArgb(251, 191, 36);
        public static readonly Color Border = Color.FromArgb(42, 61, 74);
        public static readonly Color Divider = Color.FromArgb(27, 39, 50);
    }

    // ============================================================ 托盘 + 应用上下文
    internal sealed class PilotAppContext : ApplicationContext
    {
        private readonly PilotStore store;
        private readonly NotifyIcon tray;
        private PilotForm pocket;

        public PilotAppContext()
        {
            store = new PilotStore();
            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Application;
            tray.Text = "Command Pocket " + Program.VersionLabel;
            tray.Visible = true;
            tray.ContextMenuStrip = BuildTrayMenu();
            tray.DoubleClick += delegate { ShowPilot(); };
            // 预创建小窗（保持隐藏）→ 立即拿到窗口句柄并注册全局热键。
            // 若等首次 ShowPilot 才建窗，第一次按 Ctrl+Alt+P 时窗口尚不存在 → 快捷键永不生效。
            pocket = new PilotForm(store);
            pocket.FormClosed += delegate { pocket = null; };
            pocket.EnsureHandle();
            // 启动只驻托盘：不自动弹窗、不读剪贴板（自证口径：任何读取 = 一次可见手势）
            if (!store.ReadFlag("welcome"))
            {
                store.WriteFlag("welcome", true);
                tray.BalloonTipTitle = "Command Pocket";
                tray.BalloonTipText = "按 Ctrl+Alt+P 唤出小窗。\r\n“粘贴即存”会读取一次剪贴板用于预填，可在托盘菜单随时关闭。";
                tray.ShowBalloonTip(5000);
            }
        }

        private ContextMenuStrip BuildTrayMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开小窗", null, delegate { ShowPilot(); });
            menu.Items.Add("导入终端历史", null, delegate
            {
                string summary = store.ImportHistory(20);
                MessageBox.Show(summary, "Command Pocket · 导入终端历史",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                ShowPilot();
            });
            menu.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem clip = new ToolStripMenuItem("粘贴即存(剪贴板预填): " + (store.ReadSettingClipPeek() ? "开" : "关"));
            clip.Click += delegate
            {
                bool next = !store.ReadSettingClipPeek();
                store.WriteSettingClipPeek(next);
                clip.Text = "粘贴即存(剪贴板预填): " + (next ? "开" : "关");
            };
            menu.Items.Add(clip);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitApp(); });
            return menu;
        }

        private void ShowPilot()
        {
            if (pocket == null || pocket.IsDisposed)
            {
                pocket = new PilotForm(store);
                pocket.FormClosed += delegate { pocket = null; };
            }
            FirstUseGuide();
            pocket.Reload(true);
            pocket.Show();
            pocket.Activate();
            pocket.FocusSearch();
        }

        // 空库首启（只在用户可见手势内弹一次；结果落 settings，不再反复问）
        private void FirstUseGuide()
        {
            if (store.ReadFlag("importask")) return;
            if (store.CountCards() > 0) return;
            SourceInfo src = History.BestSource();
            if (src == null) return;
            DialogResult r = MessageBox.Show(
                "库里还没有命令。最近写入的终端历史（" + src.Modified.ToString("MM-dd HH:mm") + "）可导入：\r\n\r\n" +
                "收录最常用的 20 条？\r\n(仅本地读取，自动剔除含 password/token/密钥 的行)",
                "Command Pocket · 首次引导",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            store.WriteFlag("importask", true);
            if (r == DialogResult.Yes)
            {
                string summary = store.ImportHistory(20);
                if (summary != null && summary.Length > 0)
                    MessageBox.Show(summary, "Command Pocket · 导入", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private void ExitApp()
        {
            tray.Visible = false;
            tray.Dispose();
            if (pocket != null && !pocket.IsDisposed)
                pocket.Close();
            ExitThread();
        }
    }

    // ============================================================ 小窗（一窗一框：过滤 + 列表 + 底栏）
    internal sealed class PilotForm : Form
    {
        private const int WmHotkey = 0x0312;
        private const int HotkeyId = 0xA1B2; // 与旧版 0xA1B1 错开，允许并存调试
        private const int ModAlt = 0x0001;
        private const int ModControl = 0x0002;
        private const int CsDropShadow = 0x00020000;
        private const int CornerRadius = 14;

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, int modifiers, uint vk);
        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private enum RowType { Card, ClipSave, Suggest, Empty }

        private sealed class Row
        {
            public RowType Type;
            public Card Card;          // Type==Card
            public string ActionBody;  // ClipSave/Suggest
            public string Badge;       // 副文字
            public string Sub;         // 时间/频次
            public bool Danger;
        }

        private readonly PilotStore store;
        private TextBox search;
        private ListView list;
        private Label status;
        private List<Card> cards = new List<Card>();
        private List<Row> rows = new List<Row>();
        private List<Suggestion> suggestSnapshot = new List<Suggestion>();
        private int cardCount = 0;
        private int[] todayCount = new int[] { 0, 0 };
        private string clipOffer = "";          // 本次唤出读到的候选剪贴板文本
        private string offeredClip = "";   // 本会话已 offer 过的剪贴板文本（同文本不重复打扰）

        public PilotForm(PilotStore store)
        {
            this.store = store;
            Text = "Command Pocket";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            // 按鼠标所在屏定位（人在副屏时不弹错屏）
            Screen sc = Screen.FromPoint(Cursor.Position);
            Location = new Point(sc.WorkingArea.Right - 560, sc.WorkingArea.Top + 60);
            Size = new Size(520, 360);
            BackColor = Ui.Back;
            BuildUi();
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

        private void BuildUi()
        {
            search = new TextBox();
            search.BackColor = Ui.Input;
            search.ForeColor = Ui.Ink;
            search.BorderStyle = BorderStyle.None;
            search.Font = new Font("Microsoft YaHei UI", 11F);
            search.Location = new Point(14, 12);
            search.Size = new Size(410, 26);
            search.Text = "";
            Controls.Add(search);

            Button add = new Button();
            add.Text = "+";
            add.FlatStyle = FlatStyle.Flat;
            add.FlatAppearance.BorderSize = 0;
            add.BackColor = Ui.Chrome;
            add.ForeColor = Ui.Muted;
            add.Location = new Point(434, 10);
            add.Size = new Size(30, 26);
            add.Click += delegate { AddManual(); };
            Controls.Add(add);

            list = new ListView();
            list.View = View.Details;
            list.FullRowSelect = true;
            list.HideSelection = false;
            list.BorderStyle = BorderStyle.None;
            list.BackColor = Ui.Back;
            list.ForeColor = Ui.Ink;
            list.Columns.Add("cmd", 345);
            list.Columns.Add("meta", 155);
            list.OwnerDraw = true;
            list.HeaderStyle = ColumnHeaderStyle.None;
            list.DrawColumnHeader += delegate(object s, DrawListViewColumnHeaderEventArgs e) { };
            list.DrawSubItem += DrawRow;
            list.Location = new Point(0, 44);
            list.Size = new Size(520, 278);
            list.MultiSelect = false;
            list.Font = new Font("Microsoft YaHei UI", 10F);
            list.DoubleClick += delegate { CopySelected(); };
            list.KeyDown += OnListKeyDown;
            // 列表上直接打字 → 转发回搜索框（焦点滞留列表也能过滤）
            list.KeyPress += delegate(object s, KeyPressEventArgs e)
            {
                if (char.IsControl(e.KeyChar)) return;
                search.Text += e.KeyChar;
                search.SelectionStart = search.TextLength;
                search.Focus();
                e.Handled = true;
            };
            list.SelectedIndexChanged += delegate { UpdateStatus(); };
            Controls.Add(list);

            status = new Label();
            status.ForeColor = Ui.Muted;
            status.Font = new Font("Microsoft YaHei UI", 8.5F);
            status.Location = new Point(14, 328);
            status.AutoSize = false;
            status.Size = new Size(492, 20);
            status.AutoEllipsis = true;
            Controls.Add(status);

            search.KeyDown += OnSearchKeyDown;
            search.TextChanged += delegate { RefreshRows(); };
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (!RegisterHotKey(Handle, HotkeyId, ModAlt | ModControl, 0x50))
                MessageBox.Show("全局热键 Ctrl+Alt+P 注册失败（可能被其他程序占用），可用托盘图标打开。",
                    "Command Pocket", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        // 供 AppContext 在启动时预创建句柄注册全局热键（CreateHandle 受保护，需在此包装）
        public void EnsureHandle()
        {
            if (!IsHandleCreated)
                CreateHandle();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            UnregisterHotKey(Handle, HotkeyId);
            base.OnFormClosed(e);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmHotkey && (int)m.WParam == HotkeyId)
            {
                if (Visible) HideWindow();
                else
                {
            Reload(true);
                    Show();
                    Activate();
                    FocusSearch();
                }
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = RoundedRect(new Rectangle(0, 0, Width - 1, Height - 1), CornerRadius))
            {
                using (Pen pen = new Pen(Ui.Border))
                    e.Graphics.DrawPath(pen, path);
            }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (Width > 0 && Height > 0)
            {
                using (GraphicsPath path = RoundedRect(new Rectangle(0, 0, Width, Height), CornerRadius))
                    Region = new Region(path);
            }
        }

        private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            int d = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public void FocusSearch()
        {
            search.Focus();
            search.SelectAll();
        }

        // ============================================================ 数据装配
        // 每次唤出（=用户手势）内做一次 IO：读库、排序、剪贴板一次、历史建议一次、当日计数。
        // readClip=false：内部刷新（存卡后 Reload）不再读剪贴板/不重复计 peek，守住“唤出内一次”口径。
        public void Reload(bool readClip)
        {
            cards = store.LoadCards();
            cards.Sort(Rules.CompareRecent);
            cardCount = cards.Count;
            BuildSnapshots(readClip);
            RefreshRows();
        }

        private void BuildSnapshots(bool readClip)
        {
            todayCount = store.CountToday();
            suggestSnapshot = new List<Suggestion>();
            if (search.Text != null && search.Text.Trim().Length > 0)
                return; // 有过滤词时无需 action 快照
            if (readClip && store.ReadSettingClipPeek())
            {
                string clip = TryReadClipboard();
                if (Rules.IsCommandish(clip) && !Rules.IsSensitive(clip) && !ExistsInLibrary(clip))
                    clipOffer = clip;
                else
                    clipOffer = "";
                store.Metric("peek", "clip"); // 读取审计流水（不含内容）
            }
            SourceInfo src = History.BestSource();
            if (src != null)
                suggestSnapshot = History.CollectSuggestions(History.ReadLines(src.Path), cards, 3, 3);
        }

        private void RefreshRows()
        {
            string q = search.Text == null ? "" : search.Text.Trim();
            rows.Clear();
            bool browsing = q.Length > 0;

            // ③ 再来一次（排序结果）放最上：首屏 ≤6 一眼即走；有输入放开全部匹配可滚动
            int shown = 0;
            for (int i = 0; i < cards.Count && (browsing || shown < 6); i++)
            {
                Card c = cards[i];
                if (!Matches(c, q)) continue;
                rows.Add(MakeCardRow(c));
                shown++;
            }

            // action 行（粘贴即存/高频建议）排在卡区下方：不抢占首卡、↓ 不误触、识别不打扰
            if (!browsing)
            {
                if (store.ReadSettingClipPeek() && clipOffer.Length > 0 && clipOffer != offeredClip)
                {
                    offeredClip = clipOffer;
                    rows.Add(MakeAction(RowType.ClipSave, clipOffer, "剪贴板·回车即存", ""));
                }
                for (int i = 0; i < suggestSnapshot.Count && i < 2; i++)
                    rows.Add(MakeAction(RowType.Suggest, suggestSnapshot[i].Body, "常敲未入库", "×" + suggestSnapshot[i].Freq));
            }

            if (browsing && shown == 0)
                rows.Add(new Row { Type = RowType.Empty, Badge = "没有这张卡 — 去问 AI 或搜一下吧（Esc 收起）", Sub = "" });
            else if (!browsing && cards.Count == 0)
                rows.Add(new Row { Type = RowType.Empty, Badge = "空库：按 + 记一条，或托盘菜单「导入终端历史」", Sub = "" });

            RenderRows();
        }

        private void UpdateStatus()
        {
            int[] today = todayCount;
            StringBuilder sb = new StringBuilder();
            sb.Append("库 ").Append(cardCount).Append(" 条 · 今日: 取 ").Append(today[0]).Append(" · 存 ").Append(today[1]);
            sb.Append("    |    回车=复制 · Esc=收起");
            if (cardCount > 6 && (search.Text == null || search.Text.Trim().Length == 0))
                sb.Append("    输入关键字可浏览全部");
            if (list.SelectedItems.Count > 0 && list.SelectedItems[0].Tag != null)
            {
                Row r = (Row)list.SelectedItems[0].Tag;
                if (r.Type == RowType.Card && r.Card != null)
                {
                    if (r.Card.Purpose != null && r.Card.Purpose.Length > 0)
                        sb.Append("    |    ").Append(Cards.Truncate(r.Card.Purpose, 26));
                    if (r.Danger)
                        sb.Append("    ⚠ 危险");
                }
            }
            status.Text = sb.ToString();
        }

        private bool ExistsInLibrary(string body)
        {
            for (int i = 0; i < cards.Count; i++)
                if (Rules.BodyEquals(cards[i].Body, body))
                    return true;
            return false;
        }

        private string TryReadClipboard()
        {
            try
            {
                return Clipboard.GetText(TextDataFormat.Text);
            }
            catch
            {
                return "";
            }
        }

        private Row MakeAction(RowType type, string body, string badge, string sub)
        {
            Row r = new Row();
            r.Type = type;
            r.ActionBody = body;
            r.Badge = badge;
            r.Sub = sub;
            r.Danger = Rules.GuessRisk(body) != "low";
            return r;
        }

        private Row MakeCardRow(Card c)
        {
            Row r = new Row();
            r.Type = RowType.Card;
            r.Card = c;
            r.Danger = Cards.IsDanger(c);   // 存储 risk 或现行规则命中任一即红（旧库缺省 low 的危险卡也拦）
            string when = "";
            if (c.LastUsedAt != DateTime.MinValue)
                when = FriendlyTime(c.LastUsedAt);
            string copies = c.CopyCount > 0 ? " · ×" + c.CopyCount : "";
            r.Sub = (r.Danger ? "⚠危险" + (when.Length == 0 ? "" : " · ") : "") + when + copies;
            return r;
        }

        private static string FriendlyTime(DateTime t)
        {
            DateTime now = DateTime.Now;
            if (t.Date == now.Date) return "上次:今天 " + t.ToString("HH:mm");
            if (t.Date == now.Date.AddDays(-1)) return "上次:昨天";
            if (t.Year != now.Year) return "上次:" + t.ToString("yyyy-MM-dd");
            return "上次:" + t.ToString("MM-dd");
        }

        private bool Matches(Card c, string q)
        {
            if (q.Length == 0) return true;
            string hay = (c.Body ?? "") + " " + (c.Aliases ?? "") + " " + (c.Title ?? "");
            return hay.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private void RenderRows()
        {
            list.BeginUpdate();
            list.Items.Clear();
            for (int i = 0; i < rows.Count; i++)
            {
                Row r = rows[i];
                string main;
                if (r.Type == RowType.Card) main = r.Card.Body;
                else if (r.Type == RowType.Empty) main = r.Badge;
                else main = r.ActionBody;
                ListViewItem item = new ListViewItem(main);
                item.SubItems.Add(r.Type == RowType.Empty ? "" : r.Sub);
                item.Tag = r;
                list.Items.Add(item);
            }
            list.EndUpdate();
            // 默认选中第一个 Card 行（"再来一次"主路径；卡区在顶）
            int first = 0;
            for (int i = 0; i < list.Items.Count; i++)
            {
                Row rr = (Row)list.Items[i].Tag;
                if (rr != null && rr.Type == RowType.Card) { first = i; break; }
            }
            if (list.Items.Count > 0)
            {
                list.Items[first].Selected = true;
                list.Items[first].Focused = true;
            }
            UpdateStatus();
        }

        private void DrawRow(object sender, DrawListViewSubItemEventArgs e)
        {
            if (e.Item == null || e.Item.Tag == null) return;
            Row r = (Row)e.Item.Tag;
            bool selected = e.Item.Selected;

            Rectangle row = e.Item.Bounds;
            Rectangle col = e.SubItem.Bounds;   // 本列矩形（每列自绘自己的背景与文字，顺序无关、互不覆盖）

            if (r.Type == RowType.Empty)
            {
                if (e.ColumnIndex != 0) return;
                e.Graphics.FillRectangle(selected ? BSelected : BBack, row);
                TextRenderer.DrawText(e.Graphics, r.Badge, FHint, row, Ui.Muted,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                return;
            }

            SolidBrush bg = BBack;
            if (r.Type == RowType.ClipSave) bg = BClip;
            else if (r.Type == RowType.Suggest) bg = BSug;
            if (selected) bg = BSelected;

            if (e.ColumnIndex == 1)
            {
                // meta 列：自绘背景 + 右侧文字（不依赖 col0 先画，杜绝悬停重绘时被盖掉）
                e.Graphics.FillRectangle(bg, col);
                Rectangle meta = new Rectangle(col.X + 4, row.Y, col.Width - 8, row.Height);
                string metaText = (r.Type == RowType.Card)
                    ? r.Sub
                    : (r.Badge + (r.Sub.Length == 0 ? "" : "  " + r.Sub));
                Color metaColor = Ui.Muted;
                if (r.Type == RowType.Card && r.Danger) metaColor = Ui.Danger;
                else if (r.Type != RowType.Card) metaColor = Ui.Warn;
                TextRenderer.DrawText(e.Graphics, metaText, FSmall, meta, metaColor,
                    TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                return;
            }

            // col0：自绘背景 + 危险点 + 主文本（不越界盖 meta 列）
            e.Graphics.FillRectangle(bg, col);
            if (r.Danger)
                e.Graphics.FillEllipse(BDanger, new Rectangle(col.X + 8, row.Y + row.Height / 2 - 3, 6, 6));
            int textX = col.X + (r.Danger ? 20 : 8);
            Rectangle text = new Rectangle(textX, row.Y, col.Width - (textX - col.X) - 6, row.Height);
            string main = (r.Type == RowType.Card) ? r.Card.Body : r.ActionBody;
            SolidBrush ink = BInk;
            if (r.Type == RowType.ClipSave || r.Type == RowType.Suggest) ink = BAccent;
            TextRenderer.DrawText(e.Graphics, main, FBody, text, ink.Color,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }

        private static readonly Font FBody = new Font("Microsoft YaHei UI", 10F);
        private static readonly Font FSmall = new Font("Microsoft YaHei UI", 8.5F);
        private static readonly Font FHint = new Font("Microsoft YaHei UI", 9.5F);
        private static readonly SolidBrush BBack = new SolidBrush(Ui.Back);
        private static readonly SolidBrush BSelected = new SolidBrush(Ui.Selected);
        private static readonly SolidBrush BClip = new SolidBrush(Color.FromArgb(14, 40, 38));
        private static readonly SolidBrush BSug = new SolidBrush(Color.FromArgb(28, 30, 22));
        private static readonly SolidBrush BDanger = new SolidBrush(Ui.Danger);
        private static readonly SolidBrush BInk = new SolidBrush(Ui.Ink);
        private static readonly SolidBrush BAccent = new SolidBrush(Ui.Accent);

        // ============================================================ 交互
        // 收起即回归首屏：清空过滤词（防下回唤出还是旧过滤短列表）
        private void HideWindow()
        {
            if (search.Text != null && search.Text.Length > 0)
                search.Clear();
            Hide();
        }

        private void OnSearchKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) { HideWindow(); store.Metric("esc", ""); }
            else if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                CopySelected();
            }
            else if (e.KeyCode == Keys.Down)
            {
                if (list.Items.Count > 0)
                {
                    list.Focus();
                    list.Items[0].Selected = true;   // 卡区在顶，首项=置顶卡
                }
                e.Handled = true;
            }
        }

        private void OnListKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) { HideWindow(); store.Metric("esc", ""); }
            else if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                CopySelected();
            }
        }

        private void CopySelected()
        {
            if (list.SelectedItems.Count == 0) return;
            Row r = (Row)list.SelectedItems[0].Tag;
            if (r.Type == RowType.Empty) { HideWindow(); return; }

            if (r.Type == RowType.ClipSave || r.Type == RowType.Suggest)
            {
                bool fromClip = r.Type == RowType.ClipSave;
                store.Upsert(Cards.New(r.ActionBody, fromClip ? "clipboard" : "history", true));
                store.Metric(fromClip ? "save" : "adopt", fromClip ? "clip" : "suggest");
                // 存后停留并刷新（内部刷新，不重读剪贴板）：新卡置顶成默认选中=可见确认；Esc 收起
                Reload(false);
                return;
            }
            // Card：危险先确认，再复制
            if (r.Danger)
            {
                DialogResult dr = MessageBox.Show(this,
                    "这是一条高风险命令，粘贴/执行前请再确认一次：\r\n\r\n" + r.Card.Body +
                    "\r\n\r\n是否仍要复制？",
                    "Command Pocket · 风险确认",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (dr != DialogResult.Yes) return;
            }
            try
            {
                Clipboard.SetText(r.Card.Body);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "复制失败：" + ex.Message, "Command Pocket", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            store.BumpCopy(r.Card);
            store.Metric("copy", "enter");
            HideWindow();
        }

        private void AddManual()
        {
            using (ManualDialog dlg = new ManualDialog())
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                string body = dlg.BodyText.Trim();
                if (body.Length == 0) return;
                Card c = Cards.New(body, "manual", true);
                c.Purpose = dlg.NoteText.Trim();
                store.Upsert(c);
                store.Metric("save", "manual");
                Reload(false);
            }
        }

        protected override void OnDeactivate(EventArgs e)
        {
            // 点击别处不强行收起（避免闪烁）；Esc/热键/回车收起
            base.OnDeactivate(e);
        }
    }

    // ============================================================ 手动录入（F10 兜底）
    internal sealed class ManualDialog : Form
    {
        private TextBox bodyBox;
        private TextBox noteBox;

        public string BodyText { get { return bodyBox.Text; } }
        public string NoteText { get { return noteBox.Text; } }

        public ManualDialog()
        {
            Text = "记一条";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(460, 214);
            BackColor = Ui.Chrome;
            MaximizeBox = false;
            MinimizeBox = false;

            Label l1 = new Label();
            l1.Text = "命令（或要留的操作/快捷键）：";
            l1.ForeColor = Ui.Ink;
            l1.Location = new Point(14, 12);
            l1.AutoSize = true;
            Controls.Add(l1);

            bodyBox = new TextBox();
            bodyBox.Multiline = true;
            bodyBox.Location = new Point(14, 34);
            bodyBox.Size = new Size(430, 60);
            bodyBox.BackColor = Ui.Input;
            bodyBox.ForeColor = Ui.Ink;
            bodyBox.BorderStyle = BorderStyle.FixedSingle;
            bodyBox.Font = new Font("Consolas", 10F);
            Controls.Add(bodyBox);

            Label l2 = new Label();
            l2.Text = "一句人话（可选）：它是干嘛的？";
            l2.ForeColor = Ui.Ink;
            l2.Location = new Point(14, 102);
            l2.AutoSize = true;
            Controls.Add(l2);

            noteBox = new TextBox();
            noteBox.Location = new Point(14, 124);
            noteBox.Size = new Size(430, 26);
            noteBox.BackColor = Ui.Input;
            noteBox.ForeColor = Ui.Ink;
            noteBox.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(noteBox);

            Label hint = new Label();
            hint.Text = "危险将自动判红（rm -rf / 强推等），复制前会确认一次。来源=手动。";
            hint.ForeColor = Ui.Muted;
            hint.Font = new Font("Microsoft YaHei UI", 8.5F);
            hint.Location = new Point(14, 152);
            hint.AutoSize = true;
            Controls.Add(hint);

            Button ok = new Button();
            ok.Text = "存";
            ok.Location = new Point(280, 180);
            ok.Size = new Size(80, 26);
            ok.DialogResult = DialogResult.OK;
            ok.BackColor = Ui.AccentDim;
            ok.ForeColor = Color.White;
            ok.FlatStyle = FlatStyle.Flat;
            Controls.Add(ok);

            Button cancel = new Button();
            cancel.Text = "取消";
            cancel.Location = new Point(368, 180);
            cancel.Size = new Size(80, 26);
            cancel.DialogResult = DialogResult.Cancel;
            cancel.BackColor = Ui.Input;
            cancel.ForeColor = Ui.Muted;
            cancel.FlatStyle = FlatStyle.Flat;
            Controls.Add(cancel);

            AcceptButton = ok;
            CancelButton = cancel;
            bodyBox.Focus();
        }
    }

    // ============================================================ SelfTest（纯逻辑断言，无 UI；退出码 0=绿）
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
                Console.WriteLine("SELFTEST FAIL: " + ex.Message);
                return 1;
            }
        }

        private static int RunCore()
        {
            // 1) jsonl 往返 + 特殊字符
            Card c = Cards.New("git commit -m \"x\\y\"\n第二行\t带tab", "test", true);
            c.Purpose = "提交 中文";
            c.CopyCount = 3;
            c.LastUsedAt = new DateTime(2026, 9, 1, 10, 0, 0);
            string line = Json.WriteCard(c);
            Card back = Json.ReadCard(line);
            if (back == null || back.Body != c.Body) return Fail("jsonl round-trip body");
            if (back.Purpose != c.Purpose) return Fail("jsonl round-trip purpose");
            if (back.CopyCount != 3) return Fail("jsonl round-trip copies");
            if (back.LastUsedAt != c.LastUsedAt) return Fail("jsonl round-trip time");

            // 2) 宽容：缺字段 + 未知 key
            string legacy = "{\"id\":\"x1\",\"title\":\"t\",\"body\":\"echo hi\",\"zzz\":123,\"weird\":{\"a\":1},\"risk\":\"\"}";
            Card lc = Json.ReadCard(legacy);
            if (lc == null) return Fail("tolerant read null");
            if (lc.Risk != "low") return Fail("tolerant default risk");
            if (lc.RiskRevert != "unknown") return Fail("tolerant default rr");
            if (lc.Kind != Card.KindCommand) return Fail("tolerant default kind");
            if (lc.Id != "x1") return Fail("tolerant id");

            // 3) 危险规则：只判 high 的窄表
            if (Rules.GuessRisk("rm -rf /tmp/build") != "high") return Fail("risk rm -rf");
            if (Rules.GuessRisk("git push --force-with-lease origin main") != "high") return Fail("risk force push");
            if (Rules.GuessRisk("git reset --hard HEAD~1") != "high") return Fail("risk reset hard");
            if (Rules.GuessRisk("taskkill /PID 8080 /F") != "low") return Fail("risk taskkill should stay low");
            if (Rules.GuessRisk("netstat -ano | findstr :8080") != "low") return Fail("risk netstat");
            if (Rules.GuessRisk("ls -la") != "low") return Fail("risk ls");

            // 4) 敏感剔除
            if (!Rules.IsSensitive("export AWS_SECRET_KEY=abc")) return Fail("sensitive aws");
            if (!Rules.IsSensitive("ssh user@host 'cat ~/.ssh/id_rsa'")) return Fail("sensitive key file");
            if (Rules.IsSensitive("npm run dev")) return Fail("sensitive npm false positive");
            if (Rules.IsSensitive("git status")) return Fail("sensitive git false positive");

            // 5) 剪贴板形状
            if (!Rules.IsCommandish("docker compose down && docker compose up -d")) return Fail("shape cmd");
            if (!Rules.IsCommandish("netstat -ano | findstr :8080")) return Fail("shape pipe");
            if (Rules.IsCommandish("今天天气不错我们去公园散步吧")) return Fail("shape cjk sentence");
            if (Rules.IsCommandish("")) return Fail("shape empty");
            if (Rules.IsCommandish(new string('a', 900))) return Fail("shape too long");

            // 6) 排序：最近用过在前，置顶 1
            Card old = Cards.New("old cmd", "t", true);
            old.LastUsedAt = new DateTime(2026, 1, 1);
            Card nowCard = Cards.New("now cmd", "t", true);
            nowCard.LastUsedAt = DateTime.Now;
            Card never = Cards.New("never cmd", "t", true);
            never.LastUsedAt = DateTime.MinValue;
            never.CreatedAt = new DateTime(2025, 1, 1);
            List<Card> all = new List<Card> { old, never, nowCard };
            all.Sort(Rules.CompareRecent);
            if (all[0] != nowCard) return Fail("rank now first");
            if (all[1] != old) return Fail("rank old before never");
            if (all[2] != never) return Fail("rank never last");

            // 7) 高频建议：频次>=3 且不在库中
            List<string> hist = new List<string> {
                "ssh deploy@10.0.0.5 'cd /app && git pull'",
                "ssh deploy@10.0.0.5 'cd /app && git pull'",
                "ssh deploy@10.0.0.5 'cd /app && git pull'",
                "ssh deploy@10.0.0.5 'cd /app && git pull'",
                "npm run dev",
                "npm run dev",
                "cat ~/.aws/credentials",   // 敏感：剔除
                "npm run dev" };
            List<Card> lib = new List<Card>();
            lib.Add(Cards.New("npm run dev", "history", true));
            List<Suggestion> sug = History.CollectSuggestions(hist, lib, 3, 3);
            if (sug.Count != 1) return Fail("suggest count=" + sug.Count);
            if (!sug[0].Body.Contains("ssh deploy")) return Fail("suggest top");
            if (sug[0].Freq < 3) return Fail("suggest freq");

            // 8) 历史解码（UTF-16 LE BOM 模拟文件）
            string p = Path.Combine(Path.GetTempPath(), "cpt-hist-" + Guid.NewGuid().ToString("N") + ".txt");
            File.WriteAllText(p, "cmd one\r\ncmd two\r\n", Encoding.Unicode);
            List<string> histLines = History.ReadLines(p);
            File.Delete(p);
            if (histLines == null || histLines.Count != 2) return Fail("history utf16 decode");
            if (histLines[1] != "cmd two") return Fail("history content");

            // 9) 危险门实时判定：旧卡缺省 risk=low 但正文命中现行规则 → 仍拦
            Card dangerStale = Cards.New("rm -rf /tmp/x", "t", true);
            dangerStale.Risk = "low";
            if (!Cards.IsDanger(dangerStale)) return Fail("IsDanger should catch stale low-risk rm -rf");
            if (Cards.IsDanger(Cards.New("netstat -ano", "t", true))) return Fail("IsDanger netstat false positive");

            // 10) 建议保留原始大小写（命令原样入库/展示）
            List<string> mixedHist = new List<string> {
                "Git Status", "Git Status", "Git Status",
                "git log --oneline" };
            List<Suggestion> mixed = History.CollectSuggestions(mixedHist, new List<Card>(), 3, 3);
            if (mixed.Count != 1) return Fail("suggest original-case count=" + mixed.Count);
            if (mixed[0].Body != "Git Status") return Fail("suggest original-case body=" + mixed[0].Body);

            // 11) 建议同频稳定：最近出现者优先
            List<string> tieHist = new List<string> {
                "bolder cmd", "bolder cmd", "newer cmd", "newer cmd" };
            List<Suggestion> tie = History.CollectSuggestions(tieHist, new List<Card>(), 3, 2);
            if (tie.Count != 2) return Fail("suggest tie count=" + tie.Count);
            if (tie[0].Body != "newer cmd") return Fail("suggest tie newest-first body=" + tie[0].Body);

            Console.WriteLine("SELFTEST PASS (v5-pilot)");
            return 0;
        }

        private static int Fail(string what)
        {
            Console.WriteLine("SELFTEST FAIL: " + what);
            return 1;
        }
    }
}
