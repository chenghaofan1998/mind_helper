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
using System.Windows.Forms;

namespace CommandPocketPilot
{
    internal static class Program
    {
        public const string VersionLabel = "v5-pilot";

        [STAThread]
        private static void Main(string[] args)
        {
            if (args != null && args.Length > 0 && args[0] == "--self-test")
            {
                Environment.Exit(SelfTest.Run());
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new PilotAppContext());
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
        public static Card New(string body, string source)
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
            c.LastUsedAt = now;
            c.CreatedAt = now;
            c.UpdatedAt = now;
            return c;
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

        // "再来一次"排序：最近干成过(lastUsedAt) 为主；同刻用次数；无使用记录按创建时间。
        public static int CompareRecent(Card a, Card b)
        {
            DateTime ta = a.LastUsedAt == DateTime.MinValue ? a.CreatedAt : a.LastUsedAt;
            DateTime tb = b.LastUsedAt == DateTime.MinValue ? b.CreatedAt : b.LastUsedAt;
            int byTime = DateTime.Compare(tb, ta); // 新者在前
            if (byTime != 0) return byTime;
            int byCopies = b.CopyCount.CompareTo(a.CopyCount);
            if (byCopies != 0) return byCopies;
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
                            sb.Append((char)Convert.ToInt32(line.Substring(pos + 1, 4), 16));
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

        private const int TailBytes = 4 * 1024 * 1024;

        // 返回历史命令行（trim、去空、去 # 注释）。文件不存在/读失败返回 null。
        public static List<string> ReadLines(string path)
        {
            if (path == null || !File.Exists(path))
                return null;
            try
            {
                string text;
                long len = new FileInfo(path).Length;
                if (len <= TailBytes)
                {
                    text = File.ReadAllText(path, DetectEncoding(path));
                }
                else
                {
                    // 大文件只取尾部（历史总是最近的行在后）：对齐编码单元边界并丢首残行
                    Encoding enc = DetectEncoding(path);
                    bool wide = enc == Encoding.Unicode || enc == Encoding.BigEndianUnicode;
                    long start = len - TailBytes;
                    if (wide && (start & 1) == 1) start++;
                    using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    {
                        fs.Seek(start, SeekOrigin.Begin);
                        byte[] buf = new byte[fs.Length - start];
                        fs.Read(buf, 0, buf.Length);
                        text = enc.GetString(buf);
                    }
                    int firstLf = text.IndexOf('\n');
                    if (firstLf >= 0) text = text.Substring(firstLf + 1);
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

        private static Encoding DetectEncoding(string path)
        {
            try
            {
                using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read))
                {
                    if (fs.Length < 2) return Encoding.UTF8;
                    int b0 = fs.ReadByte();
                    int b1 = fs.ReadByte();
                    if (b0 == 0xFF && b1 == 0xFE) return Encoding.Unicode;
                    if (b0 == 0xFE && b1 == 0xFF) return Encoding.BigEndianUnicode;
                }
            }
            catch
            {
            }
            return Encoding.UTF8;
        }

        // 收集"高频但未入库"建议：count>=3 且非敏感且不在现有库中 → 最多 topN 条（按频次降序，频次并列按最近出现）。
        public static List<Suggestion> CollectSuggestions(List<string> historyLines, List<Card> existing, int topN, int minFreq)
        {
            List<Suggestion> result = new List<Suggestion>();
            if (historyLines == null) return result;

            Dictionary<string, int> count = new Dictionary<string, int>();
            Dictionary<string, string> lastSeen = new Dictionary<string, string>();
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
                lastSeen[key] = line;
                if (c == 0) order.Add(key);
            }

            // 按频次降序、频次并列按最近出现（order 靠后者更新）
            List<string> keys = new List<string>(order);
            keys.Sort(delegate(string a, string b)
            {
                int ca = count[a];
                int cb = count[b];
                if (cb != ca) return cb.CompareTo(ca);
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

        // ---------- 设置 ----------
        public bool ReadSettingClipPeek()
        {
            try
            {
                if (File.Exists(settingsPath))
                {
                    string[] lines = File.ReadAllLines(settingsPath, Encoding.UTF8);
                    for (int i = 0; i < lines.Length; i++)
                        if (lines[i].Trim() == "clip=off")
                            return false;
                }
            }
            catch
            {
            }
            return true;
        }

        public void WriteSettingClipPeek(bool on)
        {
            try
            {
                File.WriteAllText(settingsPath, on ? "clip=on" : "clip=off", Encoding.UTF8);
            }
            catch
            {
            }
        }

        // ---------- 卡 ----------
        public List<Card> LoadCards()
        {
            List<Card> result = new List<Card>();
            if (!File.Exists(cardsPath)) return result;
            string[] lines = File.ReadAllLines(cardsPath, Encoding.UTF8);
            for (int i = 0; i < lines.Length; i++)
            {
                Card c = Json.ReadCard(lines[i]);
                if (c != null)
                    result.Add(c);
            }
            return result;
        }

        public int CountCards()
        {
            return LoadCards().Count;
        }

        public void SaveCards(List<Card> cards)
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

        public void ImportHistory(int topN)
        {
            List<string> lines = History.ReadLines(History.DefaultPath());
            if (lines == null) return;
            // 频次 Top-N 全部导入（含已在库则更新热度）
            Dictionary<string, int> count = new Dictionary<string, int>();
            List<string> order = new List<string>();
            for (int i = 0; i < lines.Count; i++)
            {
                string line = lines[i];
                if (Rules.IsSensitive(line)) continue;
                string key = line.Trim().ToLowerInvariant();
                if (key.Length == 0) continue;
                int c;
                count.TryGetValue(key, out c);
                if (c == 0) order.Add(key);
                count[key] = c + 1;
            }
            order.Sort(delegate(string a, string b)
            {
                int ca = count[a];
                int cb = count[b];
                if (cb != ca) return cb.CompareTo(ca);
                return 0;
            });
            int imported = 0;
            for (int i = 0; i < order.Count && imported < topN; i++)
            {
                string body = order[i];
                Card c = Cards.New(body, "history");
                if (Upsert(c))
                    imported++;
            }
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
            ShowPilot();
            if (store.CountCards() == 0)
                MaybeOfferImport();
        }

        private ContextMenuStrip BuildTrayMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开小窗", null, delegate { ShowPilot(); });
            menu.Items.Add("导入终端历史", null, delegate
            {
                store.ImportHistory(20);
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
            pocket.Reload();
            pocket.Show();
            pocket.Activate();
            pocket.FocusSearch();
        }

        private void MaybeOfferImport()
        {
            string path = History.DefaultPath();
            if (!File.Exists(path))
                return;
            DialogResult r = MessageBox.Show(
                "库里还没有命令。要导入终端历史里最常用的 20 条吗？\r\n\r\n" +
                "(仅本地读取，自动剔除含 password/token/密钥 的行)",
                "Command Pocket · 首次引导",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (r == DialogResult.Yes)
            {
                store.ImportHistory(20);
                ShowPilot();
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

        public PilotForm(PilotStore store)
        {
            this.store = store;
            Text = "Command Pocket";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(Screen.PrimaryScreen.WorkingArea.Right - 560, Screen.PrimaryScreen.WorkingArea.Top + 60);
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
            list.Columns.Add("cmd", 360);
            list.Columns.Add("meta", 130);
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
            Controls.Add(list);

            status = new Label();
            status.ForeColor = Ui.Muted;
            status.Font = new Font("Microsoft YaHei UI", 8.5F);
            status.Location = new Point(14, 328);
            status.AutoSize = true;
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

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            UnregisterHotKey(Handle, HotkeyId);
            base.OnFormClosed(e);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmHotkey && (int)m.WParam == HotkeyId)
            {
                if (Visible) Hide();
                else
                {
                    Reload();
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
        public void Reload()
        {
            cards = store.LoadCards();
            cards.Sort(Rules.CompareRecent);
            RefreshRows();
        }

        private void RefreshRows()
        {
            string q = search.Text == null ? "" : search.Text.Trim();
            rows.Clear();

            // 输入了过滤词：只做子串过滤，action 行不掺和
            if (q.Length == 0)
            {
                // ① 粘贴即存（热键手势内读一次剪贴板；可关；永不自动选中，需 ↓ 后回车才存）
                if (store.ReadSettingClipPeek())
                {
                    string clip = TryReadClipboard();
                    if (Rules.IsCommandish(clip) && !ExistsInLibrary(clip))
                    {
                        rows.Add(MakeAction(RowType.ClipSave, clip,
                            "剪贴板·回车即存", ""));
                    }
                }

                // ② 高频建议（库自己长大）
                List<Suggestion> suggs = History.CollectSuggestions(
                    History.ReadLines(History.DefaultPath()), cards, 3, 3);
                for (int i = 0; i < suggs.Count; i++)
                {
                    if (rows.Count >= 2) break;
                    rows.Add(MakeAction(RowType.Suggest, suggs[i].Body,
                        "常敲未入库", "×" + suggs[i].Freq));
                }
            }

            // ③ 再来一次（排序结果）：首屏只放 6 条（一眼认出即走）；
            // 有输入 = 用户在找 → 放开上限，全部匹配可滚动
            bool browsing = q.Length > 0;
            int shown = 0;
            for (int i = 0; i < cards.Count && (browsing || shown < 6); i++)
            {
                Card c = cards[i];
                if (!Matches(c, q)) continue;
                rows.Add(MakeCardRow(c));
                shown++;
            }

            if (q.Length > 0 && shown == 0)
                rows.Add(new Row { Type = RowType.Empty, Badge = "没有这张卡 — 去问 AI 或搜一下吧（Esc 收起）", Sub = "" });
            else if (q.Length == 0 && cards.Count == 0)
                rows.Add(new Row { Type = RowType.Empty, Badge = "空库：按 + 记一条，或托盘菜单「导入终端历史」", Sub = "" });

            RenderRows();

            int[] today = store.CountToday();
            status.Text = "今日: 取 " + today[0] + " · 存 " + today[1] + "    |    回车=复制 · Esc=收起";
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
            r.Danger = c.Risk == "high" || c.Risk == "critical";
            string when = "";
            if (c.LastUsedAt != DateTime.MinValue)
                when = FriendlyTime(c.LastUsedAt);
            string copies = c.CopyCount > 0 ? " · ×" + c.CopyCount : "";
            r.Sub = when + copies;
            return r;
        }

        private static string FriendlyTime(DateTime t)
        {
            DateTime now = DateTime.Now;
            if (t.Date == now.Date) return "上次:今天 " + t.ToString("HH:mm");
            if (t.Date == now.Date.AddDays(-1)) return "上次:昨天";
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
            // 默认选中第一个 Card 行（"再来一次"主路径）；ClipSave/Suggest 行需 ↓ 后回车，杜绝误存
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
        }

        private void DrawRow(object sender, DrawListViewSubItemEventArgs e)
        {
            if (e.Item == null || e.Item.Tag == null) return;
            Row r = (Row)e.Item.Tag;
            bool selected = e.Item.Selected;

            Rectangle row = e.Item.Bounds;
            row.X = 0;
            row.Width = list.ClientSize.Width;

            if (r.Type == RowType.Empty)
            {
                if (e.ColumnIndex != 0) return;
                if (selected)
                    e.Graphics.FillRectangle(BSelected, row);
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
                // 仅画右侧 meta（背景已由 col0 全宽铺设，不得再刷）
                Rectangle meta = new Rectangle(row.X + 4, row.Y, row.Width - 8, row.Height);
                string metaText = (r.Type == RowType.Card)
                    ? r.Sub
                    : (r.Badge + (r.Sub.Length == 0 ? "" : "  " + r.Sub));
                Color metaColor = r.Type == RowType.Card ? Ui.Muted : Ui.Warn;
                TextRenderer.DrawText(e.Graphics, metaText, FSmall, meta, metaColor,
                    TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                return;
            }

            // col0：整行背景 + 危险点 + 主文本
            e.Graphics.FillRectangle(bg, row);
            if (r.Danger)
                e.Graphics.FillEllipse(BDanger, new Rectangle(row.X + 8, row.Y + row.Height / 2 - 3, 6, 6));
            int textX = row.X + (r.Danger ? 20 : 8);
            Rectangle text = new Rectangle(textX, row.Y, row.Width - textX - 8, row.Height);
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
        private void OnSearchKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) { Hide(); store.Metric("esc", ""); }
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
                    list.Items[0].Selected = true;
                }
                e.Handled = true;
            }
        }

        private void OnListKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) { Hide(); store.Metric("esc", ""); }
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
            if (r.Type == RowType.Empty) { Hide(); return; }

            if (r.Type == RowType.ClipSave || r.Type == RowType.Suggest)
            {
                bool fromClip = r.Type == RowType.ClipSave;
                store.Upsert(Cards.New(r.ActionBody, fromClip ? "clipboard" : "history"));
                store.Metric(fromClip ? "save" : "adopt", fromClip ? "clip" : "suggest");
                Reload();
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
            Hide();
        }

        private void AddManual()
        {
            using (ManualDialog dlg = new ManualDialog())
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                string body = dlg.BodyText.Trim();
                if (body.Length == 0) return;
                Card c = Cards.New(body, "manual");
                c.Purpose = dlg.NoteText.Trim();
                store.Upsert(c);
                store.Metric("save", "manual");
                Reload();
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
            ClientSize = new Size(460, 190);
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

            Button ok = new Button();
            ok.Text = "存";
            ok.Location = new Point(280, 158);
            ok.Size = new Size(80, 26);
            ok.DialogResult = DialogResult.OK;
            ok.BackColor = Ui.AccentDim;
            ok.ForeColor = Color.White;
            ok.FlatStyle = FlatStyle.Flat;
            Controls.Add(ok);

            Button cancel = new Button();
            cancel.Text = "取消";
            cancel.Location = new Point(368, 158);
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
            Card c = Cards.New("git commit -m \"x\\y\"\n第二行\t带tab", "test");
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
            Card old = Cards.New("old cmd", "t");
            old.LastUsedAt = new DateTime(2026, 1, 1);
            Card nowCard = Cards.New("now cmd", "t");
            nowCard.LastUsedAt = DateTime.Now;
            Card never = Cards.New("never cmd", "t");
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
            lib.Add(Cards.New("npm run dev", "history"));
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
