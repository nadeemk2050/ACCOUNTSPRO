import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Megaphone, Sparkles, Clock } from 'lucide-react';
import { CHANGELOG, CHANGE_KINDS, TOTAL_CHANGE_COUNT } from './changelog';

/**
 * WhatsNewTab
 * ---------------------------------------------------------------------------
 * "What's added / updated in the new version" — a plain, read-only list of the
 * release notes kept in ./changelog.js.
 *
 * Same design rule as the rest of the support centre: this component is blind.
 * It reads a static text file only. No database, no company data, no props with
 * business information, and it cannot change anything.
 */

const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const EntryCard = ({ entry, isLatest, expanded, onToggle }) => {
    const chip = entry.pending
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    const chipLabel = entry.pending ? 'In testing' : isLatest ? 'Latest version' : 'Released';
    const items = entry.items || [];

    return (
        <div
            className={`overflow-hidden rounded-lg border bg-white transition-shadow ${isLatest
                ? 'border-[#005ea8]/40 shadow-[0_1px_10px_rgba(0,94,168,0.10)]'
                : 'border-slate-200'}`}
        >
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50/70"
            >
                <span className="mt-0.5 shrink-0 text-slate-400">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>

                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-black tracking-wide ${isLatest && !entry.pending
                            ? 'bg-[#005ea8] text-white'
                            : 'bg-slate-800 text-white'}`}>
                            v{entry.version}
                        </span>
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${chip}`}>
                            {entry.pending ? <Clock size={9} className="mr-0.5 inline" /> : null}
                            {chipLabel}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">{formatDate(entry.date)}</span>
                        {items.length > 0 && (
                            <span className="ml-auto text-[9px] font-black uppercase tracking-wide text-slate-400">
                                {items.length} change{items.length > 1 ? 's' : ''}
                            </span>
                        )}
                    </span>
                    <span className="mt-1 block text-[12.5px] font-black leading-snug text-slate-800">
                        {entry.title}
                    </span>
                </span>
            </button>

            {expanded && items.length > 0 && (
                <ul className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
                    {items.map((it, i) => {
                        const meta = CHANGE_KINDS[it.kind] || CHANGE_KINDS.improve;
                        return (
                            <li key={i} className="flex gap-2">
                                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                                <div className="min-w-0">
                                    <span className={`mr-1.5 inline-block rounded border px-1 py-0.5 align-[1px] text-[8.5px] font-black uppercase tracking-wide ${meta.chip}`}>
                                        {meta.label}
                                    </span>
                                    <span className="text-[11.5px] font-semibold leading-relaxed text-slate-600">
                                        {it.text}
                                    </span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

const WhatsNewTab = () => {
    // Newest entry starts open, everything older starts collapsed.
    const [openVersions, setOpenVersions] = useState(() => (CHANGELOG.length ? [CHANGELOG[0].version] : []));

    const latestReleased = useMemo(() => CHANGELOG.find((e) => !e.pending) || CHANGELOG[0] || null, []);

    const toggle = (version) => {
        setOpenVersions((prev) =>
            prev.includes(version) ? prev.filter((v) => v !== version) : [...prev, version]
        );
    };

    const expandAll = () => setOpenVersions(CHANGELOG.map((e) => e.version));
    const collapseAll = () => setOpenVersions([]);

    return (
        <div className="mx-auto w-full max-w-none space-y-3 pb-6">
            {/* Header banner */}
            <div className="rounded-lg border border-[#005ea8]/20 bg-gradient-to-r from-[#e8f2fb] to-white px-3 py-2.5">
                <div className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-md bg-[#005ea8] p-1.5 text-white">
                        <Megaphone size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[#00457c]">
                            What&apos;s added or updated
                        </div>
                        <p className="mt-1 text-[11.5px] font-semibold leading-relaxed text-slate-600">
                            Every release is listed here, newest first.
                            {latestReleased ? (
                                <> You are on <span className="font-black text-slate-800">v{latestReleased.version}</span> — {latestReleased.title}.</>
                            ) : null}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9.5px] font-bold text-slate-500">
                            <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">
                                {CHANGELOG.length} versions
                            </span>
                            <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">
                                {TOTAL_CHANGE_COUNT} changes
                            </span>
                            <button
                                type="button"
                                onClick={expandAll}
                                className="rounded bg-white px-1.5 py-0.5 font-black uppercase tracking-wide text-[#005ea8] ring-1 ring-[#005ea8]/30 hover:bg-[#e8f2fb]"
                            >
                                Expand all
                            </button>
                            <button
                                type="button"
                                onClick={collapseAll}
                                className="rounded bg-white px-1.5 py-0.5 font-black uppercase tracking-wide text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
                            >
                                Collapse all
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-1.5 px-1">
                {Object.entries(CHANGE_KINDS).map(([key, meta]) => (
                    <span key={key} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-wide ${meta.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                    </span>
                ))}
            </div>

            {/* Entries */}
            {CHANGELOG.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center">
                    <Sparkles size={18} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-[11.5px] font-bold text-slate-500">No release notes yet.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {CHANGELOG.map((entry, idx) => {
                        const isLatest = idx === 0;
                        return (
                            <EntryCard
                                key={entry.version}
                                entry={entry}
                                isLatest={isLatest}
                                expanded={openVersions.includes(entry.version)}
                                onToggle={() => toggle(entry.version)}
                            />
                        );
                    })}
                </div>
            )}

            <p className="px-1 pt-1 text-[9.5px] font-semibold leading-relaxed text-slate-400">
                Only the newest release is shown open. Click any older version to read what changed in it.
            </p>
        </div>
    );
};

export default WhatsNewTab;
