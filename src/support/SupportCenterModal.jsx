import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    X, Search, LifeBuoy, BookOpen, MessageCircle, ChevronDown, ChevronRight,
    Copy, Check, AlertCircle, Sparkles, ListChecks, ArrowRight, ThumbsUp, ThumbsDown,
    PlayCircle, Square, ArrowLeft as ArrowLeftIcon,
} from 'lucide-react';
import { FEATURE_CATEGORIES, ALL_FEATURES } from './featureCatalogue';
import { FAQ_DATA, FAQ_CATEGORIES } from './faqData';
import { primeSearchIndex, searchFaq, searchFeatures, route, tokenize } from './faqSearch';
import { allFaqs, deleteLearnedFaq } from './faqStore';
import ChatTab from './ChatTab';
import SuggestTab from './SuggestTab';

/**
 * SupportCenterModal
 * ---------------------------------------------------------------------------
 * Guidance ONLY. This component is intentionally "blind" and "read-only":
 *   - it imports no database, no Firestore, no company state
 *   - it receives no company data as props
 *   - it cannot create, edit or delete anything
 * The only things it knows are the static feature catalogue and the saved FAQ
 * text. That is a deliberate design rule, not an accident.
 *
 * Tabs
 *   Features : every capability, grouped, searchable, with steps
 *   FAQ      : the saved answers (served first, cost 0, works offline)
 *   Ask      : chat box that routes confident questions to saved answers and
 *              only *offers* to escalate to AI when nothing matches
 */

const TABS = [
    { id: 'features', label: 'Features', icon: ListChecks },
    { id: 'faq', label: 'FAQ', icon: BookOpen },
    { id: 'chat', label: 'Assistant', icon: MessageCircle },
    { id: 'suggest', label: 'Suggestions', icon: Sparkles },
];

const Highlight = ({ text, query }) => {
    const tokens = useMemo(() => tokenize(query), [query]);
    if (!tokens.length) return <>{text}</>;
    // Build a simple regex of the matched words (safe: tokens are letters/digits only)
    const pattern = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = String(text).split(pattern);
    return (
        <>
            {parts.map((part, i) =>
                pattern.test(part) && tokens.some((t) => part.toLowerCase().startsWith(t.slice(0, 4)))
                    ? <mark key={i} className="bg-amber-200/70 text-slate-900 rounded px-0.5">{part}</mark>
                    : <span key={i}>{part}</span>
            )}
        </>
    );
};

const CopyButton = ({ text, label = 'Copy' }) => {
    const [done, setDone] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setDone(true);
                    setTimeout(() => setDone(false), 1500);
                } catch (_e) {
                    /* clipboard blocked — ignore */
                }
            }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50 transition-colors"
            title="Copy"
        >
            {done ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
            {done ? 'Copied' : label}
        </button>
    );
};

/* ─────────────────────────── Feature tab ─────────────────────────── */

const FeatureCard = ({ feature, query, defaultOpen }) => {
    const [open, setOpen] = useState(!!defaultOpen);
    return (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
            >
                {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />}
                <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-black text-slate-800 leading-tight">
                        <Highlight text={feature.name} query={query} />
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[#2b5797]">
                        <ArrowRight size={10} className="shrink-0" />
                        <span className="truncate"><Highlight text={feature.where} query={query} /></span>
                    </span>
                </span>
            </button>
            {open && (
                <div className="border-t border-slate-100 px-3 py-2 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-600 leading-relaxed">
                        <Highlight text={feature.what} query={query} />
                    </p>
                    {(feature.steps || []).length > 0 && (
                        <ol className="space-y-1 pl-4 list-decimal marker:text-[#2b5797] marker:font-black">
                            {feature.steps.map((s, i) => (
                                <li key={i} className="text-[11px] text-slate-600 leading-relaxed">
                                    <Highlight text={s} query={query} />
                                </li>
                            ))}
                        </ol>
                    )}
                    {(feature.tags || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                            {feature.tags.slice(0, 8).map((t, i) => (
                                <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">{t}</span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const FeaturesTab = ({ query, setQuery }) => {
    const [openCat, setOpenCat] = useState('start');

    const results = useMemo(() => {
        if (!query.trim()) return null;
        return searchFeatures(query, { limit: 40 }).map((r) => r.item);
    }, [query]);

    return (
        <div className="space-y-3">
            {results ? (
                <>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {results.length} feature{results.length === 1 ? '' : 's'} found
                    </div>
                    {results.length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[11px] font-semibold text-slate-500">
                            Nothing matched. Try a different word, or use the Ask tab.
                        </div>
                    )}
                    <div className="space-y-1.5">
                        {results.map((f) => <FeatureCard key={f.id} feature={f} query={query} defaultOpen />)}
                    </div>
                </>
            ) : (
                FEATURE_CATEGORIES.map((cat) => {
                    const open = openCat === cat.id;
                    return (
                        <div key={cat.id} className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50/60">
                            <button
                                type="button"
                                onClick={() => setOpenCat(open ? '' : cat.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left bg-white hover:bg-slate-50 transition-colors"
                            >
                                {open ? <ChevronDown size={14} className="text-[#2b5797]" /> : <ChevronRight size={14} className="text-slate-400" />}
                                <span className="flex-1 min-w-0">
                                    <span className="block text-[12px] font-black text-slate-800 leading-tight">{cat.title}</span>
                                    <span className="block text-[10px] font-semibold text-slate-400">{cat.blurb}</span>
                                </span>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">{cat.features.length}</span>
                            </button>
                            {open && (
                                <div className="space-y-1.5 p-2 border-t border-slate-200">
                                    {cat.features.map((f) => <FeatureCard key={f.id} feature={f} query={query} />)}
                                </div>
                            )}
                        </div>
                    );
                })
            )}
        </div>
    );
};

/* ─────────────────────────── FAQ tab ─────────────────────────── */

const FaqCard = ({ faq, query, defaultOpen, onGuide, onForget }) => {
    const [open, setOpen] = useState(!!defaultOpen);
    const [vote, setVote] = useState(null);
    const feature = ALL_FEATURES.find((f) => f.id === faq.featureId);
    const learned = faq.source === 'ai';
    return (
        <div className={`rounded-lg border bg-white overflow-hidden ${learned ? 'border-violet-200' : 'border-slate-200'}`}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
            >
                {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />}
                <span className="min-w-0 flex-1 text-[12px] font-black text-slate-800 leading-tight">
                    <Highlight text={faq.q} query={query} />
                </span>
                {learned && (
                    <span className="mt-0.5 shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-700">
                        learned
                    </span>
                )}
            </button>
            {open && (
                <div className="border-t border-slate-100 px-3 py-2 space-y-2">
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                        <Highlight text={faq.a} query={query} />
                    </p>

                    {feature && (
                        <div className="rounded-md bg-[#eaf2fd] border border-[#c9dcf3] px-2 py-1.5">
                            <div className="text-[9px] font-black uppercase tracking-widest text-[#2b5797]/70">Where to find it</div>
                            <div className="text-[10px] font-bold text-[#1e3264]">{feature.where}</div>
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Was this helpful?</span>
                            <button
                                type="button"
                                onClick={() => setVote('up')}
                                className={`rounded p-1 transition-colors ${vote === 'up' ? 'bg-emerald-100 text-emerald-700' : 'text-slate-300 hover:text-emerald-600'}`}
                                title="Yes"
                            >
                                <ThumbsUp size={12} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setVote('down')}
                                className={`rounded p-1 transition-colors ${vote === 'down' ? 'bg-rose-100 text-rose-700' : 'text-slate-300 hover:text-rose-600'}`}
                                title="No"
                            >
                                <ThumbsDown size={12} />
                            </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                            {feature && onGuide && (feature.steps || []).length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => onGuide(feature)}
                                    className="inline-flex items-center gap-1 rounded-md border border-[#2b5797]/40 bg-[#eaf2fd] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#2b5797] hover:bg-[#dbe9fa] transition-colors"
                                    title={`Walk me through: ${feature.name}`}
                                >
                                    <PlayCircle size={11} /> Guide me
                                </button>
                            )}
                            <CopyButton text={`${faq.q}\n\n${faq.a}`} label="Copy" />
                            {learned && onForget && (
                                <button
                                    type="button"
                                    onClick={() => onForget(faq.id)}
                                    className="rounded px-1.5 py-1 text-[9px] font-black uppercase tracking-wide text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                    title="Forget this AI answer"
                                >
                                    Forget
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const FaqTab = ({ query, setQuery, onGuide, onAskInChat, onForget, version = 0 }) => {
    const [cat, setCat] = useState('');
    const [openId, setOpenId] = useState('');

    const list = useMemo(() => {
        if (query.trim()) return searchFaq(query, { limit: 40 }).map((r) => r.item);
        return FAQ_DATA.filter((f) => !cat || f.category === cat);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, cat, version]);

    // Is the saved library actually confident about this question?
    const routed = useMemo(() => (query.trim().length > 3 ? route(query) : null), [query]);
    const notConfident = !!routed && routed.kind !== 'confident';

    return (
        <div className="space-y-3">
            {!query.trim() && (
                <div className="flex flex-wrap gap-1">
                    <button
                        type="button"
                        onClick={() => setCat('')}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide transition-colors ${!cat ? 'border-[#2b5797] bg-[#2b5797] text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                    >
                        All
                    </button>
                    {FAQ_CATEGORIES.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => setCat(cat === c.id ? '' : c.id)}
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide transition-colors ${cat === c.id ? 'border-[#2b5797] bg-[#2b5797] text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                        >
                            {c.title}
                        </button>
                    ))}
                </div>
            )}

            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {list.length} answer{list.length === 1 ? '' : 's'}
            </div>

            {notConfident && onAskInChat && (
                <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-2.5">
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-widest text-violet-800">
                            No exact answer in the saved list
                        </div>
                        <div className="text-[10px] font-semibold leading-relaxed text-slate-600">
                            Ask the Assistant. If it has to use the AI once, the answer is stored in the help library — next time the
                            same question is answered offline for free.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => onAskInChat(query.trim())}
                        className="shrink-0 rounded-lg bg-[#2b5797] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264] transition-colors"
                    >
                        Ask the Assistant
                    </button>
                </div>
            )}

            <div className="space-y-1.5">
                {list.map((f) => (
                    <FaqCard key={f.id} faq={f} query={query} defaultOpen={openId === f.id} onGuide={onGuide} onForget={onForget} />
                ))}
                {list.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                        <div className="text-[11px] font-bold text-slate-600">No saved answer for that yet.</div>
                        {query.trim() && onAskInChat && (
                            <>
                                <div className="mt-1 text-[10px] font-semibold text-slate-500">
                                    The Assistant can ask the AI and keep the answer here for next time.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onAskInChat(query.trim())}
                                    className="mt-2 rounded-lg bg-[#2b5797] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264] transition-colors"
                                >
                                    Ask the Assistant
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

/* ─────────────────────────── Ask tab ─────────────────────────── */

/**
 * Superseded by the conversational Assistant tab (ChatTab).
 * Kept intact and unreferenced: it is tree-shaken out of the build, costs
 * nothing at runtime, and keeping it means today's change is purely additive.
 */
const AskTab = ({ initialQuestion, onGuide }) => {
    const [input, setInput] = useState(initialQuestion || '');
    const [asked, setAsked] = useState('');
    const [result, setResult] = useState(null);
    const inputRef = useRef(null);

    useEffect(() => {
        if (initialQuestion) {
            setInput(initialQuestion);
            run(initialQuestion);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialQuestion]);

    const run = (q) => {
        const text = String(q || '').trim();
        if (!text) return;
        setAsked(text);
        setResult(route(text));
    };

    const SUGGESTIONS = [
        'How do I add a new ledger?',
        'How do I add an item?',
        'How do I check today vouchers?',
        'How do I make a payment voucher?',
        'How is closing stock calculated?',
    ];

    return (
        <div className="space-y-3">
            {/* Composer */}
            <div className="rounded-xl border border-slate-200 bg-white p-2">
                <div className="flex items-center gap-2">
                    <Search size={14} className="text-slate-400 shrink-0" />
                    <input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') run(input); }}
                        placeholder="Ask how to do something… e.g. where do I add a bank account?"
                        className="flex-1 min-w-0 bg-transparent text-[12px] font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                    />
                    <button
                        type="button"
                        onClick={() => run(input)}
                        className="rounded-lg bg-[#2b5797] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264] transition-colors"
                    >
                        Ask
                    </button>
                </div>
            </div>

            {!asked && (
                <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Common questions</div>
                    <div className="flex flex-wrap gap-1">
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => { setInput(s); run(s); }}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:border-[#2b5797] hover:text-[#2b5797] transition-colors"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {asked && result && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5">
                        <MessageCircle size={12} className="text-slate-400" />
                        <span className="text-[11px] font-bold text-slate-600 truncate">{asked}</span>
                        <button
                            type="button"
                            onClick={() => { setAsked(''); setResult(null); setInput(''); inputRef.current?.focus(); }}
                            className="ml-auto text-[9px] font-black uppercase tracking-wide text-slate-400 hover:text-rose-600"
                        >
                            Clear
                        </button>
                    </div>

                    {result.kind === 'confident' && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                                <Check size={11} /> Saved answer
                            </div>
                            <div className="text-[12px] font-black text-slate-800 leading-tight">{result.best.item.q}</div>
                            <p className="text-[11px] text-slate-700 leading-relaxed">{result.best.item.a}</p>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] font-semibold text-emerald-700">Answered instantly — no AI used.</span>
                                <CopyButton text={`${result.best.item.q}\n\n${result.best.item.a}`} />
                            </div>

                            {(() => {
                                const f = result.best.item.featureId
                                    ? ALL_FEATURES.find((x) => x.id === result.best.item.featureId)
                                    : null;
                                if (!f || (f.steps || []).length === 0 || !onGuide) return null;
                                return (
                                    <div className="rounded-lg border border-[#2b5797]/30 bg-[#eaf2fd] px-2.5 py-2">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-[#2b5797]/80 mb-1">
                                            Shall I walk you through it?
                                        </div>
                                        <div className="text-[10px] font-semibold text-slate-600 mb-1.5">
                                            I can open the screen and point at each step. Nothing is saved or changed.
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => onGuide(f)}
                                                className="inline-flex items-center gap-1 rounded-md bg-[#2b5797] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264] transition-colors"
                                            >
                                                <PlayCircle size={12} /> Yes, guide me
                                            </button>
                                            <span className="text-[9px] font-semibold text-slate-400">or just read the answer above</span>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {result.kind === 'suggest' && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-700">
                                <AlertCircle size={11} /> Did you mean…
                            </div>
                            {result.results.slice(0, 3).map((r) => (
                                <button
                                    key={r.item.id}
                                    type="button"
                                    onClick={() => run(r.item.q)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-[#2b5797] transition-colors"
                                >
                                    <div className="text-[11px] font-black text-slate-800">{r.item.q}</div>
                                    <div className="text-[10px] text-slate-500 line-clamp-2">{r.item.a}</div>
                                </button>
                            ))}
                        </div>
                    )}

                    {result.kind === 'miss' && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-700">
                                <AlertCircle size={11} /> No saved answer yet
                            </div>
                            <p className="text-[11px] text-slate-700 leading-relaxed">
                                Nothing in the saved answers matches this question. This is exactly the moment a
                                guided assistant would help — and exactly the question you should add to the FAQ so
                                the next user gets an instant answer.
                            </p>
                            <div className="flex items-center gap-2">
                                <CopyButton text={asked} label="Copy question" />
                                <span className="text-[9px] font-semibold text-slate-500">Paste it to support on WhatsApp.</span>
                            </div>
                        </div>
                    )}

                    {result.results.length > 1 && (
                        <div className="space-y-1 pt-1">
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Related answers</div>
                            {result.results.filter((r) => r.item !== result.best?.item).slice(0, 4).map((r) => (
                                <button
                                    key={r.item.id}
                                    type="button"
                                    onClick={() => run(r.item.q)}
                                    className="block w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[10px] font-bold text-slate-600 hover:border-[#2b5797] hover:text-[#2b5797] transition-colors"
                                >
                                    {r.item.q}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────── Guide coach ─────────────────────────── */

/**
 * Floating step-by-step coach. It only OPENS screens and points at steps —
 * it has no write path, no db import and no company data, so it can never
 * save, delete or alter anything.
 */
const GuideCoach = ({ guide, onStep, onStop }) => {
    const { feature, stepIndex } = guide;
    const steps = feature.steps || [];
    const total = steps.length;
    const isLast = stepIndex >= total - 1;

    return (
        <div className="fixed inset-0 z-[9500] pointer-events-none">
            <div className="absolute bottom-3 right-3 w-[380px] max-w-[calc(100vw-1.5rem)] pointer-events-auto overflow-hidden rounded-xl border-2 border-[#00457c] bg-white shadow-2xl">
                <div className="flex items-center gap-2 bg-gradient-to-r from-[#005ea8] to-[#00457c] px-3 py-2 text-white">
                    <PlayCircle size={14} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] leading-none opacity-80">Guided walkthrough</div>
                        <div className="text-[11px] font-black leading-tight truncate">{feature.name}</div>
                    </div>
                    <button
                        type="button"
                        onClick={onStop}
                        className="flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-[9px] font-black uppercase tracking-wide hover:bg-white/25 transition-colors"
                        title="Stop the guide"
                    >
                        <Square size={9} /> Stop
                    </button>
                </div>

                <div className="px-3 py-2">
                    <div className="mb-1.5 flex items-center gap-1.5">
                        {steps.map((_, i) => (
                            <span
                                key={i}
                                className={`h-1.5 flex-1 rounded-full transition-colors ${i < stepIndex ? 'bg-emerald-400' : i === stepIndex ? 'bg-[#2b5797]' : 'bg-slate-200'}`}
                            />
                        ))}
                    </div>

                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                        Step {stepIndex + 1} of {total}
                    </div>
                    <div className="mt-0.5 text-[12px] font-bold leading-snug text-slate-800">
                        {steps[stepIndex]}
                    </div>

                    {stepIndex === 0 && feature.where && (
                        <div className="mt-1.5 rounded-md bg-[#eaf2fd] px-2 py-1">
                            <div className="text-[8px] font-black uppercase tracking-widest text-[#2b5797]/70">Where</div>
                            <div className="text-[10px] font-bold text-[#1e3264]">{feature.where}</div>
                        </div>
                    )}

                    <div className="mt-1.5 text-[9px] font-semibold text-slate-400">
                        This guide only opens screens and highlights steps. It never saves or deletes.
                    </div>
                </div>

                <div className="flex items-center justify-between gap-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5">
                    <button
                        type="button"
                        onClick={() => onStep(stepIndex - 1)}
                        disabled={stepIndex === 0}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${stepIndex === 0 ? 'border-slate-200 text-slate-300 cursor-not-allowed' : 'border-slate-300 text-slate-600 hover:bg-white'}`}
                    >
                        <ArrowLeftIcon size={11} /> Back
                    </button>
                    <button
                        type="button"
                        onClick={() => (isLast ? onStop() : onStep(stepIndex + 1))}
                        className="inline-flex items-center gap-1 rounded-md bg-[#2b5797] px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264] transition-colors"
                    >
                        {isLast ? 'Finish' : 'Next'}
                        {!isLast && <ChevronRight size={11} />}
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ─────────────────────────── Shell ─────────────────────────── */

const SupportCenterModal = ({ isOpen, onClose, initialTab = 'features', initialQuestion = '', contextScreen = '', onNavigate, onGuideChange }) => {
    const [tab, setTab] = useState(initialTab);
    const [query, setQuery] = useState('');
    const [guide, setGuide] = useState(null); // { feature, stepIndex }
    const [seedQuestion, setSeedQuestion] = useState('');
    const [faqVersion, setFaqVersion] = useState(0);

    // Build the offline index once per open (cheap: a few hundred strings).
    // Includes anything learned earlier, so a repeated question never costs again.
    useEffect(() => {
        if (!isOpen) return;
        primeSearchIndex({ faqs: allFaqs(FAQ_DATA), features: ALL_FEATURES });
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setTab(initialTab);
            setQuery('');
            setGuide(null);
            setSeedQuestion('');
        }
    }, [isOpen, initialTab]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (guide) stopGuide(); else onClose?.();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose, guide]);

    // Start a walkthrough: open the screen (navigation only) and collapse into the coach.
    const startGuide = (feature) => {
        if (!feature || !(feature.steps || []).length) return;
        setGuide({ feature, stepIndex: 0 });
        onGuideChange?.(true);
        if (feature.screenId && onNavigate) onNavigate(feature.screenId);
    };

    const stopGuide = () => {
        setGuide(null);
        onGuideChange?.(false);
    };

    const goStep = (idx) => {
        setGuide((g) => {
            if (!g) return g;
            const max = (g.feature.steps || []).length - 1;
            const next = Math.max(0, Math.min(max, idx));
            return { ...g, stepIndex: next };
        });
    };

    if (!isOpen) return null;

    // While guiding, show only the floating coach so the user can see the real screen.
    if (guide) {
        return <GuideCoach guide={guide} onStep={goStep} onStop={stopGuide} />;
    }

    const showSearch = tab === 'features' || tab === 'faq';
    const isChat = tab === 'chat';

    return (
        <div className="fixed inset-0 z-[9000] flex flex-col bg-slate-50">
            <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50">
                {/* Header */}
                <div className="shrink-0 bg-gradient-to-r from-[#005ea8] to-[#00457c] px-3 py-2 text-white md:px-5">
                    <div className="flex items-center gap-2">
                        <LifeBuoy size={16} />
                        <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] leading-none">FAQ &amp; Support</div>
                            <div className="text-[9px] font-semibold text-white/70 leading-none mt-1">
                                Guidance only — never reads or changes your company data
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md p-1 hover:bg-white/20 transition-colors"
                            title="Close (Esc)"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="mt-2 flex items-center gap-1">
                        {TABS.map((t) => {
                            const Icon = t.icon;
                            const active = tab === t.id;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => setTab(t.id)}
                                    className={`flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-[10px] font-black uppercase tracking-wide transition-colors ${active ? 'bg-slate-50 text-[#00457c]' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
                                >
                                    <Icon size={12} /> {t.label}
                                </button>
                            );
                        })}
                        {contextScreen && (
                            <span className="ml-auto hidden md:inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/70">
                                <Sparkles size={10} /> You are on: {contextScreen}
                            </span>
                        )}
                    </div>
                </div>

                {/* Search bar */}
                {showSearch && (
                    <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                            <Search size={13} className="text-slate-400 shrink-0" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={tab === 'features' ? 'Search a feature… e.g. fifo, lot, register' : 'Search a question… e.g. add ledger'}
                                className="flex-1 min-w-0 bg-transparent text-[12px] font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                            />
                            {query && (
                                <button type="button" onClick={() => setQuery('')} className="text-slate-400 hover:text-rose-600" title="Clear">
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Body */}
                <div className={`flex-1 min-h-0 px-3 py-3 md:px-5 ${isChat ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                    <div className={`mx-auto w-full max-w-none ${isChat ? 'h-full' : ''}`}>
                        {tab === 'features' && <FeaturesTab query={query} setQuery={setQuery} />}
                        {tab === 'faq' && (
                            <FaqTab
                                query={query}
                                setQuery={setQuery}
                                onGuide={startGuide}
                                onAskInChat={(q) => { setSeedQuestion(q); setTab('chat'); }}
                                version={faqVersion}
                                onForget={(id) => {
                                    deleteLearnedFaq(id);
                                    primeSearchIndex({ faqs: allFaqs(FAQ_DATA), features: ALL_FEATURES });
                                    setFaqVersion((v) => v + 1);
                                }}
                            />
                        )}
                        {tab === 'chat' && (
                            <ChatTab
                                key={seedQuestion || 'fresh'}
                                initialQuestion={seedQuestion || initialQuestion}
                                onGuide={startGuide}
                                onSuggest={() => setTab('suggest')}
                            />
                        )}
                        {tab === 'suggest' && <SuggestTab onGuide={startGuide} />}
                    </div>
                </div>

                {/* Footer */}
                <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-1.5 flex items-center justify-between gap-2 md:px-5">
                    <span className="text-[9px] font-semibold text-slate-400">
                        {ALL_FEATURES.length} features · {FAQ_DATA.length} saved answers · works offline
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
                        Navigation only — no save, no delete, no data access
                    </span>
                </div>
            </div>
        </div>
    );
};

export default SupportCenterModal;
