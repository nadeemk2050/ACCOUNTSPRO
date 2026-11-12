/**
 * safeStorage.js
 * ------------------------------------------------------------------
 * Central, crash-proof localStorage access for ACCPRO.
 *
 * WHY THIS EXISTS
 * ---------------
 * localStorage has a ~5 MB hard limit per origin. When it fills up every
 * `localStorage.setItem(...)` throws `QuotaExceededError`. That used to break
 * real features:
 *   - "Failed to execute 'setItem' on 'Storage': Setting the value of
 *     'accpro_session_<companyId>' exceeded the quota."  -> the user could not
 *     sign in to the company at all, even with correct credentials.
 *   - "Storage quota exceeded, could not acquire localStorage lock" -> live
 *     sync silently stopped running.
 *   - the pull cursor write failed -> the app skipped vouchers on the next
 *     reload (data appeared "missing" from the cloud).
 *
 * RULES
 * -----
 *  1. Nothing in this module ever throws.
 *  2. On a quota failure we free *disposable* data first (sync history, stats,
 *     transient flags, stale pull cursors) and retry. We NEVER delete the
 *     licence, the session or the active company pointer.
 *  3. If even that fails the value is kept in memory for this tab, so the
 *     feature still works until the user reloads.
 */

const MEM = new Map();

/* Keys we may delete, cheapest-to-lose first. */
const TIER1_PREFIXES = [
    'accpro_sync_history',
    'accgripped_sync_history',
    'accpro_excel_batch_history',
    'accgripped_excel_batch_history',
    'accpro_backup_history',
    'accgripped_backup_history',
    'accpro_stats_',
    'accgripped_stats_',
    'accpro_sync_status_',
    'accgripped_sync_status_',
    'accpro_live_reg_',
    'accgripped_live_reg_',
    'quickaccpro_cached_',
    'qapd_favorite_',
    'qapd_sub_user',
];

/* Losing these costs a re-scan / a re-acquired lock — acceptable, but only
   after tier 1 has been emptied. */
const TIER2_PREFIXES = [
    'nadtally_last_pull_',
    'accpro_last_pull_',
    'accgripped_last_pull_',
    'accpro_sync_lock_',
    'accgripped_sync_lock_',
];

/* Never delete, whatever the tier says. */
const PROTECTED_EXACT = new Set([
    'nadtally_device_id',
    'accgripped_device_id',
    'nadtally_auth_history',
    'accgripped_auth_history',
    'activeCompanyId',
    'accgripped_activeCompanyId',
    'favActions',
]);
const PROTECTED_PATTERN = /session|licen[cs]e|offline_backup|guest_info|pass_hash|password/i;

let reclaimNoticeShown = false;

function storage() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch (_e) {
        return null;
    }
}

function isProtected(key) {
    if (!key) return true;
    if (PROTECTED_EXACT.has(key)) return true;
    return PROTECTED_PATTERN.test(key);
}

function matchesAnyPrefix(key, prefixes) {
    for (const p of prefixes) {
        if (key === p || key.startsWith(p)) return true;
    }
    return false;
}

function trySet(key, value) {
    const ls = storage();
    if (!ls) return false;
    try {
        ls.setItem(key, value);
        return true;
    } catch (_e) {
        return false;
    }
}

function freePrefixes(prefixes) {
    const ls = storage();
    if (!ls) return 0;
    let freed = 0;
    const doomed = [];
    try {
        for (let i = 0; i < ls.length; i += 1) {
            const k = ls.key(i);
            if (!k || isProtected(k)) continue;
            if (!matchesAnyPrefix(k, prefixes)) continue;
            doomed.push(k);
        }
    } catch (_e) {
        return 0;
    }
    for (const k of doomed) {
        try {
            const size = (ls.getItem(k) || '').length;
            ls.removeItem(k);
            freed += size;
        } catch (_e) {
            /* ignore */
        }
    }
    return freed;
}

/** Human readable dump of the biggest localStorage entries — helps diagnosis. */
export function storageReport() {
    const ls = storage();
    const entries = [];
    let total = 0;
    if (ls) {
        try {
            for (let i = 0; i < ls.length; i += 1) {
                const k = ls.key(i);
                if (!k) continue;
                const bytes = (ls.getItem(k) || '').length;
                total += bytes;
                entries.push({ key: k, bytes });
            }
        } catch (_e) {
            /* ignore */
        }
    }
    entries.sort((a, b) => b.bytes - a.bytes);
    return { total, count: entries.length, entries };
}

/** Delete disposable data. Returns number of characters freed. */
export function reclaimSpace({ includeTier2 = false, evictLargest = 0 } = {}) {
    let freed = freePrefixes(TIER1_PREFIXES);
    if (includeTier2) freed += freePrefixes(TIER2_PREFIXES);
    if (evictLargest > 0) freed += freeLargest(evictLargest);
    if (freed > 0 && !reclaimNoticeShown) {
        reclaimNoticeShown = true;
        try {
            const rep = storageReport();
            console.warn(
                `[STORAGE] localStorage was full. Freed ${freed} chars of disposable cache. ` +
                `Now ${rep.total} chars in ${rep.count} keys. Biggest:`,
                rep.entries.slice(0, 8)
            );
        } catch (_e) { /* ignore */ }
    }
    return freed;
}

/**
 * Last-resort eviction: drop the biggest unprotected entries until `targetChars`
 * have been freed. Everything this app stores besides the licence / session /
 * device / active-company pointer is regenerable cache or a UI preference, so
 * losing the largest such key is always better than the app refusing to log in
 * or to sync.
 */
function freeLargest(targetChars) {
    const ls = storage();
    if (!ls || targetChars <= 0) return 0;
    let freed = 0;
    try {
        const candidates = [];
        for (let i = 0; i < ls.length; i += 1) {
            const k = ls.key(i);
            if (!k || isProtected(k)) continue;
            candidates.push({ key: k, bytes: (ls.getItem(k) || '').length });
        }
        candidates.sort((a, b) => b.bytes - a.bytes);
        for (const entry of candidates) {
            if (freed >= targetChars) break;
            // Never evict tiny preference keys unless we truly have to.
            try {
                ls.removeItem(entry.key);
                freed += entry.bytes;
            } catch (_e) { /* ignore */ }
        }
    } catch (_e) {
        return freed;
    }
    return freed;
}

export function safeGetItem(key) {
    if (MEM.has(key)) return MEM.get(key);
    const ls = storage();
    if (!ls) return null;
    try {
        return ls.getItem(key);
    } catch (_e) {
        return null;
    }
}

/**
 * Write a key. Returns true when it really landed in localStorage,
 * false when only memory could hold it. Never throws.
 */
export function safeSetItem(key, value) {
    const str = typeof value === 'string' ? value : String(value);
    if (trySet(key, str)) {
        MEM.delete(key);
        return true;
    }
    // 1st attempt: blow away cheap caches and retry.
    reclaimSpace();
    if (trySet(key, str)) {
        MEM.delete(key);
        return true;
    }
    // 2nd attempt: also drop stale cursors / locks.
    reclaimSpace({ includeTier2: true });
    if (trySet(key, str)) {
        MEM.delete(key);
        return true;
    }
    // 3rd attempt: evict the largest remaining unprotected entries. This is what
    // saves the login when some legacy/unknown key is hogging the whole quota.
    reclaimSpace({ includeTier2: true, evictLargest: str.length + 2048 });
    if (trySet(key, str)) {
        MEM.delete(key);
        return true;
    }
    // Give up on persistence, keep it for this tab so the feature still works.
    MEM.set(key, str);
    console.warn(`[STORAGE] Could not persist '${key}' (quota full). Held in memory for this session only.`);
    return false;
}

export function safeRemoveItem(key) {
    MEM.delete(key);
    const ls = storage();
    if (!ls) return;
    try {
        ls.removeItem(key);
    } catch (_e) {
        /* ignore */
    }
}

/** Expose a manual cleanup hook for debugging from the console. */
if (typeof window !== 'undefined') {
    window.accproStorage = {
        report: storageReport,
        clean: () => reclaimSpace({ includeTier2: true }),
    };

    // One-time diagnostic: if localStorage is already close to full, tell us
    // exactly which keys are eating the space. This is how we identify legacy
    // leftovers from older builds that never got cleaned up.
    try {
        const rep = storageReport();
        if (rep.total > 3_000_000) {
            console.warn(
                `[STORAGE] localStorage is ${(rep.total / 1024).toFixed(0)} KB used across ${rep.count} keys. Biggest entries:`,
                rep.entries.slice(0, 10)
            );
        }
    } catch (_e) { /* ignore */ }
}

export default {
    getItem: safeGetItem,
    setItem: safeSetItem,
    removeItem: safeRemoveItem,
    report: storageReport,
    reclaimSpace,
};
