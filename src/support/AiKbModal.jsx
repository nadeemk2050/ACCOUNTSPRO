import React, { useMemo, useState } from 'react';
import {
    Bot, X, Save, RotateCcw, Copy, Check, ShieldAlert, MessageSquare, Languages,
    Brain, UserCog, AlertCircle, Code2,
} from 'lucide-react';
import {
    loadKb, saveKb, resetKb, isUsingDefaultKb, DEFAULT_KB, LANGUAGES,
    kbPromptBlock, kbToCode, DEVELOPER_EMAIL,
} from './knowledgeBase';

/**
 * AiKbModal — the developer's control panel for the assistant's brain.
 * Visible only to the developer account (role === 'developer').
 *
 * It edits: identity, tone, what to tell, what to ignore, the NLM notes,
 * banned languages and free-form extra rules. Saving writes a device override;
 * "Copy as code" produces the exact block to paste into knowledgeBase.js so a
 * change becomes permanent for every user.
 */

const Section = ({ icon: Icon, title, hint, children }) => (
    <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-2">
            <span className="mt-0.5 text-[#005994]"><Icon size={13} /></span>
            <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">{title}</div>
                {hint && <div className="text-[9px] font-semibold text-slate-400">{hint}</div>}
            </div>
        </div>
        <div className="p-2.5">{children}</div>
    </div>
);

const Field = ({ label, value, onChange, rows = 3, mono = false, placeholder = '' }) => (
    <label className="block">
        <span className="mb-0.5 block text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className={`w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-[11px] font-semibold leading-relaxed text-slate-700 outline-none focus:border-[#005994] ${mono ? 'font-mono text-[10px]' : ''}`}
        />
    </label>
);

const AiKbModal = ({ onClose }) => {
    const [kb, setKb] = useState(() => loadKb());
    const [msg, setMsg] = useState('');
    const [copied, setCopied] = useState(false);
    const usingDefault = isUsingDefaultKb();

    const set = (patch) => setKb((k) => ({ ...k, ...patch }));
    const setOwner = (patch) => setKb((k) => ({ ...k, owner: { ...k.owner, ...patch } }));

    const listToText = (arr) => (arr || []).join('\n');
    const textToList = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);

    const toggleLanguage = (id) => {
        setKb((k) => {
            const cur = k.blockedLanguages || [];
            return { ...k, blockedLanguages: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
        });
    };

    const doSave = () => {
        const ok = saveKb(kb);
        setMsg(ok ? 'Saved on this device. The assistant will follow these rules from its next answer.' : 'Could not save (storage full).');
    };

    const doReset = () => {
        resetKb();
        setKb({ ...DEFAULT_KB });
        setMsg('Reset to the built-in defaults.');
    };

    const copyCode = () => {
        try {
            navigator.clipboard.writeText(kbToCode(kb));
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
            setMsg('Code copied — paste it over DEFAULT_KB in src/support/knowledgeBase.js for every user.');
        } catch {
            setMsg('Clipboard is blocked by the browser.');
        }
    };

    const preview = useMemo(() => kbPromptBlock(kb), [kb]);

    return (
        <div className="fixed inset-0 z-[9600] flex items-center justify-center bg-black/40 p-3">
            <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-slate-50 shadow-2xl">
                {/* header */}
                <div className="flex items-center gap-2 bg-gradient-to-r from-[#005ea8] to-[#00457c] px-3 py-2 text-white">
                    <Bot size={16} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] leading-none">AI &amp; Chatbot KB</div>
                        <div className="mt-1 text-[9px] font-semibold leading-none text-white/70">
                            Knowledge brain — what to tell, what to ignore, how to talk · developer only
                        </div>
                    </div>
                    <span className="rounded bg-white/15 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide">
                        {usingDefault ? 'defaults' : 'custom'}
                    </span>
                    <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/20" title="Close">
                        <X size={15} />
                    </button>
                </div>

                {/* body */}
                <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
                    <Section icon={UserCog} title="Owner / developer identity" hint="Used only when the user asks who built the app">
                        <div className="grid gap-2 md:grid-cols-2">
                            <label className="block">
                                <span className="mb-0.5 block text-[9px] font-black uppercase tracking-widest text-slate-400">Name</span>
                                <input
                                    value={kb.owner?.name || ''}
                                    onChange={(e) => setOwner({ name: e.target.value })}
                                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-[#005994]"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-0.5 block text-[9px] font-black uppercase tracking-widest text-slate-400">Title</span>
                                <input
                                    value={kb.owner?.title || ''}
                                    onChange={(e) => setOwner({ title: e.target.value })}
                                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-[#005994]"
                                />
                            </label>
                            <label className="block md:col-span-2">
                                <span className="mb-0.5 block text-[9px] font-black uppercase tracking-widest text-slate-400">Email</span>
                                <input
                                    value={kb.owner?.email || ''}
                                    onChange={(e) => setOwner({ email: e.target.value })}
                                    placeholder={DEVELOPER_EMAIL}
                                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-[11px] font-semibold text-slate-700 outline-none focus:border-[#005994]"
                                />
                            </label>
                        </div>
                    </Section>

                    <Section icon={MessageSquare} title="Tone & style of talking" hint="How the assistant should sound">
                        <Field label="Tone rules" value={kb.tone} onChange={(v) => set({ tone: v })} rows={4} />
                    </Section>

                    <Section icon={Brain} title="What to tell" hint="One rule per line — facts it must be willing to state">
                        <Field
                            label="Must-tell list"
                            value={listToText(kb.whatToTell)}
                            onChange={(v) => set({ whatToTell: textToList(v) })}
                            rows={6}
                        />
                    </Section>

                    <Section icon={ShieldAlert} title="What to ignore" hint="One rule per line — refusals and things never to say">
                        <Field
                            label="Must-ignore list"
                            value={listToText(kb.whatToIgnore)}
                            onChange={(v) => set({ whatToIgnore: textToList(v) })}
                            rows={6}
                        />
                    </Section>

                    <Section icon={Bot} title="NLM feature knowledge" hint="What the assistant says when someone asks about NLM">
                        <Field label="NLM notes" value={kb.nlmNotes} onChange={(v) => set({ nlmNotes: v })} rows={4} />
                    </Section>

                    <Section icon={Languages} title="Restricted languages" hint="If a blocked language is detected, the assistant answers in English / Arabic / Hindi only">
                        <div className="flex flex-wrap gap-1.5">
                            {LANGUAGES.map((lang) => {
                                const on = (kb.blockedLanguages || []).includes(lang.id);
                                return (
                                    <button
                                        key={lang.id}
                                        type="button"
                                        onClick={() => toggleLanguage(lang.id)}
                                        className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                                            on
                                                ? 'border-rose-300 bg-rose-50 text-rose-700'
                                                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                                        }`}
                                    >
                                        {on ? 'blocked · ' : ''}{lang.label}
                                    </button>
                                );
                            })}
                        </div>
                    </Section>

                    <Section icon={AlertCircle} title="Extra developer rules" hint="Free text appended to the assistant instructions">
                        <Field label="Additional instructions" value={kb.extraRules} onChange={(v) => set({ extraRules: v })} rows={4} placeholder="e.g. always mention the Backup screen first when a user reports lost data" />
                    </Section>

                    <Section icon={Code2} title="Prompt preview" hint="Exactly what is added to the AI instructions">
                        <pre className="max-h-40 overflow-auto rounded-md bg-slate-900 p-2 text-[9px] leading-relaxed text-emerald-200">{preview}</pre>
                    </Section>
                </div>

                {/* footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2">
                    <div className="min-w-0 flex-1 text-[9px] font-bold text-slate-500">{msg || 'Saved rules apply to this device. Use “Copy as code” to make them permanent for every user.'}</div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={copyCode}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-600 hover:border-[#005994]"
                        >
                            {copied ? <Check size={11} /> : <Copy size={11} />} Copy as code
                        </button>
                        <button
                            type="button"
                            onClick={doReset}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-600 hover:border-rose-400 hover:text-rose-600"
                        >
                            <RotateCcw size={11} /> Reset
                        </button>
                        <button
                            type="button"
                            onClick={doSave}
                            className="inline-flex items-center gap-1 rounded-md bg-[#005994] px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white hover:bg-[#00457c]"
                        >
                            <Save size={11} /> Save KB
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AiKbModal;
