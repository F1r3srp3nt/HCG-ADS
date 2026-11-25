import Foundation

/// Privacy-preserving frequency limits. Counters never leave the device; only the
/// ids of campaigns that reached their limit are sent (as `exclude`).
/// With storage consent they persist in UserDefaults; otherwise they live in memory
/// for the lifetime of the process only.
public final class FrequencyStore: @unchecked Sendable {
    public static let defaultsKey = "hcg-ads.frequency"

    private struct Entry: Codable { var n: Int; var w: Double; var t: [Double] }

    private let lock = NSLock()
    private let defaults: UserDefaults?
    private var memory: [String: Entry] = [:]
    private var persistent: Bool

    public init(defaults: UserDefaults? = .standard, persistent: Bool = false) {
        self.defaults = defaults
        self.persistent = persistent
    }

    /// Storage consent changed. Withdrawing it forgets what was stored on the device.
    public func setPersistent(_ value: Bool) {
        lock.lock(); defer { lock.unlock() }
        if persistent && !value { defaults?.removeObject(forKey: Self.defaultsKey) }
        persistent = value
    }

    public func record(campaignId: String, rule: FrequencyRule?, now: Date = Date()) {
        guard let rule else { return }
        lock.lock(); defer { lock.unlock() }
        var table = prune(read(), now: now)
        var entry = table[campaignId] ?? Entry(n: rule.count, w: rule.windowHours, t: [])
        entry.n = rule.count
        entry.w = rule.windowHours
        entry.t = Array((entry.t + [now.timeIntervalSince1970]).suffix(200))
        table[campaignId] = entry
        write(table)
    }

    /// Campaign ids that reached their limit within their window, sorted.
    public func capped(now: Date = Date()) -> [String] {
        lock.lock(); defer { lock.unlock() }
        let table = prune(read(), now: now)
        write(table)
        return table.filter { $0.value.t.count >= $0.value.n }.map(\.key).sorted()
    }

    private func read() -> [String: Entry] {
        guard persistent else { return memory }
        guard let data = defaults?.data(forKey: Self.defaultsKey),
              let table = try? JSONDecoder().decode([String: Entry].self, from: data) else { return [:] }
        return table
    }

    private func write(_ table: [String: Entry]) {
        guard persistent, let defaults else { memory = table; return }
        if let data = try? JSONEncoder().encode(table) { defaults.set(data, forKey: Self.defaultsKey) }
    }

    private func prune(_ table: [String: Entry], now: Date) -> [String: Entry] {
        let nowS = now.timeIntervalSince1970
        var out: [String: Entry] = [:]
        for (id, e) in table {
            let since = nowS - e.w * 3600
            let kept = e.t.filter { $0 > since && $0 <= nowS + 60 }
            if !kept.isEmpty { out[id] = Entry(n: e.n, w: e.w, t: kept) }
        }
        return out
    }
}
