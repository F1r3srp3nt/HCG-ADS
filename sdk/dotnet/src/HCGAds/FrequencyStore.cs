using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace HCG.Ads
{
    /// <summary>
    /// Privacy-preserving frequency limits. Counters never leave the device; only the ids of campaigns
    /// that reached their limit are sent (as <c>exclude</c>).
    /// </summary>
    public interface IFrequencyStore
    {
        void Record(string campaignId, FrequencyRule? rule, DateTimeOffset now);
        IReadOnlyList<string> Capped(DateTimeOffset now);
        /// <summary>Storage consent changed. Withdrawing it forgets what was stored on the device.</summary>
        void SetPersistent(bool persistent);
    }

    internal sealed class FrequencyEntry
    {
        public int N { get; set; }
        public double W { get; set; }
        public List<double> T { get; set; } = new List<double>();
    }

    /// <summary>
    /// Keeps counters in memory, and — only with storage consent — in a JSON file.
    /// Pass <c>filePath: null</c> for memory only.
    /// </summary>
    public sealed class FrequencyStore : IFrequencyStore
    {
        private readonly object _lock = new object();
        private readonly string? _filePath;
        private Dictionary<string, FrequencyEntry> _memory = new Dictionary<string, FrequencyEntry>();
        private bool _persistent;

        public FrequencyStore(string? filePath = null, bool persistent = false)
        {
            _filePath = filePath;
            _persistent = persistent;
        }

        public void SetPersistent(bool persistent)
        {
            lock (_lock)
            {
                if (_persistent && !persistent && _filePath != null)
                {
                    try { File.Delete(_filePath); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
                _persistent = persistent;
            }
        }

        public void Record(string campaignId, FrequencyRule? rule, DateTimeOffset now)
        {
            if (rule == null || rule.Count <= 0) return;
            lock (_lock)
            {
                var table = Prune(Read(), now);
                if (!table.TryGetValue(campaignId, out var entry)) entry = new FrequencyEntry();
                entry.N = rule.Count;
                entry.W = rule.WindowHours;
                entry.T.Add(now.ToUnixTimeMilliseconds() / 1000.0);
                if (entry.T.Count > 200) entry.T = entry.T.Skip(entry.T.Count - 200).ToList();
                table[campaignId] = entry;
                Write(table);
            }
        }

        public IReadOnlyList<string> Capped(DateTimeOffset now)
        {
            lock (_lock)
            {
                var table = Prune(Read(), now);
                Write(table);
                return table.Where(kv => kv.Value.T.Count >= kv.Value.N).Select(kv => kv.Key).OrderBy(k => k, StringComparer.Ordinal).ToList();
            }
        }

        private Dictionary<string, FrequencyEntry> Read()
        {
            if (!_persistent || _filePath == null) return _memory;
            try
            {
                if (!File.Exists(_filePath)) return new Dictionary<string, FrequencyEntry>();
                return JsonSerializer.Deserialize<Dictionary<string, FrequencyEntry>>(File.ReadAllText(_filePath)) ?? new Dictionary<string, FrequencyEntry>();
            }
            catch (Exception e) when (e is IOException || e is JsonException || e is UnauthorizedAccessException)
            {
                return new Dictionary<string, FrequencyEntry>();
            }
        }

        private void Write(Dictionary<string, FrequencyEntry> table)
        {
            if (!_persistent || _filePath == null) { _memory = table; return; }
            try
            {
                var dir = Path.GetDirectoryName(_filePath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var tmp = _filePath + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(table));
                if (File.Exists(_filePath)) File.Delete(_filePath);
                File.Move(tmp, _filePath);
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                _memory = table; // storage failures never break delivery
            }
        }

        private static Dictionary<string, FrequencyEntry> Prune(Dictionary<string, FrequencyEntry> table, DateTimeOffset now)
        {
            var nowS = now.ToUnixTimeMilliseconds() / 1000.0;
            var output = new Dictionary<string, FrequencyEntry>();
            foreach (var kv in table)
            {
                var since = nowS - kv.Value.W * 3600;
                var kept = kv.Value.T.Where(t => t > since && t <= nowS + 60).ToList();
                if (kept.Count > 0) output[kv.Key] = new FrequencyEntry { N = kv.Value.N, W = kv.Value.W, T = kept };
            }
            return output;
        }
    }
}
