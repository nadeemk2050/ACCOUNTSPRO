import React, { useMemo, useState } from 'react';
import {
    Lightbulb, Check, AlertCircle, Trash2, Download, Copy, User, Mail, MessageSquare,
    ChevronRight, PlayCircle, ShieldCheck,
} from 'lucide-react';
import { FEATURE_CATEGORIES } from './featureCatalogue';
import { analyzeSuggestion } from './suggestionCheck';
import {
    loadSuggestions, saveSuggestion, deleteSuggestion, suggestionsToText, downloadSuggestions,
} from './suggestionStore';

/**
 * SuggestTab
 * ---------------------------------------------------------------------------
 * Lets a user write an idea and keeps it with their name and email.
 *
 * Before saving, the idea is compared with the existing help library:
 *   - if the app can already do it, it says so and shows the feature/answer
 *   - if it is genuinely new, it is saved
 *
 * Nothing here touches company data, and nothing is uploaded anywhere. The
 * message says so plainly, and the list can be copied or downloaded so it can
 * be sent by email/WhatsApp without any server existing.
 */

const VERDICT = {
    existing: { label: 'Already in the app', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    related: { label: 'Similar exists', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
    new: { label: 'New idea', cls: 'border-[#2b5797]/30 bg-[#eaf2fd] text-[#2b5797]' },
    '': { label: 'Saved', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
};

const SuggestTab = ({ onGuide }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [area, setArea] = useState('');
    const [text, setText] = useState('');
    const [check, setCheck] = useState(null); // analysis awaiting confirmation
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [list, setList] = useState(() => loadSuggestions());

    const total = list.length;

    const resetForm = () => {
        setName('');
        setEmail('');
        setArea('');
        setText('');
        setCheck(null);
    };

    const doSave = (verdict, matchedIds) => {
        const res = saveSuggestion({ name, email, text, category: area, verdict, matchedIds });
        if (!res.ok) {
            setError(res.error || 'Could not save.');
            return;
        }
        setList(loadSuggestions());
        resetForm();
        setError('');
        setNotice('Saved on this device. Thank you — this is exactly how the help library grows.');
        setTimeout(() => setNotice(''), 6000);
    };

    const onSubmit = () => {
        setError('');
        setNotice('');
        if (!name.trim()) return setError('Please enter your name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError('Please enter a valid email address.');
        if (text.trim().length < 15) return setError('Please describe the idea in a little more detail (15 characters or more).');

        const analysis = analyzeSuggestion(text);
        if (analysis.verdict === 'new') {
            doSave('new', analysis.matchedIds);
            return;
        }
        setCheck(analysis);
    };

    const remove = (id) => {
        deleteSuggestion(id);
        setList(loadSuggestions());
        setNotice('Removed.');
        setTimeout(() => setNotice(''), 3000);
    };

    const copyAll = () => {
        try {
            navigator.clipboard.writeText(suggestionsToText(list));
            setNotice('All suggestions copied — paste them into an email to support.');
            setTimeout(() => setNotice(''), 5000);
        } catch {
            setError('Clipboard is blocked by the browser. Use Download instead.');
        }
    };

    const matched = useMemo(() => {
        if (!check) return [];
        return [
            ...(check.features || []).map((f) => ({ kind: 'feature', id: f.id, title: f.name, sub: f.where, feature: f })),
            ...(check.faqs || []).map((f) => ({ kind: 'faq', id: f.id, title: f.q, sub: f.a })),
        ];
    }, [check]);

    return (
        <div className="mx-auto w-full max-w-4xl space-y-3">
            {/* ── form ─────────────────────────────────────────────── */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start gap-2">
                    <div className="mt-0.5 rounded-lg bg-amber-100 p-1.5 text-amber-700">
                        <Lightbulb size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-black text-slate-800">Suggest a feature or an improvement</div>
                        <div className="text-[10px] font-semibold text-slate-500">
                            Tell us what would make your work faster. It is saved with your name and email so the idea can be traced back to you.
                        </div>
                    </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <label className="block">
                        <span className="mb-0.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                            <User size={10} /> Your name
                        </span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Ariful Islam"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-700 outline-none focus:border-[#2b5797]"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-0.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                            <Mail size={10} /> Email address
                        </span>
                        <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="e.g. ariful@gmail.com"
                            inputMode="email"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-700 outline-none focus:border-[#2b5797]"
                        />
                    </label>
                </div>

                <label className="mt-2 block">
                    <span className="mb-0.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                        <MessageSquare size={10} /> Area (optional)
                    </span>
                    <select
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-700 outline-none focus:border-[#2b5797]"
                    >
                        <option value="">— choose if you know —</option>
                        {FEATURE_CATEGORIES.map((c) => (
                            <option key={c.id} value={c.title}>{c.title}</option>
                        ))}
                    </select>
                </label>

                <label className="mt-2 block">
                    <span className="mb-0.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                        <Lightbulb size={10} /> Your idea
                    </span>
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={3}
                        placeholder="e.g. In the payment voucher, let me attach a photo of the bill and see it later from the voucher."
                        className="w-full resize-y rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-700 outline-none focus:border-[#2b5797]"
                    />
                </label>

                {error && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700">
                        <AlertCircle size={11} /> {error}
                    </div>
                )}
                {notice && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700">
                        <Check size={11} /> {notice}
                    </div>
                )}

                {/* ── duplicate / already-exists panel ─────────────── */}
                {check && (
                    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50/70 p-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
                            <AlertCircle size={11} />
                            {check.verdict === 'existing' ? 'ACCPRO may already do this' : 'Something similar already exists'}
                        </div>
                        <p className="mt-1 text-[11px] font-semibold text-slate-700">
                            Please check these before saving — if one of them is your idea, there is nothing to add.
                        </p>
                        <div className="mt-1.5 space-y-1">
                            {matched.map((m) => (
                                <div key={m.id} className="rounded-md border border-amber-200 bg-white px-2 py-1.5">
                                    <div className="flex items-center gap-1 text-[11px] font-black text-slate-800">
                                        <ChevronRight size={10} className="text-amber-600" />
                                        {m.title}
                                    </div>
                                    <div className="line-clamp-2 pl-3 text-[10px] font-semibold text-slate-500">{m.sub}</div>
                                    {m.kind === 'feature' && m.feature && (m.feature.steps || []).length > 0 && onGuide && (
                                        <button
                                            type="button"
                                            onClick={() => onGuide(m.feature)}
                                            className="mt-1 ml-3 inline-flex items-center gap-1 rounded-md bg-[#2b5797] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264]"
                                        >
                                            <PlayCircle size={10} /> Show me how
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => doSave(check.verdict, check.matchedIds)}
                                className="rounded-md bg-amber-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white hover:bg-amber-700"
                            >
                                Mine is different — save it
                            </button>
                            <button
                                type="button"
                                onClick={() => setCheck(null)}
                                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
                            >
                                Not this — keep editing
                            </button>
                        </div>
                    </div>
                )}

                {!check && (
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 text-[9px] font-semibold text-slate-400">
                            <ShieldCheck size={10} /> Saved on this device only · nothing is uploaded
                        </span>
                        <button
                            type="button"
                            onClick={onSubmit}
                            className="rounded-lg bg-[#2b5797] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264] transition-colors"
                        >
                            Check &amp; save idea
                        </button>
                    </div>
                )}
            </div>

            {/* ── saved list ───────────────────────────────────────── */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Saved on this device ({total})
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={copyAll}
                            disabled={!total}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500 hover:border-[#2b5797] hover:text-[#2b5797] disabled:opacity-40"
                        >
                            <Copy size={10} /> Copy all
                        </button>
                        <button
                            type="button"
                            onClick={() => downloadSuggestions(list)}
                            disabled={!total}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500 hover:border-[#2b5797] hover:text-[#2b5797] disabled:opacity-40"
                        >
                            <Download size={10} /> Download
                        </button>
                    </div>
                </div>

                {!total && (
                    <div className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[11px] font-semibold text-slate-500">
                        No suggestions yet. The first one you save will appear here.
                    </div>
                )}

                <div className="mt-2 space-y-1.5">
                    {list.map((s) => {
                        const v = VERDICT[s.verdict] || VERDICT[''];
                        return (
                            <div key={s.id} className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] font-black text-slate-800">{s.name}</span>
                                    <span className="text-[10px] font-semibold text-slate-500">{s.email}</span>
                                    <span className={`rounded border px-1 py-0.5 text-[8px] font-black uppercase tracking-wide ${v.cls}`}>
                                        {v.label}
                                    </span>
                                    {s.category && (
                                        <span className="rounded bg-slate-200 px-1 py-0.5 text-[8px] font-black uppercase tracking-wide text-slate-600">
                                            {s.category}
                                        </span>
                                    )}
                                    <span className="ml-auto text-[9px] font-bold text-slate-400">{s.date}</span>
                                    <button
                                        type="button"
                                        onClick={() => remove(s.id)}
                                        className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                        title="Delete this suggestion"
                                    >
                                        <Trash2 size={11} />
                                    </button>
                                </div>
                                <div className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-700">{s.text}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default SuggestTab;
