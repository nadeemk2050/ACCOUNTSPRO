/**
 * stockValuation — closing-stock engine for the Stock Summary figures.
 *
 * The main dashboard's "Stock Summary Grand Total" and the Stock Summary report
 * must agree. Rather than maintain two divergent implementations, this module is
 * a faithful, PURE extraction of the report's maths (App.jsx, "generateReport"):
 *
 *   • the master opening stock forms the first FIFO layer;
 *   • every invoice / stock-journal line becomes a SIGNED movement
 *     (qty × rate decides the direction, so a negative line reverses the flow);
 *   • FIFO layers are consumed on the way out (with a signed fallback layer);
 *   • "Last Purchase / Production" and "Last Sold" rates are tracked by date;
 *   • only the CLOSING quantity/value are affected by the valuation method.
 *
 * Usage from the dashboard: pass every voucher up to the as-of date and an empty
 * locationId (this dashboard has no location filter).
 *
 * ⚠️ Keep this file BYTE-IDENTICAL between the ACCPRO apps.
 */

const STORAGE_KEY = 'stock_valuation_method_v1';

export const VALUATION_OPTIONS = [
    { value: 'fifo', label: 'FIFO' },
    { value: 'last_purchase', label: 'Last Purchase/Prod Rate' },
    { value: 'last_sold', label: 'Last Sold Price' }
];

export const valuationLabel = (method) => {
    const found = VALUATION_OPTIONS.find(o => o.value === method);
    return found ? found.label : VALUATION_OPTIONS[0].label;
};

/** Short label for the small dashboard tab. */
export const valuationShortLabel = (method) => {
    if (method === 'last_purchase') return 'LAST PUR';
    if (method === 'last_sold') return 'LAST SALE';
    return 'FIFO';
};

/** Shared default so the dashboard tab and the report always agree. */
export const getStoredValuation = () => {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return VALUATION_OPTIONS.some(o => o.value === v) ? v : 'fifo';
    } catch {
        return 'fifo';
    }
};

export const setStoredValuation = (method) => {
    try {
        if (VALUATION_OPTIONS.some(o => o.value === method)) localStorage.setItem(STORAGE_KEY, method);
    } catch { /* private mode / quota — the in-memory value still applies */ }
};

// Voucher types that can move stock, split by direction exactly as the report does.
const INWARD_TYPES = ['purchase', 'sales_return', 'credit_note'];
const OUTWARD_TYPES = ['sales', 'purchase_return', 'debit_note'];

/**
 * Union of the two lists above. Exported so a caller can cheaply pre-filter a
 * snapshot before copying documents (the dashboard does exactly that).
 */
export const STOCK_MOVEMENT_TYPES = [...INWARD_TYPES, ...OUTWARD_TYPES];

const getFifoValue = (layers) => layers.reduce((s, l) => s + (Number(l.qty || 0) * Number(l.rate || 0)), 0);

// Mirrors the report's getRate() exactly.
const rateFor = (method, purRate, salRate, avgRate, fifoVal, qty) => {
    if (method === 'fifo') return qty !== 0 ? Math.abs(fifoVal / qty) : 0;
    if (method === 'last_sold') return salRate || purRate || avgRate || 0;
    return purRate || avgRate || 0;
};

/**
 * Compute the per-product closing position for a SINGLE as-of date.
 *
 * @param {object}   args
 * @param {Array}    args.products       product masters (openingStock / openingBalance / openingRate / purchasePrice / group)
 * @param {Array}    args.invoices       RAW invoice docs (already filtered for soft-deletes)
 * @param {Array}    args.stockJournals  RAW stock-journal docs (already filtered for soft-deletes)
 * @param {string}   args.asOfDate       'YYYY-MM-DD' — movements after this date are ignored
 * @param {string}   args.valuation      'fifo' | 'last_purchase' | 'last_sold'
 * @param {string}  [args.locationId]    optional location filter ('' = all locations)
 * @returns {Array<{id,group,openingQty,openingVal,inQty,inVal,outQty,outVal,closingQty,closingRate,closingVal}>}
 */
export const computeStockClosing = ({
    products = [],
    invoices = [],
    stockJournals = [],
    asOfDate = '',
    fromDate = '',            // optional: when set, also report the FIFO opening for this period
    valuation = 'fifo',
    locationId = ''
}) => {
    const itemMap = {};

    products.forEach(p => {
        const openingQty = Number(p.openingStock || 0);
        const openingBal = Number(p.openingBalance || 0);
        const openingRate = Number(p.openingRate || 0) > 0
            ? Number(p.openingRate)
            : (openingQty !== 0 && openingBal !== 0 ? Math.abs(openingBal / openingQty) : Number(p.purchasePrice || 0));
        itemMap[p.id] = {
            id: p.id,
            group: p.group || 'Primary',
            openingQty,
            openingVal: openingBal,
            lastPurchaseRate: Number(p.purchasePrice || 0),
            lastPurchaseDate: '1970-01-01',
            lastSaleRate: 0,
            lastSaleDate: '1970-01-01',
            fifoLayers: openingQty > 0 ? [{ qty: openingQty, rate: openingRate }] : [],
            fifoShortQty: openingQty < 0 ? Math.abs(openingQty) : 0,
            inQty: 0, inVal: 0,
            outQty: 0, outVal: 0
        };
    });

    const movements = [];
    let seq = 0;

    // ── Invoices: signed flow, exactly as the report classifies them ──────────
    invoices.forEach(d => {
        if (locationId && d.locationId !== locationId) return;

        const isInward = INWARD_TYPES.includes(d.type);
        const isOutward = OUTWARD_TYPES.includes(d.type);
        if (!isInward && !isOutward) return;

        (d.items || []).forEach(item => {
            const qtyRaw = Number(item.quantity || 0);
            const rateRaw = Number(item.rate || 0);
            if (!item.productId || qtyRaw === 0) return;

            // A negative line amount reverses the voucher direction; if the amount
            // is zero the signed quantity decides (same rule as the report).
            const baseSign = isInward ? 1 : -1;
            let signedFlow = qtyRaw * rateRaw * baseSign;
            if (signedFlow === 0) signedFlow = qtyRaw * baseSign;

            movements.push({
                seq: seq++,
                date: d.date,
                productId: item.productId,
                qty: Math.abs(qtyRaw),
                rate: Math.abs(rateRaw),
                type: signedFlow >= 0 ? 'in' : 'out'
            });
        });
    });

    // ── Stock journals: produced = in, consumed = out ─────────────────────────
    stockJournals.forEach(d => {
        if (locationId && d.locationId !== locationId) return;

        (d.produced || []).forEach(item => {
            const qtyRaw = Number(item.quantity || 0);
            if (!item.productId || qtyRaw === 0) return;
            const rateRaw = Number(item.rate || 0);
            let signedFlow = qtyRaw * rateRaw;
            if (signedFlow === 0) signedFlow = qtyRaw;
            movements.push({
                seq: seq++,
                date: d.date,
                productId: item.productId,
                qty: Math.abs(qtyRaw),
                rate: Math.abs(rateRaw),
                type: signedFlow >= 0 ? 'in' : 'out'
            });
        });

        (d.consumed || []).forEach(item => {
            const qtyRaw = Number(item.quantity || 0);
            if (!item.productId || qtyRaw === 0) return;
            const rateRaw = Number(item.rate || 0);
            let signedFlow = -(qtyRaw * rateRaw);
            if (signedFlow === 0) signedFlow = -qtyRaw;
            movements.push({
                seq: seq++,
                date: d.date,
                productId: item.productId,
                qty: Math.abs(qtyRaw),
                rate: Math.abs(rateRaw),
                type: signedFlow >= 0 ? 'in' : 'out'
            });
        });
    });

    // ── Apply movements chronologically (date, then original order) ───────────
    movements
        .filter(m => m.date && (!asOfDate || m.date <= asOfDate))
        .sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date)))
        .forEach(({ date, productId, qty, rate, type }) => {
            const row = itemMap[productId];
            if (!row) return;

            if (type === 'in') {
                row.inQty += qty;
                row.inVal += qty * rate;
                let remIn = qty;
                if (row.fifoShortQty > 0) {
                    const cover = Math.min(row.fifoShortQty, remIn);
                    row.fifoShortQty -= cover;
                    remIn -= cover;
                }
                if (remIn > 1e-9) {
                    row.fifoLayers.push({ qty: remIn, rate: rate || 0 });
                }
            } else {
                row.outQty += qty;
                row.outVal += qty * rate;

                let need = qty;
                while (need > 1e-9 && row.fifoLayers.length > 0) {
                    const head = row.fifoLayers[0];
                    if (head.qty <= need + 1e-9) {
                        need -= head.qty;
                        row.fifoLayers.shift();
                    } else {
                        head.qty -= need;
                        need = 0;
                    }
                }
                if (need > 1e-9) {
                    row.fifoShortQty += need;
                }
            }

            if (type === 'in' && rate > 0 && date >= row.lastPurchaseDate) {
                row.lastPurchaseDate = date;
                row.lastPurchaseRate = rate;
            }
            if (type === 'out' && rate > 0 && date >= row.lastSaleDate) {
                row.lastSaleDate = date;
                row.lastSaleRate = rate;
            }
        });

    // ── Finalise: quantity + valuation-method-dependent closing value ─────────
    // Optional period opening (FIFO). When `fromDate` is supplied, replay only the
    // movements BEFORE it on a fresh layer set, so "opening" means the same thing
    // here as it does in the Stock Summary report (always FIFO).
    let periodOpening = null;
    if (fromDate) {
        periodOpening = {};
        products.forEach(p => {
            const q0 = Number(p.openingStock || 0);
            const b0 = Number(p.openingBalance || 0);
            const r0 = Number(p.openingRate || 0) > 0
                ? Number(p.openingRate)
                : (q0 !== 0 && b0 !== 0 ? Math.abs(b0 / q0) : Number(p.purchasePrice || 0));
            periodOpening[p.id] = {
                qty: q0,
                layers: q0 > 0 ? [{ qty: q0, rate: r0 }] : [],
                short: q0 < 0 ? Math.abs(q0) : 0,
                lastRate: Number(p.purchasePrice || 0)
            };
        });

        const applyOpeningMovement = (row, m) => {
            if (m.type === 'in') {
                row.qty += m.qty;
                let rem = m.qty;
                if (row.short > 0) {
                    const cover = Math.min(row.short, rem);
                    row.short -= cover;
                    rem -= cover;
                }
                if (rem > 1e-9) row.layers.push({ qty: rem, rate: m.rate || 0 });
                if (m.rate > 0) row.lastRate = m.rate;
            } else {
                row.qty -= m.qty;
                let need = m.qty;
                while (need > 1e-9 && row.layers.length > 0) {
                    const head = row.layers[0];
                    if (head.qty <= need + 1e-9) { need -= head.qty; row.layers.shift(); }
                    else { head.qty -= need; need = 0; }
                }
                if (need > 1e-9) row.short += need;
            }
        };

        movements
            .filter(m => m.date && m.date < fromDate && (!asOfDate || m.date <= asOfDate))
            .sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date)))
            .forEach(m => {
                const row = periodOpening[m.productId];
                if (row) applyOpeningMovement(row, m);
            });

        Object.values(periodOpening).forEach(row => {
            if (row.qty > 1e-9) {
                row.fifoVal = getFifoValue(row.layers);
            } else if (row.qty < -1e-9) {
                row.fifoVal = row.qty * (row.lastRate || 0);
            } else {
                row.qty = 0;
                row.fifoVal = 0;
            }
        });
    }

    return Object.values(itemMap).map(i => {
        const closingQty = i.openingQty + i.inQty - i.outQty;
        const ledgerClosingVal = i.openingVal + i.inVal - i.outVal; // average cost
        const fifoClosingVal = getFifoValue(i.fifoLayers);

        const avgRate = closingQty !== 0 ? Math.abs(ledgerClosingVal / closingQty) : 0;
        const closingRate = rateFor(valuation, i.lastPurchaseRate, i.lastSaleRate, avgRate, fifoClosingVal, closingQty);
        const closingVal = valuation === 'fifo' ? fifoClosingVal : (closingQty * closingRate);

        const op = periodOpening ? periodOpening[i.id] : null;

        return {
            id: i.id,
            group: i.group,
            openingQty: i.openingQty,
            openingVal: i.openingVal,
            // FIFO period opening (only when `fromDate` was supplied)
            periodOpeningQty: op ? op.qty : undefined,
            periodOpeningVal: op ? op.fifoVal : undefined,
            inQty: i.inQty,
            inVal: i.inVal,
            outQty: i.outQty,
            outVal: i.outVal,
            closingQty,
            closingRate,
            closingVal
        };
    });
};
