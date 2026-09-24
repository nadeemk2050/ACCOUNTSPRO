import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { ArrowLeft, X, FileText, CheckCircle2, AlertTriangle, Search, ShieldCheck, Landmark, FileSpreadsheet } from 'lucide-react';

/* ============================================================================
   V201 VERIFY REPORT — UAE FTA VAT Return Pre-Verification Module
   ----------------------------------------------------------------------------
   Context: Opened from an individual Tax Ledger view (Tax Masters). Provides
   two verification sheets that mirror the official "VAT JAN TO MAR.xlsx" tabs:

   1) PURCHASE (INPUT VAT)  — supplier-wise reconciliation
      Supplier | TRN | Vch | Amount Paid | Std-Rated Supplies | Actual VAT |
      Theoretical {rate}% | Variation
      Sources: INV rows (Purchase/APT/Credit-Note invoices w/ VAT) and JV rows
      (manual journal DEBITs to this VAT ledger).

   2) SALES (OUTPUT VAT)    — mirror of the workbook "SALE" tab
      Location | Voucher No. | Voucher Ref. No. | Voucher Ref. Date | TRN |
      Item Name | Quantity | Rate | Value | VAT (Actual Collected) |
      VAT Check (Theoretical {rate}%) | Variation / Difference
      Sources: Sales / Debit-Note invoices carrying VAT, exploded per item line.

   Theoretical VAT = rate% × tax-exclusive value. Rows are flagged REVIEW when
   |actual − theoretical| exceeds the rounding tolerance.
   ========================================================================= */

const TOL = 0.05;                       // rounding tolerance (fils) for variation flag
const norm = (s) => String(s || '').trim().toLowerCase();

const safeNum = (n) => {
    const v = Number(n);
    return isNaN(v) ? 0 : v;
};

const fmt2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt3 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtInt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDate = (d) => {
    if (!d) return '-';
    const [y, m, day] = String(d).split('-');
    if (!y || !m || !day) return String(d);
    return `${day}/${m}/${y}`;
};
const iso = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return '';
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Default to the current calendar quarter (VAT 201 is quarterly)
const quarterDefault = () => {
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    return { from: iso(qStart), to: iso(now) };
};

const QUARTERS = [
    { label: 'Q1 (Jan–Mar)', m: 0 }, { label: 'Q2 (Apr–Jun)', m: 3 },
    { label: 'Q3 (Jul–Sep)', m: 6 }, { label: 'Q4 (Oct–Dec)', m: 9 },
];

export default function V201VerifyReportModal({
    isOpen, onClose, onBack,
    user, dataOwnerId,
    parties = [], taxRates = [],
    locations = [],
    taxId = null, taxName = null,
    currencySymbol = 'AED',
    onGenerateV311 = null,
}) {
    const uid = dataOwnerId || user?.uid || '';
    const currentTax = taxRates.find(t => t.id === taxId) || null;
    const ratePct = Number(currentTax?.percentage || taxRates.find(t => (norm(t.name) === norm(taxName)))?.percentage || 5);
    const rateLabel = `${Number(ratePct).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

    // ── State ──────────────────────────────────────────────────────────────
    const init = quarterDefault();
    const [from, setFrom] = useState(init.from);
    const [to, setTo] = useState(init.to);
    const [scope, setScope] = useState('input');          // 'input' | 'output'
    const [viewMode, setViewMode] = useState('supplier'); // input: supplier|invoice, output: supplier|line
    const [search, setSearch] = useState('');
    const [includeNoTax, setIncludeNoTax] = useState(false);
    const [loading, setLoading] = useState(true);

    const [invoices, setInvoices] = useState([]);
    const [payments, setPayments] = useState([]);
    const [journals, setJournals] = useState([]);
    const [locs, setLocs] = useState(locations);

    // Sync external props if provided
    useEffect(() => { if (locations?.length) setLocs(locations); }, [locations]);

    // Reset on open / tax change
    useEffect(() => {
        if (isOpen) {
            const q = quarterDefault();
            setFrom(q.from); setTo(q.to);
            setSearch(''); setViewMode('supplier'); setScope('input'); setIncludeNoTax(false);
        }
    }, [isOpen, taxId]);

    // Live subscriptions
    useEffect(() => {
        if (!isOpen || !uid) return;
        const subs = [];
        const mk = (col, setter, needUid = true) => {
            const q = needUid ? query(collection(db, col), where('userId', '==', uid)) : query(collection(db, col));
            subs.push(onSnapshot(q, (snap) => {
                setter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLoading(false);
            }, (err) => { console.error(`[V201] ${col} load error`, err); setLoading(false); }));
        };
        mk('invoices', setInvoices);
        mk('payments', setPayments);
        mk('journal_vouchers', setJournals);
        if (!locs.length) mk('locations', setLocs, false);
        return () => subs.forEach(u => u && u());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, uid]);

    // Master lookups — Map-based for O(1) access (keeps large datasets fast)
    const partyMap = useMemo(() => new Map((parties || []).map(p => [p.id, p])), [parties]);
    const locMap = useMemo(() => new Map((locs || []).map(l => [l.id, l])), [locs]);
    const taxMap = useMemo(() => new Map((taxRates || []).map(t => [String(t.id || '').trim(), t])), [taxRates]);

    const locName = (id) => locMap.get(id)?.name || '';
    const partyName = (id) => partyMap.get(id)?.name || '';
    const partyTrn = (id) => partyMap.get(id)?.trn || '';

    // Payment maps (period-scoped)
    const { paidByBill } = useMemo(() => {
        const byBill = {};
        if (!isOpen) return { paidByBill: byBill };
        (payments || []).forEach(p => {
            if (!p?.date || p.date < from || p.date > to) return;
            if (!Array.isArray(p.splits)) return;
            const rate = safeNum(p.exchangeRate || 1);
            p.splits.forEach(s => {
                const amt = safeNum(s.amount) * rate;
                if (amt <= 0) return;
                if (s.paymentAgainst === 'bill' && s.billRefId) byBill[s.billRefId] = (byBill[s.billRefId] || 0) + amt;
            });
        });
        return { paidByBill: byBill };
    }, [payments, from, to, isOpen]);

    // ── Core aggregation ───────────────────────────────────────────────────
    const build = useMemo(() => {
        const inputRows = [];
        const salesRows = [];
        const outputRows = [];
        const zeroRated = [];
        const zeroRatedSales = [];

        const flag = (r) => {
            const hasTheo = r.theoretical !== null && r.theoretical !== undefined && !isNaN(Number(r.theoretical));
            r.variation = hasTheo ? safeNum(r.actualVat) - safeNum(r.theoretical) : null;
            r.flag = hasTheo && Math.abs(r.variation) > TOL;
            r.searchStr = `${r.supplier || ''} ${r.trn || ''} ${r.voucherNo || r.ref || ''} ${r.invRef || r.taxInvNo || ''} ${r.details || ''} ${r.location || ''}`.toLowerCase();
            return r;
        };

        const taxMatches = (doc, idK, nameK) => {
            if (taxId && String(doc?.[idK] || '').trim() === taxId) return true;
            if (taxName && norm(doc?.[nameK]) === norm(taxName)) return true;
            return !taxId && !taxName;
        };
        const appliedTaxAmount = (inv) => {
            if (!Array.isArray(inv.appliedTaxes)) return 0;
            const m = inv.appliedTaxes.find(at =>
                (taxId && String(at.taxId || '').trim() === taxId) ||
                (taxName && norm(at.taxName) === norm(taxName)) ||
                (!taxId && !taxName)
            );
            return m ? safeNum(m.calculatedAmount || 0) : 0;
        };

        const inPeriod = (d) => !!d && d >= from && d <= to;

        // ============ INPUT SIDE — purchases ============
        (invoices || []).forEach(inv => {
            if (!inPeriod(inv?.date)) return;
            const isPur = inv.type === 'purchase';
            const isPurApt = inv.type === 'purchase_apt';
            const isCrNote = inv.type === 'credit_note';
            if (!isPur && !isPurApt && !isCrNote) return;
            const sign = isCrNote ? -1 : 1; // returns reduce the claim
            let taxAmt = appliedTaxAmount(inv);
            let matched = taxAmt > 0;
            if (!matched && taxMatches(inv, 'taxId', 'taxName')) { taxAmt = safeNum(inv.taxAmount || 0); matched = taxAmt > 0; }
            const total = safeNum(inv.totalAmount || inv.amount || 0);

            if (!matched || total === 0) {
                if (isPur && inv.partyId) zeroRated.push({
                    supplier: partyName(inv.partyId) || inv.partyName || 'Unknown Supplier',
                    trn: partyTrn(inv.partyId), date: inv.date, ref: inv.refNo || '',
                    taxInvNo: inv.taxInvNo || '', details: inv.narration || inv.description || '', total
                });
                return;
            }

            /*
             * STD. RATED SUPPLIES BASE = STRICTLY THE LINE-ITEM MATERIAL SUBTOTAL AT THE
             * SUPPLIER'S ORIGINAL RATE.
             * For purchases the save pipeline CAPITALIZES added internal expenses (pickup /
             * loading / labour) into item.rate & item.total (RIE), while the true supplier
             * rate used for the vendor tax invoice is preserved in item.originalRate and the
             * VAT engine taxes the ORIGINAL totals (taxAmount = originalItemsTotal × %).
             * Therefore the taxable base must be Σ qty × originalRate — never item.total
             * (which can be e.g. 899.00 gross instead of 759.00 net) — otherwise the base is
             * inflated and false negative VAT variations appear.
             */
            const itemNet = (Array.isArray(inv.items) ? inv.items : []).reduce((sum, it) => {
                const origRate = safeNum(it.originalRate);
                const v = origRate > 0
                    ? (safeNum(it.quantity) * origRate)          // true supplier/material value
                    : (safeNum(it.total) || (safeNum(it.quantity) * safeNum(it.rate))); // no uplift
                return sum + (v > 0 ? v : 0);
            }, 0);
            // 1) APT purchases carry an explicit taxable item cost; use it when present.
            let base = safeNum(inv.taxableValue || 0);
            // 2) Invoice-engine purchases: net material subtotal from line items (excl. expenses).
            if (base <= 0) base = itemNet;
            // 3) Fallback for vouchers without item lines — derive from gross net of VAT.
            if (base <= 0) base = Math.max(0, total - taxAmt);
            if (base <= 0 && safeNum(inv.amount) > 0) base = Math.max(0, safeNum(inv.amount) - taxAmt);

            inputRows.push(flag({
                source: 'INV', kind: 'input',
                supplier: partyName(inv.partyId) || inv.partyName || '(Unknown Supplier)',
                trn: partyTrn(inv.partyId),
                date: inv.date, ref: inv.refNo || '-', taxInvNo: inv.taxInvNo || '-',
                details: inv.narration || inv.description || '',
                amountPaid: safeNum(paidByBill[inv.id]),
                invoiceTotal: total, stdRated: base * sign,
                itemSubtotal: itemNet * sign,
                actualVat: taxAmt * sign, theoretical: (base * (ratePct / 100)) * sign,
                manualOnly: false,
            }));
        });

        // Manual journal INPUT VAT (DR to this VAT ledger)
        (journals || []).forEach(jv => {
            if (!inPeriod(jv?.date)) return;
            const rows = Array.isArray(jv.rows) && jv.rows.length
                ? jv.rows
                : (jv.isMulti ? [] : [
                    { type: 'dr', category: jv.drType, id: jv.drId, amount: jv.amount },
                    { type: 'cr', category: jv.crType, id: jv.crId, amount: jv.amount }
                  ].filter(r => r.id));

            const isTaxEntry = (r) => {
                if (norm(r.category) !== 'tax') return false;
                const rid = String(r.id || '').trim();
                const taxRateById = taxMap.get(rid);
                if (taxId) {
                    if (rid === taxId) return true;
                    if (taxRateById && String(taxRateById.id || '').trim() === taxId) return true;
                    if (taxName && norm(rid) === norm(taxName)) return true;
                    return false;
                }
                if (taxName) return norm(rid) === norm(taxName) || !!taxRateById;
                return true;
            };

            rows.forEach((tx, idx) => {
                if (!isTaxEntry(tx)) return;
                const vatAmt = safeNum(tx.amount);
                if (vatAmt <= 0) return;
                const others = rows.filter((r, j) => j !== idx && safeNum(r.amount) > 0);
                const partyLeg = others.find(r => norm(r.category) === 'party') || null;
                const supId = partyLeg?.id || null;
                const baseFromOthers = others.reduce((s, r) => s + safeNum(r.amount), 0);

                if (tx.type === 'dr') {
                    /*
                     * Manual journal input VAT. A taxable base can only be trusted when the voucher
                     * has EXACTLY ONE other leg (the supplier gross = net + VAT). With multiple mixed
                     * legs the base is NOT derivable — we then show it as unknown (“—”) instead of
                     * fabricating a base, which previously raised false REVIEW variations.
                     */
                    const singleOther = others.length === 1 ? safeNum(others[0].amount) : 0;
                    const derivable = singleOther > 0 && (singleOther - vatAmt) > 0;
                    const base = derivable ? (singleOther - vatAmt) : null;
                    inputRows.push(flag({
                        source: 'JV', kind: 'input',
                        supplier: supId ? (partyName(supId) || supId) : (jv.drName || jv.crName || 'Unattributed Journal'),
                        trn: supId ? partyTrn(supId) : '',
                        date: jv.date, ref: jv.refNo || 'JV', taxInvNo: '',
                        details: jv.narration || jv.description || `${jv.drName || ''} / ${jv.crName || ''}`,
                        amountPaid: 0, invoiceTotal: singleOther || safeNum(jv.amount || 0),
                        stdRated: base,
                        actualVat: vatAmt,
                        theoretical: derivable ? base * (ratePct / 100) : null,
                        manualOnly: true,
                        baseUnknown: !derivable,
                    }));
                } else {
                    outputRows.push({
                        date: jv.date, ref: jv.refNo || 'JV',
                        details: jv.narration || jv.description || `${jv.drName || ''} / ${jv.crName || ''}`,
                        base: baseFromOthers, vat: vatAmt,
                        party: partyLeg ? (partyName(partyLeg.id) || partyLeg.id) : (jv.crName || jv.drName || '-'),
                    });
                }
            });
        });

        // ============ OUTPUT SIDE — Sales (mirrors "SALE" tab) ============
        (invoices || []).forEach(inv => {
            if (!inPeriod(inv?.date)) return;
            if (inv.type !== 'sales' && inv.type !== 'debit_note') return;

            let taxAmt = appliedTaxAmount(inv);
            let matched = taxAmt > 0;
            if (!matched && taxMatches(inv, 'taxId', 'taxName')) { taxAmt = safeNum(inv.taxAmount || 0); matched = taxAmt > 0; }
            const total = safeNum(inv.totalAmount || inv.amount || 0);
            const cust = partyName(inv.partyId) || inv.partyName || '(Unknown Customer)';
            const custTrn = partyTrn(inv.partyId);
            const location = locName(inv.locationId) || inv.locationName || '';

            if (!matched || total === 0) {
                if (inv.type === 'sales') zeroRatedSales.push({
                    supplier: cust, trn: custTrn, location, date: inv.date, ref: inv.refNo || '',
                    taxInvNo: inv.taxInvNo || '', details: inv.narration || '', total
                });
                return;
            }

            let netBase = safeNum(inv.taxableValue || 0);
            if (netBase <= 0) netBase = Math.max(0, total - taxAmt);

            /*
             * SALES — ONE ROW PER TAX INVOICE.
             * Item-level columns (item name / qty / rate) are not required for VAT verification,
             * so the row is the tax invoice itself: Tax Invoice No + Customer + TRN + Value + VAT.
             * Value = Σ qty × ORIGINAL rate (pre-expense capitalization) — the amount VAT was
             * charged on — falling back to the invoice net base when no usable item lines exist.
             */
            const itemsNet = (Array.isArray(inv.items) ? inv.items : []).reduce((sum, it) => {
                const origRate = safeNum(it.originalRate);
                const v = origRate > 0
                    ? (safeNum(it.quantity) * origRate)
                    : (safeNum(it.total) || (safeNum(it.quantity) * safeNum(it.rate)));
                return sum + (v > 0 ? v : 0);
            }, 0);
            const netValue = itemsNet > 0 ? itemsNet : netBase;

            salesRows.push(flag({
                source: 'INV', kind: 'output',
                location, supplier: cust, trn: custTrn,
                voucherNo: inv.refNo || '', invRef: inv.taxInvNo || '', date: inv.date,
                value: netValue,
                amountPaid: 0, stdRated: netValue,
                actualVat: taxAmt, theoretical: netValue * (ratePct / 100),
            }));
        });

        return { inputRows, salesRows, outputRows, zeroRated, zeroRatedSales };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invoices, journals, payments, from, to, parties, locs, taxId, taxName, ratePct, paidByBill, isOpen]);

    // ── Scope-aware rows ───────────────────────────────────────────────────
    const scopeRows = scope === 'input' ? build.inputRows : build.salesRows;

    const visibleRows = useMemo(() => {
        const q = (search || '').trim().toLowerCase();
        if (!q) return scopeRows;
        return scopeRows.filter(r => (r.searchStr || '').includes(q));
    }, [scopeRows, search]);

    // Supplier / Customer roll-up
    const groupRows = useMemo(() => {
        const map = new Map();
        visibleRows.forEach(r => {
            const key = `${r.supplier}__${r.trn}__${r.location || ''}`;
            if (!map.has(key)) map.set(key, { supplier: r.supplier, trn: r.trn, location: r.location || '', count: 0, amountPaid: 0, stdRated: 0, actualVat: 0, theoretical: 0, variation: 0, flag: false, manualOnly: false, unknownBase: false });
            const g = map.get(key);
            g.count += 1;
            g.amountPaid += safeNum(r.amountPaid);
            if (r.stdRated !== null && r.stdRated !== undefined) g.stdRated += safeNum(r.stdRated);
            g.actualVat += safeNum(r.actualVat);
            if (r.theoretical !== null && r.theoretical !== undefined) g.theoretical += safeNum(r.theoretical);
            if (r.variation !== null && r.variation !== undefined) g.variation += safeNum(r.variation);
            if (r.flag) g.flag = true;
            if (r.manualOnly) g.manualOnly = true;
            if (r.baseUnknown) g.unknownBase = true;
        });
        return Array.from(map.values()).sort((a, b) => Math.abs(b.actualVat) - Math.abs(a.actualVat));
    }, [visibleRows]);

    const totals = useMemo(() => {
        const t = { groups: groupRows.length, rows: visibleRows.length, paid: 0, std: 0, actual: 0, theo: 0, var: 0, flagged: 0, noTrn: 0, manual: 0 };
        visibleRows.forEach(r => {
            t.paid += safeNum(r.amountPaid);
            if (r.stdRated !== null && r.stdRated !== undefined) t.std += safeNum(r.stdRated);
            t.actual += safeNum(r.actualVat);
            if (r.theoretical !== null && r.theoretical !== undefined) t.theo += safeNum(r.theoretical);
            if (r.variation !== null && r.variation !== undefined) t.var += safeNum(r.variation);
            if (r.flag) t.flagged++;
            if (!r.trn) t.noTrn++;
            if (r.baseUnknown) t.manual++;
        });
        return t;
    }, [visibleRows, groupRows]);

    const fmtOrDash = (v, f = fmt2) => (v === null || v === undefined || v === '' ? '—' : f(v));

    const outputTotal = useMemo(() => build.outputRows.reduce((s, r) => s + safeNum(r.vat), 0), [build.outputRows]);

    const fmtFlag = (n) => {
        if (n === null || n === undefined) return <span className="text-slate-300 font-bold">—</span>;
        const v = safeNum(n);
        if (Math.abs(v) < TOL) return <span className="text-emerald-600 font-black">{fmt3(v)}</span>;
        return <span className="text-rose-600 font-black">{v < 0 ? '▼ ' : '▲ '}{fmt3(v)}</span>;
    };

    // ── Exports ─────────────────────────────────────────────────────────────
    const headerMeta = () => ({
        report: `V201 VERIFY REPORT — UAE VAT RETURN PRE-VERIFICATION`,
        tax: `Tax: ${currentTax?.name || taxName || 'VAT'} @ ${rateLabel}`,
        period: `Period: ${fmtDate(from)}  to  ${fmtDate(to)}`,
        cur: currencySymbol || 'AED',
    });

    const downloadXLSX = async () => {
        try {
            const XLSX = await import('xlsx');
            const meta = headerMeta();
            const wb = XLSX.utils.book_new();

            if (scope === 'input') {
                const rows = viewMode === 'supplier'
                    ? groupRows.map(g => ({
                        'Supplier Name': g.supplier, 'TRN': g.trn || '', 'No. of Vouchers': g.count,
                        [`Amount Paid (${meta.cur})`]: +safeNum(g.amountPaid).toFixed(2),
                        [`Std-Rated Supplies (${meta.cur})`]: +safeNum(g.stdRated).toFixed(2),
                        [`Actual VAT (${meta.cur})`]: +safeNum(g.actualVat).toFixed(2),
                        'Status': g.flag ? 'REVIEW' : (g.unknownBase ? 'MANUAL JV' : (g.trn ? 'OK' : 'NO TRN')),
                    }))
                    : visibleRows.map(r => ({
                        'Supplier Name': r.supplier, 'TRN': r.trn || '', 'Date': r.date, 'Vch/Ref': r.ref,
                        'Tax Inv No.': r.taxInvNo, 'Transaction Details': r.details, 'Source': r.source,
                        [`Amount Paid (${meta.cur})`]: +safeNum(r.amountPaid).toFixed(2),
                        [`Std-Rated Supplies (${meta.cur})`]: (r.stdRated === null || r.stdRated === undefined) ? '' : +safeNum(r.stdRated).toFixed(2),
                        [`Actual VAT (${meta.cur})`]: +safeNum(r.actualVat).toFixed(2),
                        'Status': r.flag ? 'REVIEW' : (r.baseUnknown ? 'MANUAL JV' : (!r.trn ? 'NO TRN' : 'OK')),
                    }));
                // CLEAN SHEET for VAT-app upload: column headers on row 1, data from row 2 —
                // no title/period/currency/tolerance rows, no section captions, and no
                // Theoretical/Variation analysis columns (actual figures only).
                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = viewMode === 'supplier'
                    ? [{ wch: 26 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 10 }]
                    : [{ wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 40 }, { wch: 8 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 10 }];
                XLSX.utils.book_append_sheet(wb, ws, 'Purchase (Input)');
            } else {
                // SALE tab — exact reference layout
                const rows = viewMode === 'supplier'
                    ? groupRows.map(g => ({
                        'Customer Name': g.supplier, 'TRN': g.trn || '', 'Invoices': g.count,
                        [`Net Value (${meta.cur})`]: +safeNum(g.stdRated).toFixed(2),
                        [`Actual Output VAT (${meta.cur})`]: +safeNum(g.actualVat).toFixed(2),
                        'Status': g.flag ? 'REVIEW' : (g.trn ? 'OK' : 'NO TRN'),
                    }))
                    : visibleRows.map(r => ({
                        'Voucher No.': r.voucherNo,
                        'Tax Invoice No.': r.invRef,
                        'Voucher Date': r.date,
                        'Customer Name': r.supplier,
                        'Customer TRN': String(r.trn || ''),
                        'Net Value': +safeNum(r.value || r.stdRated).toFixed(3),
                        'VAT (Actual Collected)': +safeNum(r.actualVat).toFixed(3),
                    }));
                // CLEAN SHEET for VAT-app upload: headers row 1, data row 2 onward (no
                // Theoretical/Variation analysis columns — actual figures only).
                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = viewMode === 'supplier'
                    ? [{ wch: 30 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 20 }, { wch: 10 }]
                    : [{ wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];
                XLSX.utils.book_append_sheet(wb, ws, 'SALE');
            }

            XLSX.writeFile(wb, `V201_Verify_${scope === 'input' ? 'Purchase' : 'Sale'}_${from}_${to}.xlsx`);
        } catch (e) {
            console.error('[V201] Excel export error', e);
            alert('Excel export failed: ' + e.message);
        }
    };

    const downloadPDF = async () => {
        try {
            const jsPDFModule = await import('jspdf');
            const atModule = await import('jspdf-autotable');
            // jspdf v3 exposes the constructor as the NAMED export (`{ jsPDF }`) — the same
            // pattern every other working PDF export in this app uses. Fall back defensively for
            // CJS/ESM interop shapes so `new jsPDF()` never throws.
            const jsPDF = jsPDFModule.jsPDF
                || (jsPDFModule.default && jsPDFModule.default.jsPDF)
                || jsPDFModule.default;
            const autoTable = (typeof atModule.default === 'function')
                ? atModule.default
                : (atModule.autoTable || (atModule.default && atModule.default.default));
            if (typeof jsPDF !== 'function') throw new Error('jsPDF constructor unavailable');
            if (typeof autoTable !== 'function') throw new Error('jspdf-autotable unavailable');
            const doc = new jsPDF({ orientation: 'landscape' });
            const meta = headerMeta();
            const pageW = doc.internal.pageSize.getWidth();
            const margin = 8;
            const isSales = scope === 'output';

            doc.setFillColor(isSales ? 12 : 16, isSales ? 74 : 87, isSales ? 110 : 55);
            doc.rect(0, 0, pageW, 20, 'F');
            doc.setTextColor(255, 255, 255); doc.setFontSize(13); doc.setFont(undefined, 'bold');
            doc.text(isSales ? 'V201 VERIFY REPORT — SALES (OUTPUT VAT) VERIFICATION' : 'V201 VERIFY REPORT — UAE VAT RETURN PRE-VERIFICATION', margin, 10);
            doc.setFontSize(8); doc.setFont(undefined, 'normal');
            doc.text(`${meta.tax}   |   ${meta.period}   |   Currency: ${meta.cur}`, margin, 16);

            const headSales = viewMode === 'supplier'
                ? [['Customer Name', 'TRN', 'Lines', 'Net Value', 'Actual Output VAT', `VAT Check ${rateLabel}`, 'Variation', 'Status']]
                : [['Voucher No.', 'Tax Invoice No.', 'Voucher Date', 'Customer Name', 'Customer TRN', 'Net Value', 'VAT (Actual)', `VAT Check ${rateLabel}`, 'Variation']];
            const bodySales = viewMode === 'supplier'
                ? groupRows.map(g => [g.supplier, g.trn || '-', String(g.count), fmt2(g.stdRated), fmt2(g.actualVat), fmt2(g.theoretical), fmt2(g.variation), g.flag ? 'REVIEW' : (g.trn ? 'OK' : 'NO TRN')])
                : visibleRows.map(r => [r.voucherNo || '-', r.invRef || '-', fmtDate(r.date), r.supplier, r.trn || '-', fmt3(r.value || r.stdRated), fmt3(r.actualVat), fmt3(r.theoretical), fmt3(r.variation)]);
            const headInput = viewMode === 'supplier'
                ? [['Supplier Name', 'TRN', 'Vch', 'Amount Paid', 'Std. Rated Supplies', 'Actual VAT', `Theoretical ${rateLabel}`, 'Variation', 'Status']]
                : [['Supplier Name', 'TRN', 'Date', 'Vch/Ref', 'Tax Inv No.', 'Transaction Details', 'Src', 'Amount Paid', 'Std. Rated', 'Actual VAT', `Theo ${rateLabel}`, 'Variation']];
            const bodyInput = viewMode === 'supplier'
                ? groupRows.map(g => [g.supplier, g.trn || '-', String(g.count), fmt2(g.amountPaid), fmt2(g.stdRated), fmt2(g.actualVat), fmt2(g.theoretical), fmt2(g.variation), g.flag ? 'REVIEW' : (g.unknownBase ? 'MANUAL JV' : (g.trn ? 'OK' : 'NO TRN'))])
                : visibleRows.map(r => [r.supplier, r.trn || '-', fmtDate(r.date), r.ref, r.taxInvNo, r.details || '-', r.source, fmt2(r.amountPaid), fmtOrDash(r.stdRated), fmt2(r.actualVat), fmtOrDash(r.theoretical), fmtOrDash(r.variation)]);

            const tblResult = autoTable(doc, {
                startY: 26,
                head: isSales ? headSales : headInput,
                body: isSales ? bodySales : bodyInput,
                margin: { left: margin, right: margin },
                styles: { fontSize: 7, cellPadding: 1.5 },
                headStyles: { fillColor: isSales ? [12, 74, 110] : [16, 87, 55], fontSize: 7 },
                alternateRowStyles: { fillColor: isSales ? [240, 247, 250] : [245, 250, 247] },
                columnStyles: isSales && viewMode !== 'supplier' ? { 3: { cellWidth: 62 } } : (isSales ? {} : (viewMode !== 'supplier' ? { 4: { cellWidth: 20 }, 5: { cellWidth: 78 } } : {})),
            });

            // jspdf-autotable v5 returns the table; older/newer builds expose doc.lastAutoTable.
            // Fall back to a safe position so the footer never throws.
            const finalY = (tblResult && typeof tblResult.finalY === 'number')
                ? tblResult.finalY
                : (doc.lastAutoTable && typeof doc.lastAutoTable.finalY === 'number'
                    ? doc.lastAutoTable.finalY
                    : (doc.internal.pageSize.getHeight() - 22));
            const fy = finalY + 4;
            doc.setFillColor(isSales ? 215 : 220, isSales ? 232 : 235, isSales ? 240 : 225);
            doc.rect(margin, fy, pageW - 2 * margin, 8, 'F');
            doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(isSales ? 12 : 16, isSales ? 74 : 87, isSales ? 110 : 55);
            const totalTxt = isSales
                ? `TOTALS   |   Customers: ${totals.groups}   Lines: ${totals.rows}   Net Value: ${fmt2(totals.std)}   Output VAT: ${fmt2(totals.actual)}   VAT Check: ${fmt2(totals.theo)}   Variation: ${fmt2(totals.var)}   |   Flagged: ${totals.flagged}   Missing TRN: ${totals.noTrn}`
                : `TOTALS   |   Paid: ${fmt2(totals.paid)}   Std. Rated: ${fmt2(totals.std)}   Actual VAT: ${fmt2(totals.actual)}   Theoretical: ${fmt2(totals.theo)}   Variation: ${fmt2(totals.var)}   |   Flagged: ${totals.flagged}   Missing TRN: ${totals.noTrn}`;
            doc.text(totalTxt, margin + 1, fy + 5.5, { maxWidth: pageW - (2 * margin) - 2 });
            doc.save(`V201_Verify_${scope === 'input' ? 'Purchase' : 'Sale'}_${from}_${to}.pdf`);
        } catch (e) {
            console.error('[V201] PDF export error', e);
            alert('PDF export failed: ' + e.message);
        }
    };

    if (!isOpen) return null;

    // ── Style tokens ────────────────────────────────────────────────────────
    const isSales = scope === 'output';
    const th = 'px-2 py-2 text-left text-[9px] font-black uppercase tracking-widest text-white border-r border-white/10';
    const thR = 'px-2 py-2 text-right text-[9px] font-black uppercase tracking-widest text-white border-r border-white/10';
    const td = 'px-2 py-1.5 border-b border-slate-100 text-[10.5px] align-top';
    const tdR = 'px-2 py-1.5 border-b border-slate-100 text-[10.5px] text-right tabular-nums align-top';
    const accentBar = isSales ? 'bg-gradient-to-r from-sky-900 to-sky-700' : 'bg-gradient-to-r from-emerald-900 to-emerald-700';
    const accentHead = isSales ? 'bg-sky-900' : 'bg-emerald-800';
    const accentFoot = isSales ? 'bg-sky-950' : 'bg-emerald-900';

    const statCard = 'bg-white rounded-xl border border-slate-200 p-3 shadow-sm';
    const statLbl = 'text-[8.5px] font-black uppercase tracking-widest text-slate-400';
    const statVal = 'text-base font-black text-slate-800 tabular-nums mt-1';

    const empty = (msg) => (
        <div className="p-10 text-center">
            <div className="text-3xl mb-2 opacity-20"><ShieldCheck size={40} className="mx-auto" /></div>
            <p className="text-xs font-bold text-slate-400">{msg}</p>
        </div>
    );

    const StatusBadge = ({ r }) => {
        if (r.flag) return <span className="text-[8.5px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded uppercase">Review</span>;
        if (r.unknownBase) return <span className="text-[8.5px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase" title="Manual journal entry — taxable base not derivable from the voucher">Manual JV</span>;
        if (!r.trn) return <span className="text-[8.5px] font-black text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded uppercase">No TRN</span>;
        return <span className="text-[8.5px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">OK</span>;
    };

    return (
        <>
            <style>{`.v201-scroll::-webkit-scrollbar{height:8px;width:8px}.v201-scroll::-webkit-scrollbar-thumb{background:#a7d7c0;border-radius:8px}.v201-scroll::-webkit-scrollbar-track{background:#f1f5f9}`}</style>
            <div className={`fixed inset-0 z-[10050] ${isSales ? 'bg-[#0b2438]/85' : 'bg-[#0b2e1d]/80'} backdrop-blur-[2px] flex items-start justify-center overflow-hidden animate-in fade-in duration-150`}>
                <div className="w-full h-full bg-[#f3f6f4] flex flex-col">
                    {/* ── Header ── */}
                    <div className={`h-11 ${accentBar} text-white flex items-center justify-between px-3 flex-shrink-0 shadow-md`}>
                        <div className="flex items-center gap-2 min-w-0">
                            <button onClick={onBack || onClose} className="p-1 hover:bg-white/15 rounded transition-colors shrink-0" title="Back">
                                <ArrowLeft size={17} />
                            </button>
                            <div className="w-7 h-7 rounded-md bg-white/15 flex items-center justify-center text-[11px] font-black shrink-0">V</div>
                            <div className="leading-tight min-w-0">
                                <div className="text-[12px] font-black tracking-wide truncate">V201 VERIFY REPORT — {isSales ? 'SALES (OUTPUT VAT)' : 'PURCHASES (INPUT VAT)'}</div>
                                <div className="text-[8px] text-white/70 font-bold truncate">UAE VAT RETURN PRE-VERIFICATION — {currentTax?.name || taxName || 'VAT'} @ {rateLabel} · {currencySymbol || 'AED'}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={downloadXLSX} className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[9.5px] font-black flex items-center gap-1 border border-white/20 transition-colors" title="Export Excel">
                                <FileSpreadsheet size={12} /> XLS
                            </button>
                            <button onClick={downloadPDF} className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[9.5px] font-black flex items-center gap-1 border border-white/20 transition-colors" title="Export PDF">
                                <FileText size={12} /> PDF
                            </button>
                            {onGenerateV311 && (
                                <button onClick={onGenerateV311}
                                    className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[9.5px] font-black flex items-center gap-1 border border-amber-600/40 transition-colors shadow-sm"
                                    title="Verify first, then generate the official UAE FTA VAT 311 Common Template legal reports (Box 1 Sales / Box 9 Purchases)">
                                    <ShieldCheck size={12} /> VAT 311 Reports
                                </button>
                            )}
                            <button onClick={onClose} className="p-1.5 hover:bg-white/15 rounded-lg transition-colors" title="Close"><X size={17} /></button>
                        </div>
                    </div>

                    {/* ── Toolbar ── */}
                    <div className="bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap items-center gap-2 flex-shrink-0">
                        {/* SCOPE TOGGLE */}
                        <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden bg-white shadow-sm">
                            {[['input', '📥 Purchases (Input VAT)'], ['output', '🧾 Sales (Output VAT)']].map(([val, lbl]) => (
                                <button key={val}
                                    onClick={() => { setScope(val); setSearch(''); setViewMode('supplier'); }}
                                    className={`px-3 py-1.5 text-[9.5px] font-black uppercase tracking-wide transition-colors ${scope === val ? (val === 'output' ? 'bg-sky-800 text-white' : 'bg-emerald-700 text-white') : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                    {lbl}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Period</span>
                            <input type="date" value={from} max={to}
                                onChange={(e) => setFrom(e.target.value)}
                                className="px-2 py-1 border border-slate-300 rounded-md text-[11px] font-bold outline-none focus:border-emerald-600 bg-white text-slate-800" />
                            <span className="text-slate-400 text-[11px] font-black">→</span>
                            <input type="date" value={to} min={from}
                                onChange={(e) => setTo(e.target.value)}
                                className="px-2 py-1 border border-slate-300 rounded-md text-[11px] font-bold outline-none focus:border-emerald-600 bg-white text-slate-800" />
                        </div>
                        <select
                            value={`${from}|${to}`}
                            onChange={(e) => { const [f, t] = e.target.value.split('|'); setFrom(f); setTo(t); }}
                            className="px-2 py-1 border border-slate-300 rounded-md text-[10px] font-black outline-none bg-white text-slate-700"
                            title="Quick period presets (VAT 201 is quarterly)"
                        >
                            {QUARTERS.map(q => {
                                const y = new Date().getFullYear();
                                const f = iso(new Date(y, q.m, 1));
                                const t = iso(new Date(y, q.m + 3, 0));
                                return <option key={q.label} value={`${f}|${t}`}>{q.label} {y}</option>;
                            })}
                            <option value={`${init.from}|${init.to}`}>Current Quarter</option>
                            <option value={`${iso(new Date(new Date().getFullYear(), 0, 1))}|${iso(new Date(new Date().getFullYear(), 11, 31))}`}>Full Year</option>
                        </select>

                        <div className="w-px h-5 bg-slate-200 mx-1" />

                        <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden bg-white">
                            {(isSales
                                ? [['supplier', 'By Customer'], ['line', 'Tax Invoice Detail']]
                                : [['supplier', 'By Supplier'], ['invoice', 'Invoice Detail']]
                            ).map(([m, lbl]) => (
                                <button key={m} onClick={() => setViewMode(m)}
                                    className={`px-3 py-1 text-[9.5px] font-black uppercase tracking-wide transition-colors ${viewMode === m ? (isSales ? 'bg-sky-800 text-white' : 'bg-emerald-700 text-white') : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                    {lbl}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1" />
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 min-w-[200px]">
                            <Search size={12} className="text-slate-400 shrink-0" />
                            <input value={search} onChange={(e) => setSearch(e.target.value)}
                                placeholder={isSales ? 'Search customer / item / voucher...' : 'Search supplier / TRN / invoice...'}
                                className="bg-transparent outline-none text-[10.5px] font-semibold w-full text-slate-700 placeholder:text-slate-400" />
                        </div>
                        <label className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 cursor-pointer" title="List transactions in period that carry NO VAT (possible missing VAT)">
                            <input type="checkbox" checked={includeNoTax} onChange={(e) => setIncludeNoTax(e.target.checked)} className="accent-amber-600" />
                            <span className="text-[9px] font-black text-amber-700 uppercase">
                                {isSales ? `No-VAT sales (${build.zeroRatedSales.length})` : `No-VAT purchases (${build.zeroRated.length})`}
                            </span>
                        </label>
                    </div>

                    {/* ── Summary cards ── */}
                    <div className="px-3 pt-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 flex-shrink-0">
                        <div className={statCard}><div className={statLbl}>{isSales ? 'Customers' : 'Suppliers'}</div><div className={statVal}>{fmtInt(totals.groups)}</div></div>
                        <div className={statCard}><div className={statLbl}>{isSales ? 'Tax Invoices' : 'Vouchers'}</div><div className={statVal}>{fmtInt(totals.rows)}</div></div>
                        {isSales ? (
                            <>
                                <div className={statCard}><div className={statLbl}>Net Value ({currencySymbol || 'AED'})</div><div className={`${statVal} text-sky-800`}>{fmt2(totals.std)}</div></div>
                                <div className={statCard}><div className={statLbl}>Output VAT Collected</div><div className={`${statVal} text-blue-800`}>{fmt2(totals.actual)}</div></div>
                                <div className={statCard}><div className={statLbl}>VAT Check {rateLabel}</div><div className={statVal}>{fmt2(totals.theo)}</div></div>
                                <div className={`${statCard} ${Math.abs(totals.var) > TOL ? 'border-rose-300 bg-rose-50' : 'border-sky-300 bg-sky-50'}`}>
                                    <div className={statLbl}>Variation / Flagged</div>
                                    <div className={`${statVal} ${Math.abs(totals.var) > TOL ? 'text-rose-700' : 'text-sky-700'}`}>{fmt2(totals.var)} {totals.flagged > 0 && <span className="text-[9px]">· {totals.flagged} flag</span>}</div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className={statCard}><div className={statLbl}>Amount Paid ({currencySymbol || 'AED'})</div><div className={`${statVal} text-emerald-800`}>{fmt2(totals.paid)}</div></div>
                                <div className={statCard}><div className={statLbl}>Std-Rated Supplies</div><div className={statVal}>{fmt2(totals.std)}</div></div>
                                <div className={statCard}><div className={statLbl}>Actual VAT</div><div className={statVal}>{fmt2(totals.actual)}</div></div>
                                <div className={statCard}><div className={statLbl}>Theoretical {rateLabel}</div><div className={statVal}>{fmt2(totals.theo)}</div></div>
                                <div className={`${statCard} ${Math.abs(totals.var) > TOL ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
                                    <div className={statLbl}>Variation / Flagged</div>
                                    <div className={`${statVal} ${Math.abs(totals.var) > TOL ? 'text-rose-700' : 'text-emerald-700'}`}>{fmt2(totals.var)} {totals.flagged > 0 && <span className="text-[9px]">· {totals.flagged} flag</span>}{totals.manual > 0 && <span className="text-[9px] text-amber-700"> · {totals.manual} manual</span>}</div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* ── Grid ── */}
                    <div className="flex-1 overflow-auto p-3 pt-2 v201-scroll">
                        {!loading && isSales && build.salesRows.length === 0 && (
                            <div className="mb-2 px-3 py-2 rounded-lg border border-sky-200 bg-sky-50 flex items-start gap-2">
                                <AlertTriangle size={13} className="text-sky-700 mt-0.5 shrink-0" />
                                <p className="text-[10.5px] font-semibold text-sky-900 leading-relaxed">
                                    No VAT-charged sales invoices found for this period/tax. Only invoices that carry <b>Actual VAT</b> are reconciled here;
                                    sales without VAT appear when you tick <b>No-VAT sales</b>. Confirm the tax is applied on the sales vouchers.
                                </p>
                            </div>
                        )}
                        {!loading && !isSales && build.inputRows.length === 0 && build.outputRows.length > 0 && (
                            <div className="mb-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 flex items-start gap-2">
                                <AlertTriangle size={13} className="text-blue-600 mt-0.5 shrink-0" />
                                <p className="text-[10.5px] font-semibold text-blue-800 leading-relaxed">
                                    This tax ledger has <b>{build.outputRows.length} output-VAT (journal CR)</b> entries in the period but no VAT-bearing purchase vouchers —
                                    switch to <b>Sales (Output VAT)</b> for the output side, or reconcile purchases carrying VAT for Box 5.
                                </p>
                            </div>
                        )}

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            {loading ? (
                                <div className="p-14 text-center text-xs font-bold text-slate-400">Loading transaction data…</div>
                            ) : isSales && viewMode === 'line' ? (
                                /* ════════ SALES — TAX INVOICE DETAIL (one row per tax invoice) ════════ */
                                <>
                                    <div className="overflow-auto max-h-[60vh]">
                                        <table className="w-full border-collapse">
                                            <thead className="sticky top-0 z-10">
                                                <tr className={accentHead}>
                                                    <th className={th}>Voucher No.</th>
                                                    <th className={th}>Tax Invoice No.</th>
                                                    <th className={th}>Voucher Date</th>
                                                    <th className={th}>Customer Name</th>
                                                    <th className={th}>Customer TRN</th>
                                                    <th className={thR}>Net Value</th>
                                                    <th className={thR}>VAT (Actual)</th>
                                                    <th className={thR}>VAT Check {rateLabel}</th>
                                                    <th className={`${thR} !border-r-0`}>Variation</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {visibleRows.length === 0 && (
                                                    <tr><td colSpan={9}>{empty(build.salesRows.length === 0 ? 'No VAT-bearing sales found in this period for the selected tax.' : 'No rows match your search.')}</td></tr>
                                                )}
                                                {visibleRows.map((r, i) => (
                                                    <tr key={i} className={`hover:bg-sky-50/60 transition-colors ${i % 2 ? 'bg-slate-50/60' : 'bg-white'} ${r.flag ? 'bg-rose-50/80 hover:bg-rose-50' : ''}`}>
                                                        <td className={`${td} whitespace-nowrap font-black text-slate-800`}>{r.voucherNo || '-'}</td>
                                                        <td className={`${td} whitespace-nowrap font-bold text-blue-700`}>{r.invRef || '-'}</td>
                                                        <td className={`${td} whitespace-nowrap text-slate-500 font-bold`}>{fmtDate(r.date)}</td>
                                                        <td className={td}><div className="font-black text-slate-800">{r.supplier}</div></td>
                                                        <td className={td}>{r.trn
                                                            ? <span className="font-bold text-slate-600">{r.trn}</span>
                                                            : <span className="text-[8px] font-black text-rose-500 bg-rose-50 px-1 py-0.5 rounded">NO TRN</span>}</td>
                                                        <td className={`${tdR} font-black text-slate-800`}>{fmt3(r.value || r.stdRated)}</td>
                                                        <td className={`${tdR} font-black text-blue-800`}>{fmt3(r.actualVat)}</td>
                                                        <td className={`${tdR} font-bold text-slate-600`}>{fmt3(r.theoretical)}</td>
                                                        <td className={`${tdR} !border-r-0`}>{fmtFlag(r.variation)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            {visibleRows.length > 0 && (
                                                <tfoot>
                                                    <tr className={accentFoot}>
                                                        <td className={`${td} font-black !border-0`} colSpan={5}>TOTALS ({visibleRows.length} tax invoices)</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt3(totals.std)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt3(totals.actual)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt3(totals.theo)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt3(totals.var)}</td>
                                                    </tr>
                                                </tfoot>
                                            )}
                                        </table>
                                    </div>
                                    {includeNoTax && build.zeroRatedSales.length > 0 && (
                                        <div className="border-t-2 border-amber-300">
                                            <div className="px-3 py-1.5 bg-amber-100 text-[9px] font-black text-amber-800 uppercase tracking-widest flex items-center gap-1.5">
                                                <AlertTriangle size={11} /> Sales with NO VAT in period ({build.zeroRatedSales.length}) — zero-rated / exempt / missing VAT
                                            </div>
                                            <div className="overflow-auto max-h-[22vh]">
                                                <table className="w-full">
                                                    <thead><tr className="bg-amber-50 text-amber-800">
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Customer</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">TRN</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Location</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Date</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Vch/Ref</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Tax Inv No.</th>
                                                        <th className="px-2 py-1.5 text-right text-[8.5px] font-black uppercase">Total</th>
                                                    </tr></thead>
                                                    <tbody>
                                                        {build.zeroRatedSales.map((z, i) => (
                                                            <tr key={i} className="border-t border-amber-100">
                                                                <td className="px-2 py-1 text-[10px] font-bold text-slate-700">{z.supplier}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{z.trn || '-'}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{z.location || '-'}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{fmtDate(z.date)}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{z.ref}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{z.taxInvNo}</td>
                                                                <td className="px-2 py-1 text-[10px] text-right font-bold text-slate-600">{fmt2(z.total)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : isSales && viewMode === 'supplier' ? (
                                /* ════════ SALES — BY CUSTOMER ════════ */
                                <>
                                    <div className="overflow-auto max-h-[60vh]">
                                        <table className="w-full border-collapse">
                                            <thead className="sticky top-0 z-10">
                                                <tr className={accentHead}>
                                                    <th className={th}>Customer Name</th>
                                                    <th className={th}>TRN</th>
                                                    <th className={th}>Location</th>
                                                    <th className={thR}>Invoices</th>
                                                    <th className={thR}>Net Value</th>
                                                    <th className={thR}>Output VAT Collected</th>
                                                    <th className={thR}>VAT Check {rateLabel}</th>
                                                    <th className={thR}>Variation</th>
                                                    <th className={`${th} !border-r-0`}>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {groupRows.length === 0 && (
                                                    <tr><td colSpan={9}>{empty(build.salesRows.length === 0 ? 'No VAT-bearing sales found in this period for the selected tax.' : 'No rows match your search.')}</td></tr>
                                                )}
                                                {groupRows.map((g, i) => (
                                                    <tr key={i} className={`hover:bg-sky-50/60 transition-colors ${i % 2 ? 'bg-slate-50/60' : 'bg-white'} ${g.flag ? 'bg-rose-50/80 hover:bg-rose-50' : ''}`}>
                                                        <td className={td}><div className="font-black text-slate-800">{g.supplier}</div></td>
                                                        <td className={td}>{g.trn
                                                            ? <span className="font-bold text-slate-600">{g.trn}</span>
                                                            : <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">NO TRN</span>}</td>
                                                        <td className={`${td} text-slate-500 font-bold`}>{g.location || '-'}</td>
                                                        <td className={`${tdR} font-black text-slate-700`}>{g.count}</td>
                                                        <td className={`${tdR} font-black text-slate-800`}>{fmt2(g.stdRated)}</td>
                                                        <td className={`${tdR} font-black text-blue-800`}>{fmt2(g.actualVat)}</td>
                                                        <td className={`${tdR} font-bold text-slate-600`}>{fmt2(g.theoretical)}</td>
                                                        <td className={tdR}>{fmtFlag(g.variation)}</td>
                                                        <td className={td}><StatusBadge r={g} /></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            {groupRows.length > 0 && (
                                                <tfoot>
                                                    <tr className={accentFoot}>
                                                        <td className={`${td} font-black !border-0`} colSpan={4}>TOTALS ({groupRows.length} customers · {totals.rows} invoices)</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.std)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.actual)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.theo)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.var)}</td>
                                                        <td className={`${td} !border-0`}><span className="text-[8.5px] font-black">{totals.flagged} flagged</span></td>
                                                    </tr>
                                                </tfoot>
                                            )}
                                        </table>
                                    </div>
                                </>
                            ) : !isSales && viewMode === 'supplier' ? (
                                /* ════════ PURCHASE — BY SUPPLIER ════════ */
                                <>
                                    <div className="overflow-auto max-h-[60vh]">
                                        <table className="w-full border-collapse">
                                            <thead className="sticky top-0 z-10">
                                                <tr className={accentHead}>
                                                    <th className={th}>Supplier Name</th>
                                                    <th className={th}>TRN</th>
                                                    <th className={thR}>Vch</th>
                                                    <th className={thR}>Amount Paid ({currencySymbol || 'AED'})</th>
                                                    <th className={thR}>Std. Rated Supplies</th>
                                                    <th className={thR}>Actual VAT Paid</th>
                                                    <th className={thR}>Theoretical {rateLabel}</th>
                                                    <th className={thR}>Variation</th>
                                                    <th className={`${th} !border-r-0`}>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {groupRows.length === 0 && (
                                                    <tr><td colSpan={9}>{empty(build.inputRows.length === 0 ? 'No VAT-bearing purchase vouchers found in this period for the selected tax.' : 'No rows match your search.')}</td></tr>
                                                )}
                                                {groupRows.map((g, i) => (
                                                    <tr key={i} className={`hover:bg-emerald-50/50 transition-colors ${i % 2 ? 'bg-slate-50/60' : 'bg-white'} ${g.flag ? 'bg-rose-50/70 hover:bg-rose-50' : ''}`}>
                                                        <td className={td}>
                                                            <div className="font-black text-slate-800">{g.supplier}</div>
                                                            {g.manualOnly && <div className="text-[8.5px] font-bold text-amber-600 uppercase tracking-wide">Manual JV entry</div>}
                                                        </td>
                                                        <td className={td}>{g.trn
                                                            ? <span className="font-bold text-slate-600">{g.trn}</span>
                                                            : <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">NO TRN</span>}</td>
                                                        <td className={`${tdR} font-black text-slate-700`}>{g.count}</td>
                                                        <td className={`${tdR} font-bold text-emerald-800`}>{fmt2(g.amountPaid)}</td>
                                                        <td className={`${tdR} font-bold text-slate-700`}>{g.unknownBase && !g.theoretical ? '—' : fmt2(g.stdRated)}</td>
                                                        <td className={`${tdR} font-black text-blue-800`}>{fmt2(g.actualVat)}</td>
                                                        <td className={`${tdR} font-bold text-slate-600`}>{g.unknownBase && !g.theoretical ? '—' : fmt2(g.theoretical)}</td>
                                                        <td className={tdR}>{g.unknownBase && !g.theoretical ? <span className="text-slate-300 font-bold">—</span> : fmtFlag(g.variation)}</td>
                                                        <td className={td}><StatusBadge r={g} /></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            {groupRows.length > 0 && (
                                                <tfoot>
                                                    <tr className={accentFoot}>
                                                        <td className={`${td} font-black !border-0`} colSpan={2}>TOTALS ({groupRows.length} suppliers)</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmtInt(totals.rows)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.paid)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.std)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.actual)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.theo)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.var)}</td>
                                                        <td className={`${td} !border-0`}><span className="text-[8.5px] font-black">{totals.flagged} flagged</span></td>
                                                    </tr>
                                                </tfoot>
                                            )}
                                        </table>
                                    </div>
                                    {includeNoTax && build.zeroRated.length > 0 && (
                                        <div className="border-t-2 border-amber-300">
                                            <div className="px-3 py-1.5 bg-amber-100 text-[9px] font-black text-amber-800 uppercase tracking-widest flex items-center gap-1.5">
                                                <AlertTriangle size={11} /> Purchases with NO VAT in period ({build.zeroRated.length}) — review (zero-rated / exempt / missing VAT)
                                            </div>
                                            <div className="overflow-auto max-h-[22vh]">
                                                <table className="w-full">
                                                    <thead><tr className="bg-amber-50 text-amber-800">
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Supplier</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">TRN</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Date</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Vch/Ref</th>
                                                        <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Tax Inv No.</th>
                                                        <th className="px-2 py-1.5 text-right text-[8.5px] font-black uppercase">Total</th>
                                                    </tr></thead>
                                                    <tbody>
                                                        {build.zeroRated.map((z, i) => (
                                                            <tr key={i} className="border-t border-amber-100">
                                                                <td className="px-2 py-1 text-[10px] font-bold text-slate-700">{z.supplier}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{z.trn || '-'}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{fmtDate(z.date)}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{z.ref}</td>
                                                                <td className="px-2 py-1 text-[10px] text-slate-500">{z.taxInvNo}</td>
                                                                <td className="px-2 py-1 text-[10px] text-right font-bold text-slate-600">{fmt2(z.total)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                /* ════════ PURCHASE — INVOICE DETAIL ════════ */
                                <>
                                    <div className="overflow-auto max-h-[60vh]">
                                        <table className="w-full border-collapse">
                                            <thead className="sticky top-0 z-10">
                                                <tr className={accentHead}>
                                                    <th className={th}>Supplier Name</th>
                                                    <th className={th}>TRN</th>
                                                    <th className={th}>Date</th>
                                                    <th className={th}>Vch / Ref</th>
                                                    <th className={th}>Tax Inv No.</th>
                                                    <th className={th}>Transaction Details</th>
                                                    <th className={`${th} !w-8`}>Src</th>
                                                    <th className={thR}>Amount Paid</th>
                                                    <th className={thR}>Std. Rated Supplies</th>
                                                    <th className={thR}>Actual VAT Paid</th>
                                                    <th className={thR}>Theoretical {rateLabel}</th>
                                                    <th className={`${thR} !border-r-0`}>Variation</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {visibleRows.length === 0 && (
                                                    <tr><td colSpan={12}>{empty(build.inputRows.length === 0 ? 'No VAT-bearing purchase vouchers found in this period for the selected tax.' : 'No rows match your search.')}</td></tr>
                                                )}
                                                {visibleRows.map((r, i) => (
                                                    <tr key={i} className={`hover:bg-emerald-50/50 transition-colors ${i % 2 ? 'bg-slate-50/60' : 'bg-white'} ${r.flag ? 'bg-rose-50/70' : ''}`}>
                                                        <td className={td}>
                                                            <div className="font-black text-slate-800">{r.supplier}</div>
                                                            {r.manualOnly && <div className="text-[8px] font-bold text-amber-600 uppercase">Manual JV</div>}
                                                        </td>
                                                        <td className={td}>{r.trn
                                                            ? <span className="font-bold text-slate-600">{r.trn}</span>
                                                            : <span className="text-[8.5px] font-black text-rose-500 bg-rose-50 px-1 py-0.5 rounded">NO TRN</span>}</td>
                                                        <td className={`${td} whitespace-nowrap text-slate-500 font-bold`}>{fmtDate(r.date)}</td>
                                                        <td className={`${td} whitespace-nowrap font-bold text-blue-700`}>{r.ref}</td>
                                                        <td className={`${td} whitespace-nowrap text-slate-500`}>{r.taxInvNo}</td>
                                                        <td className={td}><span className="text-slate-600 italic line-clamp-2">{r.details || '-'}</span></td>
                                                        <td className={td}>
                                                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${r.source === 'INV' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{r.source}</span>
                                                        </td>
                                                        <td className={`${tdR} font-bold text-emerald-800`}>{fmt2(r.amountPaid)}</td>
                                                        <td className={`${tdR} font-bold text-slate-700`}>{fmtOrDash(r.stdRated)}</td>
                                                        <td className={`${tdR} font-black text-blue-800`}>{fmt2(r.actualVat)}</td>
                                                        <td className={`${tdR} font-bold text-slate-600`}>{fmtOrDash(r.theoretical)}</td>
                                                        <td className={`${tdR} !border-r-0`}>{fmtFlag(r.variation)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            {visibleRows.length > 0 && (
                                                <tfoot>
                                                    <tr className={accentFoot}>
                                                        <td className={`${td} font-black !border-0`} colSpan={7}>TOTALS ({visibleRows.length} vouchers)</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.paid)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.std)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.actual)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.theo)}</td>
                                                        <td className={`${tdR} font-black !border-0`}>{fmt2(totals.var)}</td>
                                                    </tr>
                                                </tfoot>
                                            )}
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* ── Output VAT journal reference panel (input scope) ── */}
                        {!loading && !isSales && (
                            <div className="mt-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="px-3 py-2 bg-gradient-to-r from-slate-700 to-slate-600 text-white flex items-center justify-between">
                                    <div className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                        <Landmark size={12} /> Output VAT — Journal Entries (due to FTA, reference)
                                    </div>
                                    <div className="text-[10px] font-black text-amber-300">Total Output VAT: {fmt2(outputTotal)} {currencySymbol || 'AED'} · {build.outputRows.length} entries</div>
                                </div>
                                {build.outputRows.length === 0 ? (
                                    <div className="p-6 text-center text-[11px] font-bold text-slate-400">No output-VAT journal postings (CR to this VAT ledger) in the selected period.</div>
                                ) : (
                                    <div className="overflow-auto max-h-[26vh]">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="bg-slate-100 text-slate-600">
                                                    <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Date</th>
                                                    <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Vch/Ref</th>
                                                    <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Counter Party</th>
                                                    <th className="px-2 py-1.5 text-left text-[8.5px] font-black uppercase">Details</th>
                                                    <th className="px-2 py-1.5 text-right text-[8.5px] font-black uppercase">Base</th>
                                                    <th className="px-2 py-1.5 text-right text-[8.5px] font-black uppercase">Output VAT {rateLabel}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {build.outputRows.map((r, i) => (
                                                    <tr key={i} className="border-t border-slate-100">
                                                        <td className="px-2 py-1 text-[10px] font-bold text-slate-500 whitespace-nowrap">{fmtDate(r.date)}</td>
                                                        <td className="px-2 py-1 text-[10px] font-bold text-blue-700 whitespace-nowrap">{r.ref}</td>
                                                        <td className="px-2 py-1 text-[10px] font-bold text-slate-700">{r.party}</td>
                                                        <td className="px-2 py-1 text-[10px] italic text-slate-500">{r.details || '-'}</td>
                                                        <td className="px-2 py-1 text-[10px] text-right font-bold text-slate-600">{fmt2(r.base)}</td>
                                                        <td className="px-2 py-1 text-[10px] text-right font-black text-rose-600">{fmt2(r.vat)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Footer note ── */}
                    <div className={`px-3 py-1.5 ${isSales ? 'bg-sky-950 text-sky-100' : 'bg-emerald-900 text-emerald-100'} text-[8.5px] font-semibold flex items-center gap-2 flex-shrink-0`}>
                        <CheckCircle2 size={11} className="shrink-0" />
                        {isSales
                            ? <>Theoretical VAT Check = {rateLabel} of each tax invoice's Net Value (Tax Invoice No · Customer · TRN). Variation flagged when |actual − theoretical| &gt; {TOL} {currencySymbol || 'AED'} — one row per tax invoice, matching the <b>SALE</b> tab columns without item-level detail.</>
                            : <><b>Std-Rated Supplies</b> = net line-item material subtotal at the supplier's <b>original rate</b> (capitalized pickup/loading expenses excluded) — the vendor's tax-invoice base. Theoretical VAT = {rateLabel} × that base. Variation flagged when |actual − theoretical| &gt; {TOL} {currencySymbol || 'AED'} · Rows marked <span className="font-black text-amber-300">Manual JV</span> originate from hand-posted journal vouchers; when the voucher's taxable base cannot be derived they show <b>—</b> and are excluded from Theoretical/Variation instead of being falsely flagged — verify those against source invoices before finalizing the V201 return.</>}
                    </div>
                </div>
            </div>
        </>
    );
}
