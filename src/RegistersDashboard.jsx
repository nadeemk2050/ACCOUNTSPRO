import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, memo } from 'react';
import {
    X, ArrowRight, Search, Star, LayoutGrid, Rows3,
    TrendingUp, ShoppingCart, FileText, StickyNote, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Calculator,
    BookOpen, Package, Layers, Tag, Boxes, Factory, ReceiptText, Coins, Percent, Users, Wallet, Building2, HandCoins
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════════
   MODULE-LEVEL STATIC DATA — built once, never recreated, and the register name
   is PRE-SPLIT for the red shortcut letter so no string work runs during render.
   `handler` holds the NAME of a prop; the prop itself is resolved at call time.
   ══════════════════════════════════════════════════════════════════════════════ */
const splitLabel = (name, shortcut) => {
    if (!shortcut) return [name, '', ''];
    const index = name.toLowerCase().indexOf(shortcut.toLowerCase());
    if (index === -1) return [name, '', ''];
    return [name.slice(0, index), name.charAt(index), name.slice(index + 1)];
};

const makeItem = (id, name, shortcut, handler, group, icon, desc, comingSoon = false) => ({
    id, name, shortcut, handler, group, icon, desc,
    parts: splitLabel(name, shortcut),
    comingSoon
});

const REGISTER_ITEMS = [
    makeItem('sales_reg', 'Sales Register', 'S', 'onShowSalesRegister', 'sales', TrendingUp, 'Sales transactions & performance'),
    makeItem('purchase_reg', 'Purchase Register', 'P', 'onShowPurchaseRegister', 'sales', ShoppingCart, 'Procurement & vendor records'),
    makeItem('debit_note', 'Debit Notes', 'D', 'onShowDebitNoteRegister', 'sales', FileText, 'Purchase returns & adjustments'),
    makeItem('credit_note', 'Credit Notes', 'E', 'onShowCreditNoteRegister', 'sales', StickyNote, 'Sales returns & adjustments'),
    makeItem('bill_wise', 'Bill Wise Details', 'B', null, 'sales', FileText, 'Party-wise outstanding bill tracking', true),

    makeItem('payment_reg', 'Payments Register', 'Y', 'onShowPaymentRegister', 'cash', ArrowUpRight, 'Outward cash & bank flows'),
    makeItem('receipt_reg', 'Receipts Register', 'R', 'onShowReceiptRegister', 'cash', ArrowDownLeft, 'Inward cash & bank flows'),
    makeItem('contra_reg', 'Contra Register', 'C', 'onShowContraRegister', 'cash', ArrowLeftRight, 'Inter-account fund transfers'),
    makeItem('cashier_reg', 'Cashier Register', 'H', 'onShowCashierRegister', 'cash', Calculator, 'Detailed cashier transactions'),

    makeItem('journal_reg', 'Journal Register', 'J', 'onShowJournalRegister', 'adjust', BookOpen, 'Adjustment & non-cash entries'),

    makeItem('stock_inv', 'Stock Inventory', 'K', 'onShowStockInventory', 'stock', Package, 'Current warehouse stock levels'),
    makeItem('piece_inv', 'Piece Wise Inventory', 'W', 'onShowPieceInventory', 'stock', Layers, 'Unit-by-unit stock breakdown'),
    makeItem('lot_inv', 'Lot Wise Detail', 'L', 'onShowLotDetail', 'stock', Tag, 'Batch & batch-wise tracking'),
    makeItem('manuf_reg', 'Manufacturing Register', 'M', 'onShowManufacturingRegister', 'stock', Boxes, 'Production & processing logs'),

    makeItem('direct_expense_reg', 'Direct Expenses Register', 'T', 'onShowDirectExpenseRegister', 'expense', Factory, 'Manufacturing & COGS direct expense ledgers'),
    makeItem('expense_reg', 'Indirect Expenses Register', 'X', 'onShowExpenseRegister', 'expense', ReceiptText, 'Operating & administrative costs'),
    makeItem('income_reg', 'Indirect Incomes Register', 'N', 'onShowIncomeRegister', 'expense', Coins, 'Non-operating revenue sources'),

    makeItem('tax_reg', 'Tax Registers', 'G', 'onShowTaxRegister', 'tax', Percent, 'Tax-wise invoice values and running balances'),

    makeItem('customer_reg', 'Customers Register', 'U', 'onShowCustomerRegister', 'other', Users, 'Party-wise ledger summary'),
    makeItem('capital_reg', 'Capital Register', 'I', 'onShowCapitalRegister', 'other', Wallet, 'Owner & equity investments'),
    makeItem('asset_reg', 'Assets Register', 'A', 'onShowAssetRegister', 'other', Building2, 'Fixed & current asset records'),
    makeItem('loans_adv', 'Loans & Advances Tracker', 'V', 'onShowLoansAdvancesRegister', 'other', HandCoins, 'OA · TA · OL · TL — Track outstanding balances & due dates')
];

const REGISTER_GROUPS = [
    { key: 'sales', label: 'Sales & Purchases', accent: 'text-emerald-300/70' },
    { key: 'cash', label: 'Cash & Bank', accent: 'text-sky-300/70' },
    { key: 'adjust', label: 'Adjustments', accent: 'text-violet-300/70' },
    { key: 'stock', label: 'Stock & Production', accent: 'text-amber-300/70' },
    { key: 'expense', label: 'Expenses & Income', accent: 'text-rose-300/70' },
    { key: 'tax', label: 'Tax & Compliance', accent: 'text-cyan-300/70' },
    { key: 'other', label: 'Other', accent: 'text-slate-300/70' }
];

const EMPTY_TAGS = {};
const EMPTY_ARRAY = [];
const FAVORITES_KEY = 'registers_dashboard_favorites';
const RECENT_KEY = 'registers_dashboard_recent';
const DENSITY_KEY = 'registers_dashboard_density';
const MAX_RECENT = 5;
const MAX_FAVORITES = 6;
const RECENT_LIMIT = 5;

/* localStorage — guarded, non-fatal, called only from lazy initialisers / event handlers */
const readPrefArray = (key) => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return EMPTY_ARRAY;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : EMPTY_ARRAY;
    } catch { return EMPTY_ARRAY; }
};
const writePrefArray = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};
const readDensity = () => {
    try { return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'; } catch { return 'comfortable'; }
};
const writeDensity = (value) => {
    try { localStorage.setItem(DENSITY_KEY, value); } catch { /* storage unavailable */ }
};

/* ══════════════════════════════════════════════════════════════════════════════
   TILE — defined OUTSIDE the dashboard and memoised with primitive props only, so
   typing in the search box / moving the focus ring never re-renders every tile.
   ══════════════════════════════════════════════════════════════════════════════ */
const Tile = memo(function Tile({
    id, navKey, parts, icon, desc, isPinned, isFocused, tag, compact, comingSoon, onOpen, onTogglePin
}) {
    const Icon = icon;
    return (
        <button
            type="button"
            data-tile-id={navKey}
            title={desc}
            onClick={() => onOpen(id)}
            className={`flex w-full items-center gap-2 rounded-md border text-left transition-colors ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} ${comingSoon
                ? 'cursor-not-allowed border-white/10 bg-white/[0.02] opacity-50'
                : isFocused
                    ? 'border-blue-400/70 bg-white/[0.09]'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.06]'}`}
        >
            <Icon size={compact ? 13 : 15} className="shrink-0 text-slate-400" />
            <span className={`min-w-0 flex-1 truncate font-bold tracking-tight text-white ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
                {parts[0]}
                {parts[1] ? <span className="font-extrabold text-red-500 underline decoration-red-500/40 underline-offset-2">{parts[1]}</span> : null}
                {parts[2]}
            </span>
            {tag ? <span className="shrink-0 text-[7px] font-black uppercase tracking-wider text-amber-300/80">{tag}</span> : null}
            {comingSoon ? (
                <span className="shrink-0 text-[7px] font-black uppercase tracking-wider text-yellow-400/80">Soon</span>
            ) : (
                <>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400/60" />
                    <span
                        title={isPinned ? 'Unpin' : 'Pin to favorites'}
                        onClick={(e) => { e.stopPropagation(); onTogglePin(id); }}
                        className="shrink-0 rounded p-0.5 hover:bg-white/10"
                    >
                        <Star size={11} className={isPinned ? 'fill-amber-300 text-amber-300' : 'text-slate-600'} />
                    </span>
                </>
            )}
        </button>
    );
});

const RegistersDashboard = ({
    onClose,
    onShowSalesRegister,
    onShowPurchaseRegister,
    onShowPaymentRegister,
    onShowReceiptRegister,
    onShowContraRegister,
    onShowJournalRegister,
    onShowDebitNoteRegister,
    onShowCreditNoteRegister,
    onShowStockInventory,
    onShowPieceInventory,
    onShowLotDetail,
    onShowCashierRegister,
    onShowCustomerRegister,
    onShowCapitalRegister,
    onShowAssetRegister,
    onShowExpenseRegister,
    onShowDirectExpenseRegister,
    onShowIncomeRegister,
    onShowManufacturingRegister,
    onShowLoansAdvancesRegister,
    onShowTaxRegister,
    user,
    effectiveName,
    companyProfile,
    registerTags = EMPTY_TAGS
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [favorites, setFavorites] = useState(() => readPrefArray(FAVORITES_KEY));
    const [density, setDensity] = useState(readDensity);
    const [focusKey, setFocusKey] = useState(null);

    /* Editing the box stays instant; the (heavy) filtering is deferred. */
    const deferredSearch = useDeferredValue(searchTerm);

    /* Recent ids: read once per mount — the dashboard unmounts when a register opens. */
    const recentIds = useMemo(() => readPrefArray(RECENT_KEY), []);

    const handlers = useMemo(() => ({
        onShowSalesRegister, onShowPurchaseRegister, onShowPaymentRegister, onShowReceiptRegister,
        onShowContraRegister, onShowJournalRegister, onShowDebitNoteRegister, onShowCreditNoteRegister,
        onShowStockInventory, onShowPieceInventory, onShowLotDetail, onShowCashierRegister,
        onShowCustomerRegister, onShowCapitalRegister, onShowAssetRegister, onShowDirectExpenseRegister,
        onShowExpenseRegister, onShowIncomeRegister, onShowManufacturingRegister, onShowLoansAdvancesRegister,
        onShowTaxRegister
    }), [
        onShowSalesRegister, onShowPurchaseRegister, onShowPaymentRegister, onShowReceiptRegister,
        onShowContraRegister, onShowJournalRegister, onShowDebitNoteRegister, onShowCreditNoteRegister,
        onShowStockInventory, onShowPieceInventory, onShowLotDetail, onShowCashierRegister,
        onShowCustomerRegister, onShowCapitalRegister, onShowAssetRegister, onShowDirectExpenseRegister,
        onShowExpenseRegister, onShowIncomeRegister, onShowManufacturingRegister, onShowLoansAdvancesRegister,
        onShowTaxRegister
    ]);

    const itemsById = useMemo(() => {
        const map = new Map();
        for (const item of REGISTER_ITEMS) map.set(item.id, item);
        return map;
    }, []);

    /* Live filter — one pass over the static table; identical 1-char semantics as before. */
    const filtered = useMemo(() => {
        const search = deferredSearch.toLowerCase();
        if (!search) return REGISTER_ITEMS;
        if (search.length === 1) return REGISTER_ITEMS.filter(m => m.name.toLowerCase().startsWith(search));
        return REGISTER_ITEMS.filter(m =>
            m.name.toLowerCase().includes(search) ||
            m.desc.toLowerCase().includes(search) ||
            (m.shortcut || '').toLowerCase() === search
        );
    }, [deferredSearch]);

    const favoriteItems = useMemo(() => filtered.filter(m => favorites.includes(m.id)), [filtered, favorites]);

    const groupCards = useMemo(() => {
        const byGroup = new Map();
        for (const item of filtered) {
            const bucket = byGroup.get(item.group);
            if (bucket) bucket.push(item); else byGroup.set(item.group, [item]);
        }
        return REGISTER_GROUPS
            .map(group => ({ key: group.key, label: group.label, accent: group.accent, items: byGroup.get(group.key) || EMPTY_ARRAY }))
            .filter(group => group.items.length > 0);
    }, [filtered]);

    const recentItems = useMemo(() => {
        const out = [];
        for (const id of recentIds) {
            const item = itemsById.get(id);
            if (item) out.push(item);
            if (out.length >= RECENT_LIMIT) break;
        }
        return out;
    }, [recentIds, itemsById]);

    const cards = useMemo(() => {
        const out = [];
        if (favoriteItems.length > 0) out.push({ key: '__fav', kind: 'fav', label: 'Favorites', accent: 'text-amber-300/70', items: favoriteItems });
        for (const group of groupCards) out.push({ key: group.key, kind: 'grp', label: group.label, accent: group.accent, items: group.items });
        return out;
    }, [favoriteItems, groupCards]);

    /* Ordered nav keys = same order as the DOM. */
    const navKeys = useMemo(() => {
        const keys = [];
        if (favoriteItems.length > 0) for (const item of favoriteItems) keys.push('fav:' + item.id);
        for (const group of groupCards) for (const item of group.items) keys.push('grp:' + item.id);
        return keys;
    }, [favoriteItems, groupCards]);

    /* Latest-value refs — the single key listener never re-subscribes. */
    const itemsByIdRef = useRef(itemsById);
    const handlersRef = useRef(handlers);
    const navKeysRef = useRef(navKeys);
    const focusKeyRef = useRef(focusKey);
    const favoritesRef = useRef(favorites);
    const densityRef = useRef(density);
    const searchOpenRef = useRef(searchOpen);
    const onCloseRef = useRef(onClose);

    const handleOpen = useCallback((id) => {
        const item = itemsByIdRef.current.get(id);
        if (!item || item.comingSoon) return;
        /* UI preference only — recorded before the handler, arguments untouched. */
        try {
            const prev = readPrefArray(RECENT_KEY);
            writePrefArray(RECENT_KEY, [id, ...prev.filter(x => x !== id)].slice(0, MAX_RECENT));
        } catch { /* ignore */ }
        const run = item.handler ? handlersRef.current[item.handler] : null;
        if (run) run();
        else alert("Coming soon or not connected.");
    }, []);

    const handleTogglePin = useCallback((id) => {
        const prev = favoritesRef.current;
        const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(0, MAX_FAVORITES);
        favoritesRef.current = next;
        writePrefArray(FAVORITES_KEY, next);
        setFavorites(next);
    }, []);

    const handleToggleDensity = useCallback(() => {
        const next = densityRef.current === 'compact' ? 'comfortable' : 'compact';
        densityRef.current = next;
        writeDensity(next);
        setDensity(next);
    }, []);

    const handleSearchChange = useCallback((e) => {
        setSearchTerm(e.target.value);
        setFocusKey(null);
    }, []);

    /* The search bar stays closed — open it on demand, and it always reopens empty. */
    const handleToggleSearch = useCallback(() => {
        setSearchOpen(prev => !prev);
        setSearchTerm('');
        setFocusKey(null);
    }, []);

    /* One pass after every render to keep the listener's refs current. */
    useEffect(() => {
        itemsByIdRef.current = itemsById;
        handlersRef.current = handlers;
        navKeysRef.current = navKeys;
        focusKeyRef.current = focusKey;
        favoritesRef.current = favorites;
        densityRef.current = density;
        searchOpenRef.current = searchOpen;
        onCloseRef.current = onClose;
    });

    /* Autofocus the search box the moment it is revealed. */
    useEffect(() => {
        if (!searchOpen) return;
        const el = document.getElementById('register-search');
        if (el) el.focus();
    }, [searchOpen]);

    /* Key listener — added once (empty deps); everything it needs is read from refs. */
    useEffect(() => {
        const handleKeyDown = (e) => {
            const active = document.activeElement;
            const isInputFocused = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

            if (e.altKey) {
                const key = e.key.toLowerCase();
                const item = REGISTER_ITEMS.find(m => m.shortcut && m.shortcut.toLowerCase() === key);
                if (item && !item.comingSoon) {
                    const run = item.handler ? handlersRef.current[item.handler] : null;
                    if (run) { e.preventDefault(); run(); }
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setFocusKey(null);
                if (searchOpenRef.current) {
                    setSearchOpen(false);
                    setSearchTerm('');
                } else if (onCloseRef.current) {
                    onCloseRef.current();
                }
            } else if (!e.ctrlKey && !e.metaKey && !isInputFocused && e.key === '/') {
                e.preventDefault();
                if (!searchOpenRef.current) setSearchOpen(true);
                const searchInput = document.getElementById('register-search');
                if (searchInput) searchInput.focus();
            } else if (!e.ctrlKey && !e.metaKey && !isInputFocused && e.key.indexOf('Arrow') === 0) {
                const keys = navKeysRef.current;
                if (keys.length > 0) {
                    e.preventDefault();
                    const step = (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 1;
                    const at = keys.indexOf(focusKeyRef.current);
                    let next = at === -1 ? (step > 0 ? 0 : keys.length - 1) : at + step;
                    if (next < 0) next = keys.length - 1;
                    if (next >= keys.length) next = 0;
                    focusKeyRef.current = keys[next];
                    const node = document.querySelector(`[data-tile-id="${keys[next]}"]`);
                    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
                    setFocusKey(keys[next]);
                }
            } else if (!e.ctrlKey && !e.metaKey && !isInputFocused && e.key === 'Enter') {
                const key = focusKeyRef.current;
                const item = key ? itemsByIdRef.current.get(key.slice(key.indexOf(':') + 1)) : null;
                if (item) { e.preventDefault(); handleOpen(item.id); }
            } else if (!e.ctrlKey && !e.metaKey && !isInputFocused && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
                e.preventDefault();
                const letter = e.key.toUpperCase();
                const shortcutItem = REGISTER_ITEMS.find(m => m.shortcut === letter);
                if (!searchOpenRef.current && shortcutItem && !shortcutItem.comingSoon && shortcutItem.handler) {
                    /* Search closed → the underlined shortcut letter opens the register directly. */
                    handleOpen(shortcutItem.id);
                } else {
                    /* Search open (or no register owns that letter) → send it to the search box. */
                    setSearchTerm(letter);
                    setFocusKey(null);
                    if (!searchOpenRef.current) setSearchOpen(true);
                    const searchInput = document.getElementById('register-search');
                    if (searchInput) searchInput.focus();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleOpen]);

    const compact = density === 'compact';

    return (
        <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#0f172a] font-sans text-white">
            {/* HEADER */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b1220] px-3 md:px-4">
                <div className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10" onClick={onClose}>
                    <div className="rounded-md bg-white/10 p-1.5">
                        <ArrowRight className="rotate-180" size={16} />
                    </div>
                    <div className="flex select-none flex-col leading-tight">
                        <span className="text-sm font-bold tracking-wide">REGISTERS DASHBOARD</span>
                        <span className="text-[9px] uppercase tracking-widest opacity-50">Comprehensive Reports View</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="hidden flex-col text-right leading-tight md:flex">
                        <span className="text-[11px] font-bold text-white/80">{effectiveName || user?.email}</span>
                        <span className="text-[9px] opacity-50">{companyProfile?.name || 'Company Name'}</span>
                    </div>
                    {!searchOpen && (
                        <span className="hidden text-[9px] font-bold uppercase tracking-widest text-white/25 xl:block">
                            press a letter to open · / to search
                        </span>
                    )}
                    <button
                        onClick={handleToggleSearch}
                        title={searchOpen ? 'Hide search' : 'Search registers ( / )'}
                        className={`rounded-full p-1.5 transition-colors hover:bg-white/10 hover:text-white ${searchOpen ? 'bg-white/10 text-white' : 'text-white/60'}`}
                    >
                        <Search size={16} />
                    </button>
                    <button
                        onClick={handleToggleDensity}
                        title={compact ? 'Switch to comfortable layout' : 'Switch to compact layout'}
                        className="rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        {compact ? <LayoutGrid size={16} /> : <Rows3 size={16} />}
                    </button>
                    <button
                        onClick={onClose}
                        className="rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* SEARCH — closed by default, revealed by / or the search button */}
            {searchOpen && (
                <div className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#0e1626] px-3 py-2 md:px-4">
                    <div className="relative flex-1">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <Search size={14} className="text-slate-500" />
                        </div>
                        <input
                            id="register-search"
                            type="text"
                            placeholder="SEARCH FOR A REGISTER (E.G. SALES, TAX, INVENTORY...)"
                            className="w-full rounded-lg border border-white/10 bg-white/[0.05] py-1.5 pl-9 pr-3 text-[10px] font-bold uppercase tracking-widest text-white placeholder:text-slate-600 focus:border-blue-500/60 focus:outline-none"
                            value={searchTerm}
                            onChange={handleSearchChange}
                        />
                    </div>
                    <div className="hidden shrink-0 text-[9px] font-bold uppercase tracking-widest text-slate-500 lg:block">
                        <span className="text-slate-300">esc</span> to hide · arrows to move · <span className="text-slate-300">↵</span> to open
                    </div>
                </div>
            )}

            {/* MAIN — the only scroll container; auto-fit columns use the full width */}
            <div className="min-h-0 w-full flex-1 overflow-y-auto px-3 py-3 md:px-4">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] content-start gap-2.5">
                    {cards.map(card => (
                        <section key={card.key} className="rounded-lg border border-white/10 bg-[#111a2b] p-1.5">
                            <div className={`px-1 pb-1.5 text-[9px] font-black uppercase tracking-[0.2em] ${card.accent}`}>{card.label}</div>
                            <div className="flex flex-col gap-1">
                                {card.items.map(item => {
                                    const navKey = card.kind + ':' + item.id;
                                    return (
                                        <Tile
                                            key={item.id}
                                            id={item.id}
                                            navKey={navKey}
                                            parts={item.parts}
                                            icon={item.icon}
                                            desc={item.desc}
                                            isPinned={favorites.includes(item.id)}
                                            isFocused={focusKey === navKey}
                                            tag={registerTags[item.id]}
                                            compact={compact}
                                            comingSoon={item.comingSoon}
                                            onOpen={handleOpen}
                                            onTogglePin={handleTogglePin}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    ))}

                    {recentItems.length > 0 && (
                        <section className="rounded-lg border border-white/10 bg-[#111a2b] p-1.5">
                            <div className="px-1 pb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400/70">Recently opened</div>
                            <div className="flex flex-col gap-1">
                                {recentItems.map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        title={item.desc}
                                        onClick={() => handleOpen(item.id)}
                                        className="flex w-full items-center rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06]"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-slate-300">{item.name}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                {filtered.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-10 opacity-30">
                        <Search size={32} className="text-slate-500" />
                        <div className="text-[10px] font-black uppercase tracking-[0.2em]">No Register Found</div>
                    </div>
                )}
            </div>

            {/* FOOTER — tiny, fixed height, never forces a scrollbar */}
            <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/5 px-3 text-[9px] uppercase tracking-[0.2em] text-white/25 md:px-4">
                <span className="shrink-0">Audit Ready Reports</span>
                <span className="hidden truncate px-3 md:block">Registers provide a chronological view of all transactions.</span>
                <span className="shrink-0 font-mono">V2.7.3</span>
            </div>
        </div>
    );
};

export default RegistersDashboard;
