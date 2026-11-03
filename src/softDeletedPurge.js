import { collection, getDocs, query, where } from 'firebase/firestore';

/**
 * Single source of truth for the "Purge Soft Deleted" workflow.
 *
 * Both the purge action (App.handlePurgeSoftDeletedVouchers) and the System Log
 * counter read the exact same collection list + soft-delete predicate from here,
 * so the number shown to the user can never drift from what a purge will actually
 * remove.
 */

export const SOFT_DELETED_PURGE_COLLECTIONS = [
    { name: 'invoices', label: 'Invoices', fields: ['userId', 'ownerId'], kind: 'voucher' },
    { name: 'payments', label: 'Payments', fields: ['userId', 'ownerId'], kind: 'voucher' },
    { name: 'journal_vouchers', label: 'Journal Vouchers', fields: ['userId', 'ownerId'], kind: 'voucher' },
    { name: 'stock_journals', label: 'Stock Journals', fields: ['userId', 'ownerId'], kind: 'voucher' },
    { name: 'order_vouchers', label: 'Order Vouchers', fields: ['userId', 'ownerId'], kind: 'voucher' },
    // Linked physical bag rows — counted separately from vouchers.
    { name: 'jumbo_bags', label: 'Bag Records', fields: ['userId', 'ownerId', 'companyId'], kind: 'bag' },
];

const DELETED_STATUSES = new Set(['deleted', 'bulk_deleted', 'soft_deleted']);

/** True when a Firestore document is marked as soft-deleted by any known flag. */
export const isSoftDeletedRecord = (docData = {}) => {
    if (!docData || typeof docData !== 'object') return false;
    const status = String(docData.status || '').trim().toLowerCase();
    return (
        docData.isDeleted === true ||
        docData.deleted === true ||
        docData.is_deleted === true ||
        DELETED_STATUSES.has(status)
    );
};

/**
 * Collect every soft-deleted document in the purge scope for one owner/company.
 *
 * Returns:
 *   buckets        [{ name, label, kind, rows }]  – grouped rows (full doc data)
 *   countsByName   { [collection]: n }            – quick lookup for tooltips
 *   total          n                              – everything that would be purged
 *   voucherTotal   n                              – vouchers/invoices only
 *   bagRecordTotal n                              – linked bag rows only
 *   errors         [string]                       – collections that failed to read
 *   scannedAt      number                         – epoch ms of the scan
 */
export const fetchSoftDeletedRecords = async (db, ownerUid, options = {}) => {
    const { collections: collectionList = SOFT_DELETED_PURGE_COLLECTIONS } = options;
    const errors = [];
    const countsByName = {};
    const buckets = [];

    if (!db || !ownerUid) {
        return { buckets, countsByName, total: 0, voucherTotal: 0, bagRecordTotal: 0, errors, scannedAt: Date.now() };
    }

    for (const { name, label, fields = [], kind = 'voucher' } of collectionList) {
        const seen = new Map();

        for (const field of fields) {
            try {
                const snap = await getDocs(query(collection(db, name), where(field, '==', ownerUid)));
                snap.docs.forEach((d) => {
                    if (!seen.has(d.id)) seen.set(d.id, { id: d.id, ...d.data() });
                });
            } catch (err) {
                const msg = `${label || name} (${field}): ${err?.message || err}`;
                if (!errors.includes(msg)) errors.push(msg);
            }
        }

        const rows = [...seen.values()].filter((row) => isSoftDeletedRecord(row));
        countsByName[name] = rows.length;
        buckets.push({ name, label: label || name, kind, rows });
    }

    const voucherTotal = buckets
        .filter((b) => b.kind !== 'bag')
        .reduce((sum, b) => sum + b.rows.length, 0);
    const bagRecordTotal = buckets
        .filter((b) => b.kind === 'bag')
        .reduce((sum, b) => sum + b.rows.length, 0);

    return {
        buckets,
        countsByName,
        total: voucherTotal + bagRecordTotal,
        voucherTotal,
        bagRecordTotal,
        errors,
        scannedAt: Date.now(),
    };
};
