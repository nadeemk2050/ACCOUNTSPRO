import React, { useEffect, useRef, useState } from 'react';
import {
    Send, LifeBuoy, PlayCircle, Copy, Check, RotateCcw, AlertCircle, Sparkles, Lightbulb,
    Bot, KeyRound, Power, Loader2, WifiOff,
} from 'lucide-react';
import { askBot, createChatState, welcomeReply } from './chatEngine';
import { primeSearchIndex } from './faqSearch';
import { ALL_FEATURES } from './featureCatalogue';
import { FAQ_DATA } from './faqData';
import { allFaqs, saveLearnedFaq } from './faqStore';
import { askAi, isAiEnabled, setAiEnabled, getAiKey, setAiKey, aiKeySource, testAi, hasBuiltInKey } from './aiGateway';

/**
 * ChatTab
 * ---------------------------------------------------------------------------
 * The conversation screen. Matching decisions come from chatEngine (pure,
 * offline). The AI is a last resort and only fires on a real "miss".
 *
 * Order of resolution for every question:
 *   1. local saved answer          (instant, free)
 *   2. local "did you mean"        (instant, free)
 *   3. AI, if switched on          (network, costs credit)
 *   4. whatever the AI said is saved locally, so the same question is
 *      answered by step 1 from then on.
 *
 * It still cannot read or write company data — the AI only receives the text
 * of the question.
 */

const CopyBtn = ({ text, label = 'Copy' }) => {
    const [done, setDone] = useState(false);
    const copy = () => {
        try {
            navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
        } catch {
            /* clipboard blocked — nothing is lost */
        }
    };
    return (
        <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500 hover:border-[#2b5797] hover:text-[#2b5797] transition-colors"
            title="Copy this answer"
        >
            {done ? <Check size={10} /> : <Copy size={10} />} {done ? 'Copied' : label}
        </button>
    );
};

const Dots = () => (
    <span className="inline-flex items-center gap-0.5 py-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '120ms' }} />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '240ms' }} />
    </span>
);

const BotAvatar = () => (
    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2b5797] text-white">
        <LifeBuoy size={13} />
    </div>
);

const OptionChips = ({ options, onPick }) => {
    if (!options || !options.length) return null;
    return (
        <div className="mt-2 flex flex-wrap gap-1">
            {options.map((o, i) => (
                <button
                    key={`${o.label}-${i}`}
                    type="button"
                    onClick={() => onPick(o)}
                    className="rounded-full border border-[#2b5797]/30 bg-[#eaf2fd] px-2.5 py-1 text-[10px] font-bold text-[#2b5797] hover:border-[#2b5797] hover:bg-[#dbe9fb] transition-colors"
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
};

const BotBubble = ({ reply, onPick, onGuide, onSuggest, onAsk, onAskAi }) => {
    const isAnswer = reply.type === 'answer' && reply.faq;
    const isAi = reply.type === 'ai';
    const isError = reply.type === 'ai-error';

    return (
        <div className="flex items-start gap-2">
            <BotAvatar />
            <div className="min-w-0 flex-1">
                <div
                    className={`rounded-2xl rounded-tl-md border px-3 py-2 shadow-sm ${
                        isAi ? 'border-violet-200 bg-violet-50' : isError ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'
                    }`}
                >
                    {isAnswer && (
                        <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                            <Check size={10} /> Saved answer · instant · offline
                        </div>
                    )}
                    {isAi && (
                        <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-violet-700">
                            <Bot size={10} /> AI answer · saved for next time
                        </div>
                    )}
                    {reply.type === 'miss' && (
                        <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-amber-700">
                            <AlertCircle size={10} /> Not in the help library
                        </div>
                    )}
                    {isError && (
                        <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-rose-700">
                            <WifiOff size={10} /> AI unavailable
                        </div>
                    )}

                    {isAnswer && <div className="text-[12px] font-black leading-tight text-slate-800">{reply.faq.q}</div>}
                    {isAi && reply.question && (
                        <div className="mb-1 text-[10px] font-bold text-violet-900/70">“{reply.question}”</div>
                    )}

                    <p className="mt-1 whitespace-pre-line text-[11.5px] leading-relaxed text-slate-700">{reply.text}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {isAnswer && <CopyBtn text={`${reply.faq.q}\n\n${reply.faq.a}`} label="Copy answer" />}
                        {isAi && <CopyBtn text={reply.text} label="Copy answer" />}
                        {isAi && reply.cached && (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-700">
                                from cache · no cost
                            </span>
                        )}
                        {reply.guideFeature && onGuide && (
                            <button
                                type="button"
                                onClick={() => onGuide(reply.guideFeature)}
                                className="inline-flex items-center gap-1 rounded-md bg-[#2b5797] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white hover:bg-[#1e3264] transition-colors"
                            >
                                <PlayCircle size={10} /> Walk me through it
                            </button>
                        )}
                        {reply.suggestAction && onSuggest && (
                            <button
                                type="button"
                                onClick={onSuggest}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700 hover:bg-amber-100 transition-colors"
                            >
                                <Lightbulb size={10} /> Suggest this idea
                            </button>
                        )}
                        {reply.allowAi && reply.question && onAskAi && (
                            <button
                                type="button"
                                onClick={() => onAskAi(reply.question)}
                                className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-700 hover:bg-violet-100 transition-colors"
                            >
                                <Bot size={10} /> None of these — ask the AI
                            </button>
                        )}
                    </div>
                </div>

                <OptionChips options={reply.options} onPick={(o) => (o.action === 'suggest' ? onSuggest?.() : onAsk(o.query || o.label))} />
            </div>
        </div>
    );
};

const UserBubble = ({ text }) => (
    <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[#2b5797] px-3 py-1.5 text-[11.5px] font-semibold leading-relaxed text-white shadow-sm">
            {text}
        </div>
    </div>
);

/* ── AI settings panel ───────────────────────────────────────────────────── */

const AiPanel = ({ onClose }) => {
    const builtIn = hasBuiltInKey();
    const [key, setKey] = useState(() => (builtIn ? '' : getAiKey()));
    const [enabled, setEnabled] = useState(() => isAiEnabled());
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);
    const source = aiKeySource();

    const save = () => {
        if (!key.trim() && builtIn) {
            setMsg('The app already provides the key — nothing to do.');
            return;
        }
        setAiKey(key);
        const has = !!getAiKey();
        setAiEnabled(enabled && has);
        setMsg(has ? 'Key saved on this device.' : 'Key removed.');
        setKey('');
    };

    const runTest = async () => {
        setBusy(true);
        setMsg('Testing…');
        const res = await testAi();
        setBusy(false);
        setMsg(res.ok ? `Working. Sample: ${res.sample}…` : `Failed: ${res.error}`);
    };

    return (
        <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50/70 p-2.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-violet-800">
                    <Bot size={11} /> AI fallback
                </div>
                <button type="button" onClick={onClose} className="text-[9px] font-black uppercase tracking-wide text-slate-500 hover:text-slate-800">
                    Close
                </button>
            </div>

            <p className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-600">
                Used only when the saved answers have nothing. The question text is the only thing sent — never your vouchers or
                balances. Every answer is stored locally so the same question is free next time.
            </p>

            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setEnabled((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-wide transition-colors ${
                        enabled ? 'bg-violet-600 text-white' : 'border border-slate-300 bg-white text-slate-600'
                    }`}
                >
                    <Power size={10} /> {enabled ? 'On' : 'Off'}
                </button>
                <span className="text-[9px] font-bold text-slate-500">
                    {source === 'build'
                        ? 'Key provided by the app — every user has it, nothing to type'
                        : source === 'device'
                            ? 'Key saved on this device'
                            : 'Key not set'}
                </span>
            </div>

            <div className="mt-2 flex items-center gap-1.5">
                <KeyRound size={11} className="shrink-0 text-slate-400" />
                <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={builtIn ? 'Using the key built into the app (optional override)' : 'sk-… (DeepSeek API key)'}
                    className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-700 outline-none focus:border-violet-500"
                />
                <button type="button" onClick={save} className="rounded-md bg-slate-800 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-white hover:bg-slate-900">
                    Save
                </button>
                <button
                    type="button"
                    onClick={runTest}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-600 hover:border-violet-500 disabled:opacity-50"
                >
                    {busy ? <Loader2 size={10} className="animate-spin" /> : null} Test
                </button>
            </div>

            {msg && <div className="mt-1.5 text-[9px] font-bold leading-relaxed text-slate-600">{msg}</div>}

            <div className="mt-1.5 text-[8.5px] font-semibold leading-relaxed text-slate-400">
                Note: a key stored on a public web build can be read by anyone who inspects the app. For release, route this through a
                server proxy.
            </div>
        </div>
    );
};

/* ── the tab ─────────────────────────────────────────────────────────────── */

const ChatTab = ({ initialQuestion = '', onGuide, onSuggest }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [typing, setTyping] = useState(false);
    const [aiBusy, setAiBusy] = useState(false);
    const [showAi, setShowAi] = useState(false);
    const stateRef = useRef(createChatState());
    const idRef = useRef(0);
    const startedRef = useRef(false);
    const timerRef = useRef(null);
    const scrollerRef = useRef(null);

    const nextId = () => `m${(idRef.current += 1)}`;
    const pushBot = (reply) => setMessages((m) => [...m, { id: nextId(), from: 'bot', reply }]);
    const pushUser = (text) => setMessages((m) => [...m, { id: nextId(), from: 'user', text }]);

    useEffect(() => {
        if (startedRef.current) return undefined;
        startedRef.current = true;
        pushBot(welcomeReply());
        if (initialQuestion) {
            const t = setTimeout(() => send(initialQuestion), 420);
            return () => clearTimeout(t);
        }
        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, typing, aiBusy]);

    useEffect(() => () => clearTimeout(timerRef.current), []);

    /** Step 3: the AI, only after a genuine miss. */
    const runAi = async (question) => {
        setAiBusy(true);
        const res = await askAi(question);
        setAiBusy(false);

        if (!res.ok) {
            pushBot({
                type: 'ai-error',
                text: `${res.error}\n\nYou can still search the Features tab, or write the question in Suggestions so it can be added to the offline help library.`,
                suggestAction: true,
            });
            return;
        }

        pushBot({ type: 'ai', text: res.answer, question, cached: res.cached });

        // Learn it: store locally and rebuild the index so next time is free.
        if (!res.cached) {
            saveLearnedFaq({ q: question, a: res.answer, keywords: res.keywords || [] });
            primeSearchIndex({ faqs: allFaqs(FAQ_DATA), features: ALL_FEATURES });
        }
    };

    const send = (raw) => {
        const text = String(raw || '').trim();
        if (!text) return;
        pushUser(text);
        setInput('');
        setTyping(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            const res = askBot(text, stateRef.current);
            stateRef.current = res.state;
            pushBot({ ...res.reply, question: text });
            setTyping(false);
            if (res.reply.type === 'miss' && isAiEnabled()) runAi(text);
        }, 380);
    };

    const reset = () => {
        clearTimeout(timerRef.current);
        stateRef.current = createChatState();
        setMessages([]);
        setTyping(false);
        setAiBusy(false);
        setInput('');
        pushBot(welcomeReply());
    };

    const aiOn = isAiEnabled();

    return (
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
            {/* strip */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                <div className="flex min-w-0 items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <Sparkles size={11} className="text-[#2b5797]" />
                    Saved answers first · no cost
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setShowAi((v) => !v)}
                        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide transition-colors hover:border-violet-500 ${
                            aiOn ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'
                        }`}
                        title="AI fallback settings"
                    >
                        <Bot size={10} /> AI {aiOn ? 'on' : 'off'}
                    </button>
                    <button
                        type="button"
                        onClick={reset}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500 hover:border-[#2b5797] hover:text-[#2b5797] transition-colors"
                        title="Start a new conversation"
                    >
                        <RotateCcw size={10} /> New chat
                    </button>
                </div>
            </div>

            {showAi && <AiPanel onClose={() => setShowAi(false)} />}

            {/* messages */}
            <div ref={scrollerRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-2 pr-1">
                {messages.map((m) =>
                    m.from === 'user' ? (
                        <UserBubble key={m.id} text={m.text} />
                    ) : (
                        <BotBubble
                            key={m.id}
                            reply={m.reply}
                            onPick={(o) => send(o.query || o.label)}
                            onAsk={send}
                            onGuide={onGuide}
                            onSuggest={onSuggest}
                            onAskAi={isAiEnabled() ? runAi : undefined}
                        />
                    )
                )}
                {typing && (
                    <div className="flex items-start gap-2">
                        <BotAvatar />
                        <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3 py-1 shadow-sm">
                            <Dots />
                        </div>
                    </div>
                )}
                {aiBusy && (
                    <div className="flex items-start gap-2">
                        <BotAvatar />
                        <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-violet-200 bg-violet-50 px-3 py-1.5 shadow-sm">
                            <Loader2 size={11} className="animate-spin text-violet-600" />
                            <span className="text-[10px] font-bold text-violet-700">Not in the saved answers — asking the AI…</span>
                        </div>
                    </div>
                )}
            </div>

            {/* composer */}
            <div className="shrink-0 border-t border-slate-200 pt-2">
                <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2 py-1.5 focus-within:border-[#2b5797]">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                send(input);
                            }
                        }}
                        placeholder="Ask how to do something… e.g. where do I add a bank account?"
                        className="flex-1 min-w-0 bg-transparent text-[12px] font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                        autoFocus
                    />
                    <button
                        type="button"
                        onClick={() => send(input)}
                        disabled={!input.trim()}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#2b5797] px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-[#1e3264] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Send size={11} /> Send
                    </button>
                </div>
                <div className="mt-1 text-center text-[9px] font-semibold text-slate-400">
                    I explain and open screens only — I never save, delete or change anything.
                </div>
            </div>
        </div>
    );
};

export default ChatTab;
