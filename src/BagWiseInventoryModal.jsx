import React, { useState, useEffect, useMemo } from 'react';
import { getFirestore, collection, query, where, getDocs, doc, getDoc, deleteDoc, writeBatch, documentId, updateDoc } from 'firebase/firestore'; // Added updateDoc
import { httpsCallable } from 'firebase/functions';
import { functions as firebaseFunctions } from './firebase';


import { Modal } from './components/Modal';
import { Download, ArrowLeft, X, RefreshCw, History, TrendingUp, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { createPortal } from 'react-dom';

const BagWiseInventoryModal = ({ isOpen, onClose, onBack, zIndex, user, dataOwnerId, products, globalDateCmd, onDateCmdProcessed, onOpenVoucher, units }) => {
    const baseUnitSymbol = units?.find(u => u.isBase)?.symbol || 'kg';

    const [bags, setBags] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBagNo, setSelectedBagNo] = useState(null);
    const [bagHistory, setBagHistory] = useState([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [filterProductId, setFilterProductId] = useState('');
    const [showItemWise, setShowItemWise] = useState(false);
    const [showDayWise, setShowDayWise] = useState(false);
    const [selectedProdDate, setSelectedProdDate] = useState(null);
    const [itemSearch, setItemSearch] = useState('');
    const [viewMode, setViewMode] = useState('all'); // 'all', 'in_stock' or 'sold'
    const [saleDetails, setSaleDetails] = useState({});
    const [dateRange, setDateRange] = useState({
        from: new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0]
    });
    const [showDatePopup, setShowDatePopup] = useState(false);
    const [recalcLoading, setRecalcLoading] = useState(false);
    const db = getFirestore();
    const getProductName = (id) => products.find(p => p.id === id)?.name || 'Unknown Item';

    const toggleBagReuse = async (bagId, currentStatus) => {
        try {
            const ref = doc(db, 'jumbo_bags', bagId);
            await updateDoc(ref, { allowReuse: !currentStatus });

            // Optimistic update of local state
            setBags(prev => prev.map(b => b.id === bagId ? { ...b, allowReuse: !currentStatus } : b));
        } catch (e) {
            console.error("Failed to toggle reuse", e);
            alert("Error updating bag status");
        }
    };

    useEffect(() => {
        if (!isOpen || !globalDateCmd) return;
        if (globalDateCmd.type === 'PERIOD' && globalDateCmd.startDate && globalDateCmd.endDate) {
            setDateRange({ from: globalDateCmd.startDate, to: globalDateCmd.endDate });
            if (onDateCmdProcessed) onDateCmdProcessed();
        } else if (globalDateCmd.type === 'SINGLE_DATE' && globalDateCmd.date) {
            setDateRange(prev => ({ ...prev, to: globalDateCmd.date }));
            if (onDateCmdProcessed) onDateCmdProcessed();
        }
    }, [globalDateCmd, isOpen]);

    useEffect(() => {
        if (isOpen) {
            fetchBags();
        }
    }, [isOpen]);

    const fetchBags = async () => {
        setLoading(true);
        try {
            const targetUid = dataOwnerId || user?.uid;
            if (!targetUid) {
                console.warn("Skipping fetchBags: No targetUid available", { user, dataOwnerId });
                setLoading(false);
                return;
            }

            console.log("Fetching bags for:", targetUid);

            // Fetch ALL jumbo_bags
            let list = [];
            try {
                const q = query(
                    collection(db, 'jumbo_bags'),
                    where('userId', '==', targetUid)
                );
                const snap = await getDocs(q);
                list = snap.docs.map(d => ({
                    id: d.id,
                    ...d.data(),
                    qty: Number(d.data().qty || 0)
                }));
            } catch (err) {
                console.error("Error fetching jumbo_bags:", err);
                throw new Error("Failed to load bags list: " + err.message);
            }

            // Enrich percent for production bags if missing
            try {
                const prodIds = [...new Set(list.map(b => b.stockJournalId).filter(Boolean))];
                if (prodIds.length > 0) {
                    const chunkSize = 10;
                    const journalMap = {};
                    for (let i = 0; i < prodIds.length; i += chunkSize) {
                        const chunk = prodIds.slice(i, i + chunkSize);
                        // Query by 'refNo' instead of documentId() as stockJournalId is likely the readable Ref No
                        const qJ = query(collection(db, 'stock_journals'), where('userId', '==', targetUid), where('refNo', 'in', chunk));
                        const jSnap = await getDocs(qJ);
                        jSnap.forEach(j => {
                            const jd = j.data();
                            const totalConsumed = (jd.consumed || []).reduce((s, p) => s + Number(p.quantity || 0), 0);
                            // Store by RefNo (which is usually unique per user context in this app design) 
                            // If RefNo is stored in 'refNo' field.
                            const ref = jd.refNo;
                            if (ref) journalMap[ref] = totalConsumed;
                        });
                    }

                    list = list.map(b => {
                        if (!b.stockJournalId) return b;
                        const storedPct = Number(b.percent);
                        if (!isNaN(storedPct) && storedPct > 0) return b;

                        const totalConsumed = journalMap[b.stockJournalId] || 0;
                        const pct = totalConsumed > 0 ? (Number(b.qty || 0) / totalConsumed) * 100 : 0;
                        return { ...b, percent: pct };
                    });
                }
            } catch (err) {
                console.error("Error fetching related stock_journals (non-critical):", err);
                // Non-critical: continue showing bags without precise percent if this fails
            }

            // Mark orphan bags so only orphan records are removable from this screen.
            try {
                const chunkSize = 10;
                const sjIds = [...new Set(list.map(b => b.stockJournalId).filter(Boolean))];
                const purIds = [...new Set(list.map(b => b.purchaseId).filter(Boolean))];

                const existingSj = new Set();
                const existingPur = new Set();

                for (let i = 0; i < sjIds.length; i += chunkSize) {
                    const chunk = sjIds.slice(i, i + chunkSize);
                    const [snapId, snapRef] = await Promise.all([
                        getDocs(query(collection(db, 'stock_journals'), where(documentId(), 'in', chunk))),
                        getDocs(query(collection(db, 'stock_journals'), where('refNo', 'in', chunk)))
                    ]);
                    snapId.forEach(d => existingSj.add(d.id));
                    snapRef.forEach(d => existingSj.add(d.data().refNo));
                }

                for (let i = 0; i < purIds.length; i += chunkSize) {
                    const chunk = purIds.slice(i, i + chunkSize);
                    const [snapId, snapRef] = await Promise.all([
                        getDocs(query(collection(db, 'invoices'), where(documentId(), 'in', chunk))),
                        getDocs(query(collection(db, 'invoices'), where('refNo', 'in', chunk)))
                    ]);
                    snapId.forEach(d => existingPur.add(d.id));
                    snapRef.forEach(d => existingPur.add(d.data().refNo));
                }

                list = list.map(b => {
                    const hasMfgLink = !!b.stockJournalId;
                    const hasPurLink = !!b.purchaseId;
                    if (!hasMfgLink && !hasPurLink) {
                        return { ...b, isOrphan: true, orphanReason: 'No source voucher link' };
                    }
                    if (hasMfgLink && !existingSj.has(b.stockJournalId)) {
                        return { ...b, isOrphan: true, orphanReason: 'Source production voucher deleted' };
                    }
                    if (hasPurLink && !existingPur.has(b.purchaseId)) {
                        return { ...b, isOrphan: true, orphanReason: 'Source purchase voucher deleted' };
                    }
                    return { ...b, isOrphan: false, orphanReason: '' };
                });
            } catch (err) {
                console.warn('Orphan check failed (non-critical):', err);
                list = list.map(b => ({ ...b, isOrphan: false, orphanReason: '' }));
            }

            setBags(list);
        } catch (e) {
            console.error("Fatal error in fetchBags:", e);
            alert("Error loading bags: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteBag = async (bag) => {
        if (!bag?.isOrphan) {
            alert('This bag is linked to a voucher. Delete the voucher first; bag records will auto-sync and be removed/reverted automatically.');
            return;
        }
        if (!window.confirm('Delete this orphan bag record?')) return;
        try {
            await deleteDoc(doc(db, 'jumbo_bags', bag.id));
            setBags(prev => prev.filter(b => b.id !== bag.id));
        } catch (e) {
            console.error(e);
            alert("Delete failed: " + e.message);
        }
    };

    const handleRecalculateBagInventory = async () => {
        if (recalcLoading) return;
        if (!window.confirm('Recalculate bag inventory now? This will find and delete bag records that belong to vouchers you have already deleted.')) return;

        setRecalcLoading(true);
        try {
            const targetUid = dataOwnerId || user.uid;
            
            // 1. Get ALL bags for this user
            const qBags = query(collection(db, 'jumbo_bags'), where('userId', '==', targetUid));
            const bagSnap = await getDocs(qBags);
            const allBags = bagSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

            if (allBags.length === 0) {
                alert("No bags found to scan.");
                setRecalcLoading(false);
                return;
            }

            // 2. Extract unique Source IDs (Stock Journals or Purchases)
            const sjIds = [...new Set(allBags.map(b => b.stockJournalId).filter(Boolean))];
            const purIds = [...new Set(allBags.map(b => b.purchaseId).filter(Boolean))];

            // 3. Batch Check SJ Existence (By ID or RefNo)
            const deadSjIds = new Set();
            const sjChunkSize = 10;
            for (let i = 0; i < sjIds.length; i += sjChunkSize) {
                const chunk = sjIds.slice(i, i + sjChunkSize);
                const qExist = query(collection(db, 'stock_journals'), where(documentId(), 'in', chunk));
                const qExistRef = query(collection(db, 'stock_journals'), where('refNo', 'in', chunk));
                
                const [snap, snapRef] = await Promise.all([getDocs(qExist), getDocs(qExistRef)]);
                const existIds = new Set([
                    ...snap.docs.map(d => d.id),
                    ...snapRef.docs.map(d => d.data().refNo)
                ]);
                chunk.forEach(id => { if (!existIds.has(id)) deadSjIds.add(id); });
            }

            // 4. Batch Check Purchase Existence (By ID or RefNo)
            const deadPurIds = new Set();
            for (let i = 0; i < purIds.length; i += sjChunkSize) {
                const chunk = purIds.slice(i, i + sjChunkSize);
                const qExist = query(collection(db, 'invoices'), where(documentId(), 'in', chunk));
                const qExistRef = query(collection(db, 'invoices'), where('refNo', 'in', chunk));

                const [snap, snapRef] = await Promise.all([getDocs(qExist), getDocs(qExistRef)]);
                const existIds = new Set([
                    ...snap.docs.map(d => d.id),
                    ...snapRef.docs.map(d => d.data().refNo)
                ]);
                chunk.forEach(id => { if (!existIds.has(id)) deadPurIds.add(id); });
            }

            // 5. Delete Orphans (dead source voucher or no source voucher at all)
            const orphans = allBags.filter(b =>
                (!b.stockJournalId && !b.purchaseId) ||
                (b.stockJournalId && deadSjIds.has(b.stockJournalId)) ||
                (b.purchaseId && deadPurIds.has(b.purchaseId))
            );
            
            if (orphans.length > 0) {
                let batch = writeBatch(db);
                let count = 0;
                for (const b of orphans) {
                    batch.delete(b.ref);
                    count++;
                    if (count % 400 === 0) {
                        await batch.commit();
                        batch = writeBatch(db);
                    }
                }
                await batch.commit();
                alert(`✅ Cleanup Complete!\n\nScanned ${allBags.length} bags.\nFound and deleted ${orphans.length} orphaned records from deleted vouchers.`);
            } else {
                alert("✅ Sync Complete! No orphaned bags found. Your inventory is already consistent.");
            }

            await fetchBags();
        } catch (e) {
            console.error('Bag recalc failed:', e);
            alert('Failed to recalculate: ' + (e?.message || 'Unknown error'));
        } finally {
            setRecalcLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchBags();
    }, [isOpen, user?.uid, dataOwnerId]);

    const handleBagClick = (bagNo) => {
        setSelectedBagNo(bagNo);
        fetchBagDetails(bagNo);
    };

    const fetchBagDetails = async (bagNo) => {
        setDetailLoading(true);
        try {
            const targetUid = dataOwnerId || user.uid;
            // Get all instances of this bag number from jumbo_bags
            const q = query(
                collection(db, 'jumbo_bags'),
                where('userId', '==', targetUid),
                where('bagNo', '==', bagNo)
            );
            const snap = await getDocs(q);
            const history = snap.docs.map(d => ({ ...d.data(), id: d.id }));

            // 2. Fetch source vouchers (MFG or Purchase)
            const mfgIds = [...new Set(history.map(h => h.stockJournalId).filter(Boolean))];
            const purchaseIds = [...new Set(history.map(h => h.purchaseId).filter(Boolean))];
            const salesIds = [...new Set(history.map(h => h.salesId).filter(Boolean))];

            const journalDetails = {};
            const purchaseDetails = {};
            const saleDetailsMap = {};

            // Fetch Stock Journals
            if (mfgIds.length > 0) {
                await Promise.all(mfgIds.map(async (id) => {
                    try {
                        const qCombined = query(
                            collection(db, 'stock_journals'),
                            where('userId', '==', targetUid),
                            where('refNo', '==', id)
                        );
                        const sId = await getDocs(qCombined);
                        if (!sId.empty) {
                            journalDetails[id] = sId.docs[0].data();
                        } else {
                            // Try by real Doc ID but with userId filter for safety and efficiency
                            const qDoc = query(collection(db, 'stock_journals'), where('userId', '==', targetUid), where(documentId(), '==', id));
                            const sDoc = await getDocs(qDoc);
                            if (!sDoc.empty) journalDetails[id] = sDoc.docs[0].data();
                        }
                    } catch (err) { console.warn(`Failed to fetch journal ${id}`, err); }
                }));
            }

            // Fetch Purchases
            if (purchaseIds.length > 0) {
                await Promise.all(purchaseIds.map(async (id) => {
                    try {
                        const qCombined = query(
                            collection(db, 'invoices'),
                            where('userId', '==', targetUid),
                            where('refNo', '==', id)
                        );
                        const sId = await getDocs(qCombined);
                        if (!sId.empty) {
                            purchaseDetails[id] = sId.docs[0].data();
                        } else {
                            const qDoc = query(collection(db, 'invoices'), where('userId', '==', targetUid), where(documentId(), '==', id));
                            const sDoc = await getDocs(qDoc);
                            if (!sDoc.empty) purchaseDetails[id] = sDoc.docs[0].data();
                        }
                    } catch (err) { console.warn(`Failed to fetch purchase ${id}`, err); }
                }));
            }

            // Fetch Sales
            if (salesIds.length > 0) {
                await Promise.all(salesIds.map(async (id) => {
                    try {
                        const qCombined = query(
                            collection(db, 'invoices'),
                            where('userId', '==', targetUid),
                            where(documentId(), '==', id)
                        );
                        const sId = await getDocs(qCombined);
                        if (!sId.empty) {
                            saleDetailsMap[id] = sId.docs[0].data();
                        }
                    } catch (err) { console.warn(`Failed to fetch sale ${id}`, err); }
                }));
            }



            // 3. Enrich History
            const enrichedHistory = history.map(bagRec => {
                const journal = journalDetails[bagRec.stockJournalId];
                const purchase = purchaseDetails[bagRec.purchaseId];
                const sale = saleDetailsMap[bagRec.salesId];

                if (journal) {
                    const totalProduced = (journal.produced || []).reduce((s, p) => s + Number(p.quantity || 0), 0);
                    const totalConsumed = (journal.consumed || []).reduce((s, p) => s + Number(p.quantity || 0), 0);
                    const ratio = totalProduced > 0 ? (Number(bagRec.qty) / totalProduced) : 0;
                    const storedPct = Number(bagRec.percent);
                    const pct = !isNaN(storedPct) && storedPct > 0 ? storedPct : (totalConsumed > 0 ? (Number(bagRec.qty) / totalConsumed) * 100 : 0);

                    return {
                        ...bagRec,
                        voucherId: journal.refNo || 'N/A',
                        type: 'Manufacturing',
                        productionStaffNames: journal.productionStaffNames || [],
                        productionStartTime: journal.productionStartTime || '',
                        productionEndTime: journal.productionEndTime || '',
                        productionDurationMinutes: Number(journal.productionDurationMinutes || 0),
                        productionDurationLabel: journal.productionDurationLabel || '',
                        percent: pct,
                        totalConsumedQty: totalConsumed,
                        consumed: (journal.consumed || []).map(i => ({
                            name: getProductName(i.productId),
                            qty: Number(i.quantity || 0) * ratio,
                            rate: Number(i.rate || 0),
                            value: (Number(i.quantity || 0) * Number(i.rate || 0)) * ratio,
                            percent: totalConsumed > 0 ? (Number(i.quantity || 0) / totalConsumed) * 100 : 0
                        })),
                        expenses: (journal.journalExpenses || []).map(e => ({
                            name: e.name || 'Expense',
                            value: Number(e.amount || 0) * ratio
                        })),
                        totalBagValue: Number(journal.producedTotal || 0) * ratio,
                        materialValue: (journal.consumedTotal || 0) * ratio,
                        expenseValue: (journal.journalExpensesTotal || 0) * ratio
                    };
                } else if (purchase) {
                    const totalQty = (purchase.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0);
                    const ratio = totalQty > 0 ? (Number(bagRec.qty) / totalQty) : 0;
                    const item = (purchase.items || []).find(it => it.productId === bagRec.productId) || purchase.items[0];

                    const materialValue = (Number(bagRec.qty) * Number(item.rate || 0));
                    const expenseValue = ((purchase.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0) * ratio);

                    return {
                        ...bagRec,
                        voucherId: purchase.refNo || 'N/A',
                        type: 'Purchase',
                        consumed: [{
                            name: `Purchased: ${getProductName(item.productId)}`,
                            qty: Number(bagRec.qty),
                            rate: Number(item.rate || 0),
                            value: materialValue
                        }],
                        expenses: (purchase.expenses || []).map(e => ({
                            name: 'Direct Expense',
                            value: Number(e.amount || 0) * ratio
                        })),
                        totalBagValue: materialValue + expenseValue,
                        materialValue: materialValue,
                        expenseValue: expenseValue
                    };
                } else if (sale) {
                    return {
                        ...bagRec,
                        voucherId: sale.refNo || 'N/A',
                        type: 'Sale',
                        consumed: [{
                            name: `Sold to: ${sale.partyName || 'Unknown'}`,
                            qty: Number(bagRec.qty),
                            variance: bagRec.weightVariance || 0,
                            finalWeight: Number(bagRec.qty) + (Number(bagRec.weightVariance) || 0)
                        }],
                        expenses: [],
                        totalBagValue: 0,
                        materialValue: 0,
                        expenseValue: 0,
                        isSale: true
                    };
                }

                return { ...bagRec, consumed: [], expenses: [], totalBagValue: 0, materialValue: 0, expenseValue: 0, type: 'Unknown' };
            });

            enrichedHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
            setBagHistory(enrichedHistory);

        } catch (e) {
            console.error("Detail load failed", e);
            alert("Failed to load bag details: " + e.message);
        } finally {
            setDetailLoading(false);
        }
    };

    const getFilteredBags = () => {
        return bags.filter(b => {
            const name = getProductName(b.productId).toLowerCase();
            const bNo = (b.bagNo || '').toLowerCase();
            const s = searchTerm.toLowerCase();
            const matchesSearch = name.includes(s) || bNo.includes(s);
            const matchesProduct = !filterProductId || b.productId === filterProductId;

            // Period Filter Logic
            const bDate = b.date || '';
            const sDate = b.soldDate || '';
            let matchesDate = false;

            if (viewMode === 'in_stock') {
                matchesDate = bDate >= dateRange.from && bDate <= dateRange.to;
            } else if (viewMode === 'sold') {
                matchesDate = sDate >= dateRange.from && sDate <= dateRange.to;
            } else {
                // For 'all', show if either created or sold in period
                matchesDate = (bDate >= dateRange.from && bDate <= dateRange.to) ||
                    (b.status === 'sold' && sDate >= dateRange.from && sDate <= dateRange.to);
            }

            const matchesMode = viewMode === 'all' ? true : b.status === viewMode;
            return matchesSearch && matchesProduct && matchesMode && matchesDate;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
    };

    const downloadExcel = () => {

        const data = getFilteredBags().map(b => ({
            'Date': b.date,
            'Bag Number': b.bagNo,
            'Item': getProductName(b.productId),
            'Percent (%)': (b.percent && b.stockJournalId) ? Number(b.percent).toFixed(2) : '',
            [`Weight (${baseUnitSymbol})`]: b.qty,
            'Source': b.stockJournalId ? 'Production' : 'Purchase',
            'Status': b.status === 'sold' ? 'SOLD' : 'IN STOCK'
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Bag Inventory");
        XLSX.writeFile(wb, "BagWiseInventory.xlsx");
    };

    const downloadBagDetailPDF = async () => {
        if (!selectedBagNo || bagHistory.length === 0) return;
        try {
            const { jsPDF } = await import("jspdf");
            const { default: autoTable } = await import("jspdf-autotable");
            const doc = new jsPDF();

            doc.setFontSize(16);
            doc.text(`Bag Details Analysis: #${selectedBagNo}`, 14, 15);

            doc.setFontSize(10);
            const totalWeight = bagHistory.reduce((s, h) => s + h.qty, 0).toFixed(3);
            const totalValue = bagHistory.reduce((s, h) => s + h.totalBagValue, 0).toFixed(2);
            doc.text(`Total Weight Filled: ${totalWeight} ${baseUnitSymbol}`, 14, 25);
            doc.text(`Total Estimated Value: AED ${totalValue}`, 14, 30);
            doc.text(`Generation Date: ${new Date().toLocaleString()}`, 14, 35);

            const body = [];
            bagHistory.forEach((h, idx) => {
                body.push([
                    { content: `FILL #${idx + 1}`, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
                    { content: h.date, styles: { fillColor: [240, 240, 240] } },
                    { content: h.voucherId || 'N/A', styles: { fillColor: [240, 240, 240] } },
                    { content: (h.percent && h.percent > 0) ? `${Number(h.percent).toFixed(2)}%` : '-', styles: { fillColor: [240, 240, 240] } },
                    { content: `${h.qty.toFixed(3)} ${baseUnitSymbol}`, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }
                ]);

                if (h.consumed && h.consumed.length > 0) {
                    h.consumed.forEach(c => {
                        body.push([`  - ${c.name}`, `${c.qty.toFixed(3)} ${baseUnitSymbol}`, `AED ${c.rate.toFixed(2)}`, '', `AED ${c.value.toFixed(2)}`]);
                    });
                }
                if (h.expenses && h.expenses.length > 0) {
                    h.expenses.forEach(e => {
                        body.push([`  - (Exp) ${e.name}`, '', '', '', `AED ${e.value.toFixed(2)}`]);
                    });
                }
                body.push([
                    { content: 'TOTAL FILL VALUE', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
                    { content: `AED ${h.totalBagValue.toFixed(2)}`, styles: { fontStyle: 'bold' } }
                ]);
            });

            autoTable(doc, {
                head: [['Label/Item', 'Qty/Date', 'Rate/Ref', 'Percent', 'Value/Total']],
                body: body,
                startY: 40,
                theme: 'grid',
                styles: { fontSize: 8 },
                columnStyles: { 0: { cellWidth: 80 }, 4: { halign: 'right' } }
            });

            doc.save(`Bag_Detail_${selectedBagNo}.pdf`);
        } catch (e) {
            console.error("PDF Fail", e);
            alert("Failed to generate PDF");
        }
    };

    const [voucherSelectOptions, setVoucherSelectOptions] = useState(null);

    const handleOpenVoucher = (entry = null) => {
        if (!onOpenVoucher) return;

        // If specific entry passed (e.g. from list), open directly
        if (entry?.stockJournalId) {
            onOpenVoucher(entry.stockJournalId, 'manufacturing');
            return;
        }

        const mfgHistory = bagHistory.filter(h => h.stockJournalId);
        if (mfgHistory.length === 0) return;

        // If only one history item, open directly
        if (mfgHistory.length === 1) {
            onOpenVoucher(mfgHistory[0].stockJournalId, 'manufacturing');
            setSelectedBagNo(null); // Close the detail overlay so the voucher is visible
            return;
        }

        // Multiple vouchers: Show UI Selection
        setVoucherSelectOptions(mfgHistory);
    };

    // PERIODIC SUMMARY LOGIC (Calculated from all bags based on selection)
    const stats = useMemo(() => {
        const { from, to } = dateRange;
        const periodBags = bags.filter(b => b.date >= from && b.date <= to);
        const periodSold = bags.filter(b => b.status === 'sold' && b.soldDate >= from && b.soldDate <= to);

        const mfg = periodBags.filter(b => b.stockJournalId);
        const pur = periodBags.filter(b => !b.stockJournalId);

        return {
            mfgCount: mfg.length,
            mfgWeight: mfg.reduce((s, b) => s + b.qty, 0),
            purCount: pur.length,
            purWeight: pur.reduce((s, b) => s + b.qty, 0),
            soldCount: periodSold.length,
            soldWeight: periodSold.reduce((s, b) => s + b.qty, 0),
            availCount: bags.filter(b => b.status === 'in_stock').length,
            availWeight: bags.filter(b => b.status === 'in_stock').reduce((s, b) => s + b.qty, 0)
        };
    }, [bags, dateRange]);

    if (!isOpen) return null;

    const filteredBags = getFilteredBags();

    return (
        <Modal isOpen={isOpen} onClose={onClose} onBack={onBack} zIndex={zIndex} title="Bag Wise Stock Inventory" maxWidth="max-w-[95vw]" removePadding={true} noContentScroll={true} defaultMaximized={true}>
            <div className="flex flex-col h-full bg-slate-50">
                <div className="p-3 bg-white border-b space-y-3">
                    {/* PERIOD SUMMARY DASHBOARD */}
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex flex-wrap gap-2">
                            {/* Manufactured Summary */}
                            <div className="bg-blue-50/50 p-2 rounded-xl border border-blue-100 min-w-[120px]">
                                <p className="text-[8px] font-black text-blue-400 uppercase tracking-tighter">Manufactured</p>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-sm font-black text-blue-700">{stats.mfgCount}</span>
                                    <span className="text-[10px] text-blue-400">bags</span>
                                </div>
                                <p className="text-[10px] font-bold text-blue-600">{stats.mfgWeight.toFixed(2)} {baseUnitSymbol}</p>
                            </div>
                            {/* Purchased Summary */}
                            <div className="bg-emerald-50/50 p-2 rounded-xl border border-emerald-100 min-w-[120px]">
                                <p className="text-[8px] font-black text-emerald-400 uppercase tracking-tighter">Purchased</p>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-sm font-black text-emerald-700">{stats.purCount}</span>
                                    <span className="text-[10px] text-emerald-400">bags</span>
                                </div>
                                <p className="text-[10px] font-bold text-emerald-600">{stats.purWeight.toFixed(2)} {baseUnitSymbol}</p>
                            </div>
                            {/* Sold Summary */}
                            <div className="bg-orange-50/50 p-2 rounded-xl border border-orange-100 min-w-[120px]">
                                <p className="text-[8px] font-black text-orange-400 uppercase tracking-tighter">Sold in Period</p>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-sm font-black text-orange-700">{stats.soldCount}</span>
                                    <span className="text-[10px] text-orange-400">bags</span>
                                </div>
                                <p className="text-[10px] font-bold text-orange-600">{stats.soldWeight.toFixed(2)} {baseUnitSymbol}</p>
                            </div>
                            {/* Closing Balance (Always current) */}
                            <div className="bg-slate-800 p-2 rounded-xl shadow-lg min-w-[120px]">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Current Balance</p>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-sm font-black text-white">{stats.availCount}</span>
                                    <span className="text-[10px] text-slate-400">bags</span>
                                </div>
                                <p className="text-[10px] font-bold text-blue-400">{stats.availWeight.toFixed(2)} {baseUnitSymbol}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => setShowDatePopup(true)} className="p-2 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2 text-xs font-black text-slate-700">
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px]">{dateRange.from}</span>
                                <span className="text-slate-300">to</span>
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px]">{dateRange.to}</span>
                            </button>
                            <button onClick={fetchBags} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Refresh"><RefreshCw size={16} /></button>
                            <button
                                onClick={handleRecalculateBagInventory}
                                disabled={recalcLoading}
                                className="p-2 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center gap-1 text-xs font-bold px-3 transition-all disabled:opacity-60 shadow-md"
                                title="Recalculate Bag Inventory"
                            >
                                <RefreshCw size={14} className={recalcLoading ? 'animate-spin' : ''} />
                                {recalcLoading ? 'Recalculating...' : 'Recalculate Bags'}
                            </button>
                            <div className="h-6 w-[1px] bg-slate-200 mx-1"></div>
                            <button
                                onClick={() => setShowDayWise(true)}
                                className="p-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 flex items-center gap-1 text-xs font-bold px-3 transition-all"
                            >
                                <History size={14} /> Day Wise
                            </button>
                            <button
                                onClick={() => setShowItemWise(true)}
                                className="p-2 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1 text-xs font-bold px-3 transition-all"
                            >
                                <TrendingUp size={14} /> Item Wise
                            </button>
                            <button
                                onClick={downloadExcel}
                                className="p-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1 text-xs font-bold px-3 shadow-md"
                            >
                                <Download size={14} /> Excel
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 py-1">
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                            {['all', 'in_stock', 'sold'].map(m => (
                                <button
                                    key={m}
                                    onClick={() => setViewMode(m)}
                                    className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${viewMode === m ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    {m === 'in_stock' ? 'Available' : m === 'all' ? 'Activity Log' : 'Sales History'}
                                </button>
                            ))}
                        </div>
                        <select
                            className="p-2 border rounded-lg text-sm font-bold text-slate-600 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 w-1/3"
                            value={filterProductId}
                            onChange={(e) => setFilterProductId(e.target.value)}
                        >
                            <option value="">All Products</option>
                            {products.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            placeholder="Search Bag # or Item..."
                            className="flex-1 p-2 border rounded-lg text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-auto">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-slate-800 text-white text-xs uppercase sticky top-0 z-10">
                            <tr>
                                {/* RESTORED MISSING CHECKBOX COLUMN HEADER */}
                                <th className="p-3 w-10 text-center">
                                    <input type="checkbox" className="rounded" disabled />
                                </th>
                                <th className="p-3">Date</th>
                                <th className="p-3">Bag #</th>
                                <th className="p-3">Item Name</th>
                                <th className="p-3 text-right">Percent (%)</th>
                                <th className="p-3 text-right">Weight ({baseUnitSymbol})</th>
                                <th className="p-3 text-center">Source</th>
                                <th className="p-3 text-center">Status</th>
                                <th className="p-3 text-center">Actions</th>
                                <th className="p-3 text-center">Remove Orphan Bags</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 italic">
                            {loading ? <tr><td colSpan="9" className="p-10 text-center"><RefreshCw className="animate-spin inline mr-2" /> Loading bags...</td></tr> :
                                filteredBags.map((b, i) => (
                                    <tr key={i} className="hover:bg-blue-50 group transition-colors">
                                        {/* RESTORED MISSING CHECKBOX COLUMN BODY */}
                                        <td className="p-3 text-center">
                                            <input
                                                type="checkbox"
                                                className="rounded w-4 h-4 cursor-pointer accent-blue-600"
                                                checked={!!b.allowReuse}
                                                onChange={(e) => { e.stopPropagation(); toggleBagReuse(b.id, b.allowReuse); }}
                                                onClick={(e) => e.stopPropagation()}
                                                title="Check to allow reusing this bag number"
                                            />
                                        </td>
                                        <td className="p-3 text-slate-500">{b.date}</td>
                                        <td className="p-3">
                                            <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-black border">#{b.bagNo}</span>
                                        </td>
                                        <td
                                            onClick={() => handleBagClick(b.bagNo)}
                                            className="p-3 font-bold text-slate-700 cursor-pointer hover:underline"
                                        >
                                            {getProductName(b.productId)}
                                        </td>
                                        <td className="p-3 text-right font-mono font-bold text-slate-600">
                                            {b.stockJournalId ? (Number(b.percent || 0).toFixed(2)) : '-'}
                                        </td>
                                        <td className="p-3 text-right font-mono font-bold text-slate-600">{b.qty.toFixed(2)}</td>
                                        <td className="p-3 text-center">
                                            {b.stockJournalId ?
                                                <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold uppercase border border-blue-100 italic">Production</span> :
                                                <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-bold uppercase border border-green-100 italic">Purchase</span>
                                            }
                                        </td>
                                        <td className="p-3 text-center">
                                            {b.status === 'sold' ?
                                                <span className="text-[10px] bg-orange-100 text-orange-700 px-3 py-1 rounded-full font-black uppercase shadow-sm">SOLD</span> :
                                                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-black uppercase shadow-sm border border-emerald-200">IN STOCK</span>
                                            }
                                        </td>
                                        <td className="p-3 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleBagClick(b.bagNo)}
                                                    className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 justify-center p-1 hover:bg-blue-50 rounded"
                                                    title="Bag Analysis"
                                                >
                                                    Analysis <History size={14} />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="p-3 text-center">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteBag(b); }}
                                                disabled={!b.isOrphan}
                                                className={`p-1 rounded transition-all ${b.isOrphan ? 'text-red-500 hover:text-red-700 hover:bg-red-50' : 'text-slate-300 cursor-not-allowed'}`}
                                                title={b.isOrphan ? `Delete orphan bag${b.orphanReason ? ` (${b.orphanReason})` : ''}` : 'Linked bag: delete voucher first'}
                                            >
                                                <X size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            {!loading && filteredBags.length === 0 && <tr><td colSpan="10" className="p-10 text-center text-slate-400">No {viewMode === 'in_stock' ? 'in stock' : 'sold'} bags found.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {/* --- DATE PICKER MODAL --- */}
                {showDatePopup && (
                    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm m-4 animate-in zoom-in-95 leading-normal">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Select Period</h3>
                                <button onClick={() => setShowDatePopup(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={20} /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">From Date</label>
                                    <input type="date" className="w-full p-3 border-2 border-slate-100 rounded-xl font-bold focus:border-blue-500 outline-none transition-all" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">To Date</label>
                                    <input type="date" className="w-full p-3 border-2 border-slate-100 rounded-xl font-bold focus:border-blue-500 outline-none transition-all" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} />
                                </div>
                                <div className="pt-4">
                                    <button onClick={() => setShowDatePopup(false)} className="w-full bg-slate-800 text-white font-black py-4 rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-900 transition-all active:scale-95 uppercase tracking-widest">
                                        Update Report
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- VOUCHER SELECTION MODAL --- */}
                {/* --- VOUCHER SELECTION MODAL --- */}
                {voucherSelectOptions && createPortal(
                    <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setVoucherSelectOptions(null)}>
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md m-4 animate-in zoom-in-95 overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                            <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
                                <h3 className="font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                    <History size={18} className="text-blue-500" /> Select Voucher Used
                                </h3>
                                <button onClick={() => setVoucherSelectOptions(null)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X size={20} /></button>
                            </div>
                            <div className="p-2 overflow-y-auto space-y-2">
                                {voucherSelectOptions.map((v, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            onOpenVoucher(v.stockJournalId, 'manufacturing');
                                            setVoucherSelectOptions(null);
                                            setSelectedBagNo(null); // Close the detail overlay so the voucher is visible
                                        }}
                                        className="w-full text-left p-3 rounded-lg border border-slate-100 hover:bg-blue-50 hover:border-blue-200 transition-all group flex items-center justify-between"
                                    >
                                        <div>
                                            <div className="font-black text-slate-700 text-sm">#{v.voucherId || 'N/A'}</div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{v.date}</div>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs font-bold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                            Open Voucher <ArrowLeft size={14} className="rotate-180" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <div className="p-3 bg-slate-50 border-t text-center shrink-0">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select a voucher to view details</span>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* --- ITEM WISE SUMMARY OVERLAY --- */}
                {showItemWise && createPortal(
                    <div className="fixed inset-0 z-[10000] bg-white flex flex-col animate-in slide-in-from-bottom duration-300 w-screen h-screen leading-normal">
                        <div className="bg-slate-900 text-white p-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <button onClick={() => setShowItemWise(false)} className="hover:bg-white/20 p-1 rounded"><ArrowLeft size={20} /></button>
                                <h3 className="font-bold">Present Stock Inventory (Item Wise)</h3>
                            </div>
                            <button onClick={() => setShowItemWise(false)} className="hover:bg-white/20 p-1 rounded"><X size={20} /></button>
                        </div>

                        <div className="p-4 bg-slate-50 border-b space-y-3">
                            <div className="bg-slate-200/50 p-2 rounded-lg border border-slate-300 text-center flex items-center justify-center gap-6 text-sm">
                                <span className="font-bold text-slate-600 uppercase text-[10px]">Total Stock:</span>
                                <span className="text-blue-700 font-black text-lg">{bags.reduce((s, b) => s + b.qty, 0).toFixed(2)} {baseUnitSymbol}</span>
                                <span className="text-slate-300">|</span>
                                <span className="text-blue-700 font-black text-lg">{bags.length} Bags</span>
                            </div>

                            <input
                                type="text"
                                placeholder="Filter items..."
                                className="w-full p-2 border rounded-lg text-sm"
                                value={itemSearch}
                                onChange={e => setItemSearch(e.target.value)}
                            />
                        </div>

                        <div className="flex-1 overflow-auto">
                            <table className="w-full text-left text-sm border-collapse">
                                <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-3">Item Name</th>
                                        <th className="p-3 text-right">Total Weight ({baseUnitSymbol})</th>
                                        <th className="p-3 text-center">Bags Count</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {Object.entries(bags.filter(b => b.status === 'in_stock').reduce((acc, b) => {
                                        const name = getProductName(b.productId);
                                        if (!acc[name]) acc[name] = { weight: 0, count: 0, id: b.productId };
                                        acc[name].weight += b.qty;
                                        acc[name].count += 1;
                                        return acc;
                                    }, {}))
                                        .filter(([name]) => !itemSearch || name.toLowerCase().includes(itemSearch.toLowerCase()))
                                        .sort((a, b) => b[1].weight - a[1].weight)
                                        .map(([name, stats]) => (
                                            <tr key={name} className="hover:bg-blue-50 group transition-colors">
                                                <td className="p-3 font-bold text-slate-800">{name}</td>
                                                <td className="p-3 text-right font-mono font-bold text-slate-600">{stats.weight.toFixed(2)}</td>
                                                <td className="p-3 text-center font-bold text-blue-600">{stats.count}</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-4 bg-slate-50 border-t flex justify-center">
                            <button onClick={() => setShowItemWise(false)} className="flex items-center gap-2 text-slate-500 font-bold hover:text-slate-800 text-xs uppercase tracking-widest">
                                <ArrowLeft size={16} /> Back to Register
                            </button>
                        </div>
                    </div>,
                    document.body
                )}

                {/* --- DAY WISE PRODUCTION REPORT OVERLAY --- */}
                {showDayWise && createPortal(
                    <div className="fixed inset-0 z-[10000] bg-white flex flex-col animate-in slide-in-from-bottom duration-300 w-screen h-screen leading-normal">
                        <div className="bg-slate-950 text-white p-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <button onClick={() => { if (selectedProdDate) setSelectedProdDate(null); else setShowDayWise(false); }} className="hover:bg-white/20 p-1 rounded"><ArrowLeft size={20} /></button>
                                <h3 className="font-bold">{selectedProdDate ? `Production Breakdown: ${selectedProdDate}` : "Production Report (Last 15 Days)"}</h3>
                            </div>
                            <button onClick={() => { setShowDayWise(false); setSelectedProdDate(null); }} className="hover:bg-white/20 p-1 rounded"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-auto">
                            {!selectedProdDate ? (
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10 shadow-sm border-b">
                                        <tr>
                                            <th className="p-4">Date</th>
                                            <th className="p-4 text-right">Total Weight (kg)</th>
                                            <th className="p-4 text-center">Bags Count</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {(() => {
                                            const days = [];
                                            const today = new Date();
                                            for (let i = 0; i < 15; i++) {
                                                const d = new Date(today);
                                                d.setDate(today.getDate() - i);
                                                days.push(d.toISOString().split('T')[0]);
                                            }

                                            const prodBags = bags.filter(b => b.stockJournalId);
                                            const dateMap = prodBags.reduce((acc, b) => {
                                                if (!acc[b.date]) acc[b.date] = { weight: 0, count: 0 };
                                                acc[b.date].weight += b.qty;
                                                acc[b.date].count += 1;
                                                return acc;
                                            }, {});

                                            return days.map(date => {
                                                const stats = dateMap[date] || { weight: 0, count: 0 };
                                                return (
                                                    <tr key={date}
                                                        onClick={() => stats.count > 0 && setSelectedProdDate(date)}
                                                        className={`hover:bg-blue-50 group cursor-pointer transition-colors ${stats.count === 0 ? 'opacity-50 grayscale select-none cursor-default' : ''}`}
                                                    >
                                                        <td className="p-4 font-bold text-slate-700">{date}</td>
                                                        <td className="p-4 text-right font-mono font-bold text-slate-600">{stats.weight.toFixed(2)}</td>
                                                        <td className="p-4 text-center font-bold text-blue-600">{stats.count}</td>
                                                    </tr>
                                                );
                                            });
                                        })()}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-4 animate-in fade-in zoom-in-95">
                                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6 flex justify-between items-center">
                                        <div>
                                            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Selected Production Date</p>
                                            <h4 className="text-2xl font-black text-blue-800">{selectedProdDate}</h4>
                                        </div>
                                        <button onClick={() => setSelectedProdDate(null)} className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1">
                                            <ArrowLeft size={14} /> Back to Daily Summary
                                        </button>
                                    </div>

                                    <table className="w-full text-left text-sm border-collapse bg-white rounded-xl shadow-sm border overflow-hidden">
                                        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black tracking-widest border-b">
                                            <tr>
                                                <th className="p-4">Item Produced</th>
                                                <th className="p-4 text-right">Weight ({baseUnitSymbol})</th>
                                                <th className="p-4 text-center">Bags</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {Object.entries(bags.filter(b => b.date === selectedProdDate && b.stockJournalId).reduce((acc, b) => {
                                                const name = getProductName(b.productId);
                                                if (!acc[name]) acc[name] = { weight: 0, count: 0 };
                                                acc[name].weight += b.qty;
                                                acc[name].count += 1;
                                                return acc;
                                            }, {}))
                                                .sort((a, b) => b[1].weight - a[1].weight)
                                                .map(([name, stats]) => (
                                                    <tr key={name} className="hover:bg-slate-50 transition-colors">
                                                        <td className="p-4 font-bold text-slate-800">{name}</td>
                                                        <td className="p-4 text-right font-mono font-bold text-slate-600">{stats.weight.toFixed(2)}</td>
                                                        <td className="p-4 text-center font-bold text-blue-600">{stats.count}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-slate-50 border-t flex justify-center">
                            <button onClick={() => { if (selectedProdDate) setSelectedProdDate(null); else setShowDayWise(false); }} className="flex items-center gap-2 text-slate-500 font-bold hover:text-slate-800 text-xs uppercase tracking-widest">
                                <ArrowLeft size={16} /> {selectedProdDate ? "Back to Dates" : "Back to Main Register"}
                            </button>
                        </div>
                    </div>,
                    document.body
                )
                }

                {/* --- DETAILED BAG VIEW OVERLAY --- */}
                {
                    selectedBagNo && createPortal(
                        <div className="fixed inset-0 z-[10000] bg-white flex flex-col animate-in slide-in-from-right duration-300 w-screen h-screen leading-normal">
                            <div className="bg-slate-900 text-white p-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSelectedBagNo(null)} className="hover:bg-white/20 p-1 rounded"><ArrowLeft size={20} /></button>
                                    <h3 className="font-bold flex items-center gap-2">Analysis for Bag #{selectedBagNo}</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleRecalculateBagInventory}
                                        disabled={recalcLoading}
                                        className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-bold shadow-lg shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-50"
                                    >
                                        <RefreshCw size={14} className={recalcLoading ? 'animate-spin' : ''} />
                                        {recalcLoading ? 'Syncing...' : 'Recalculate Bag'}
                                    </button>
                                    <button
                                        onClick={downloadBagDetailPDF}
                                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-bold shadow-lg shadow-red-500/20 active:scale-95 transition-all"
                                    >
                                        <FileText size={16} /> Export View as PDF
                                    </button>
                                    <button onClick={() => setSelectedBagNo(null)} className="hover:bg-white/20 p-1 rounded"><X size={20} /></button>
                                </div>
                            </div>

                            {detailLoading ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                                    <RefreshCw className="animate-spin mb-2" size={32} />
                                    <p>Loading History & Analysis...</p>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-auto p-4 space-y-6">
                                    {/* 1. OVERALL SUMMARY */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 shadow-sm">
                                            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Total Weight Filled</p>
                                            <p className="text-2xl font-black text-blue-700">{bagHistory.reduce((s, h) => s + h.qty, 0).toFixed(3)} <span className="text-sm">{baseUnitSymbol}</span></p>
                                        </div>
                                        <div className="bg-green-50 p-4 rounded-xl border border-green-100 shadow-sm">
                                            <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-1">Total Estimated Value</p>
                                            <p className="text-2xl font-black text-green-700">AED {bagHistory.reduce((s, h) => s + (Number(h.totalBagValue) || 0), 0).toFixed(2)}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleOpenVoucher()}
                                            className="bg-purple-50 p-4 rounded-xl border border-purple-100 shadow-sm text-left hover:shadow-md transition-all"
                                        >
                                            <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Times Filled</p>
                                            <p className="text-2xl font-black text-purple-700">{bagHistory.length} <span className="text-sm">Vouchers</span></p>
                                        </button>
                                    </div>

                                    {/* 2. HISTORY LIST */}
                                    <div className="space-y-4">
                                        <h4 className="flex items-center gap-2 font-black text-slate-800 uppercase text-xs tracking-widest border-b pb-2">
                                            <History size={16} className="text-blue-500" /> Production & Fill History
                                        </h4>

                                        <div className="space-y-6">
                                            {bagHistory.map((h, idx) => (
                                                <div key={idx} className="border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white">
                                                    <div className="bg-slate-50 p-4 border-b flex justify-between items-center">
                                                        <div className="flex items-center gap-4">
                                                            <span className="bg-slate-800 text-white text-[10px] font-black px-2 py-1 rounded">FILL #{idx + 1}</span>
                                                            <span className="font-bold text-slate-700">{h.date}</span>
                                                            <span className="font-bold text-slate-700">{h.date}</span>
                                                            <span className="text-slate-400 text-sm hidden md:inline">
                                                                Voucher:
                                                                <button
                                                                    onClick={() => {
                                                                        if (h.stockJournalId) onOpenVoucher(h.stockJournalId, 'manufacturing');
                                                                        else if (h.isSale) onOpenVoucher(h.salesId, 'sales');
                                                                        else if (h.purchaseId) onOpenVoucher(h.purchaseId, 'purchase');
                                                                    }}
                                                                    className="ml-1 font-mono text-blue-600 font-bold hover:underline hover:text-blue-800"
                                                                >
                                                                    #{h.voucherId || 'N/A'}
                                                                </button>
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <div className="text-xs font-bold text-slate-500">{(h.percent && h.percent > 0) ? `${Number(h.percent).toFixed(2)}%` : '-'}</div>
                                                            <div className="text-lg font-black text-blue-800">{h.qty.toFixed(3)} {baseUnitSymbol}</div>
                                                        </div>
                                                    </div>
                                                    {(h.type === 'Manufacturing') && (h.productionStaffNames?.length || h.productionStartTime || h.productionEndTime) && (
                                                        <div className="bg-white px-4 py-2 border-b text-[11px] text-slate-600 flex flex-wrap gap-4 items-center">
                                                            {h.productionStaffNames?.length > 0 && (
                                                                <div>
                                                                    <span className="text-slate-400 font-bold uppercase text-[9px]">Staff</span>{' '}
                                                                    <span className="font-semibold text-slate-700">{h.productionStaffNames.join(', ')}</span>
                                                                </div>
                                                            )}
                                                            {(h.productionStartTime || h.productionEndTime) && (
                                                                <div>
                                                                    <span className="text-slate-400 font-bold uppercase text-[9px]">Time</span>{' '}
                                                                    <span className="font-semibold text-slate-700">{h.productionStartTime || '--'} - {h.productionEndTime || '--'}</span>
                                                                </div>
                                                            )}
                                                            {(h.productionDurationLabel || h.productionDurationMinutes) && (
                                                                <div>
                                                                    <span className="text-slate-400 font-bold uppercase text-[9px]">Duration</span>{' '}
                                                                    <span className="font-semibold text-slate-700">{h.productionDurationLabel || `${Number(h.productionDurationMinutes || 0)}m`}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 border-b pb-1 flex justify-between">
                                                                <span>Materials Consumed (Share)</span>
                                                                <span className="text-slate-300">Voucher Total: {(Number(h.totalConsumedQty) || 0).toFixed(3)} {baseUnitSymbol}</span>
                                                            </div>
                                                            <table className="w-full">
                                                                <thead className="text-[10px] text-slate-400 text-left">
                                                                    <tr><th>Item</th><th className="text-right">% of Voucher</th><th className="text-right">Qty ({baseUnitSymbol})</th><th className="text-right">Value</th></tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-50">
                                                                    {(h.consumed || []).map((c, ci) => (
                                                                        <tr key={ci}>
                                                                            <td className="py-2 font-bold text-slate-700">{c.name}</td>
                                                                            <td className="py-2 text-right font-mono text-slate-500">{(c.percent || 0).toFixed(2)}%</td>
                                                                            <td className="py-2 text-right font-mono">{(c.qty || 0).toFixed(3)}</td>
                                                                            <td className="py-2 text-right font-mono text-slate-400">{(c.value || 0).toFixed(2)}</td>
                                                                        </tr>
                                                                    ))}
                                                                    {h.consumed.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-300">No materials recorded</td></tr>}
                                                                </tbody>
                                                                <tfoot>
                                                                    <tr className="border-t">
                                                                        <td className="pt-2 font-bold text-slate-400 text-[10px] uppercase">{h.isSale ? 'Net Sale Qty' : 'Input Cost Subtotal'}</td>
                                                                        <td colSpan={2} className="pt-2 text-right font-black text-slate-700">
                                                                            {h.isSale ? (
                                                                                <div className="flex flex-col items-end">
                                                                                    <span>{((h.consumed[0]?.finalWeight) || h.qty).toFixed(3)} {baseUnitSymbol}</span>
                                                                                    {Math.abs(h.weightVariance || 0) > 0.001 && (
                                                                                        <span className={`text-[10px] ${h.weightVariance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                                            (Original: {h.qty.toFixed(3)} | Adj: {h.weightVariance > 0 ? '+' : ''}{h.weightVariance.toFixed(3)}) {baseUnitSymbol}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            ) : `AED ${(h.materialValue || 0).toFixed(2)}`}
                                                                        </td>
                                                                    </tr>
                                                                    {h.varianceNote && (
                                                                        <tr>
                                                                            <td colSpan={3} className="pt-1 text-[9px] text-blue-600 font-bold italic">
                                                                                * {h.varianceNote}
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </tfoot>
                                                            </table>
                                                        </div>

                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 border-b pb-1">Expenses Allocated</div>
                                                            {(h.expenses || []).length > 0 ? (
                                                                <table className="w-full">
                                                                    <thead className="text-[10px] text-slate-400 text-left">
                                                                        <tr><th>Expense Head</th><th className="text-right">Value (AED)</th></tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-50">
                                                                        {h.expenses.map((e, ei) => (
                                                                            <tr key={ei}>
                                                                                <td className="py-2 font-bold text-slate-600">{e.name}</td>
                                                                                <td className="py-2 text-right font-mono">{(e.value || 0).toFixed(2)}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                    <tfoot>
                                                                        <tr className="border-t">
                                                                            <td className="pt-2 font-bold text-slate-400 text-[10px] uppercase">Expense Subtotal</td>
                                                                            <td className="pt-2 text-right font-black text-slate-700">AED {(h.expenseValue || 0).toFixed(2)}</td>
                                                                        </tr>
                                                                    </tfoot>
                                                                </table>
                                                            ) : (
                                                                <div className="h-32 flex flex-col items-center justify-center text-slate-300 italic text-xs gap-2">
                                                                    <RefreshCw size={24} className="opacity-20" />
                                                                    No expenses allocated.
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="bg-slate-50/50 p-4 border-t flex justify-between items-center">
                                                        <div>
                                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Estimated Fill Value</span>
                                                            <span className="text-[9px] text-slate-400">(Materials + Expenses)</span>
                                                        </div>
                                                        <span className="text-xl font-black text-green-700">AED {(h.totalBagValue || 0).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="bg-slate-800 text-white rounded-2xl p-6 shadow-xl leading-normal mt-8">
                                            <h4 className="text-slate-400 text-[11px] uppercase font-black tracking-widest mb-4 flex items-center gap-2">
                                                <TrendingUp size={16} className="text-blue-400" /> Combined Raw Material Fingerprint
                                            </h4>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                                {Object.entries(bagHistory.reduce((acc, fill) => {
                                                    (fill.consumed || []).forEach(c => {
                                                        if (!acc[c.name]) acc[c.name] = { q: 0, v: 0 };
                                                        acc[c.name].q += (Number(c.qty) || 0);
                                                        acc[c.name].v += (Number(c.value) || 0);
                                                    });
                                                    return acc;
                                                }, {})).map(([name, stats]) => (
                                                    <div key={name} className="border-l-2 border-slate-600 pl-4 py-1">
                                                        <p className="text-[10px] font-bold text-slate-400 mb-1 leading-tight">{name}</p>
                                                        <div className="flex items-baseline gap-2">
                                                            <span className="text-lg font-black">{(stats.q || 0).toFixed(3)}</span>
                                                            <span className="text-[10px] text-slate-500 font-bold">{baseUnitSymbol}</span>
                                                        </div>
                                                        <p className="text-[10px] text-blue-400 font-black">AED {(stats.v || 0).toFixed(2)}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="p-4 bg-slate-50 border-t flex justify-center">
                                <button onClick={() => setSelectedBagNo(null)} className="flex items-center gap-2 text-slate-500 font-bold hover:text-slate-800 text-xs uppercase tracking-widest px-10 py-3 border rounded-xl bg-white shadow-sm hover:shadow transition-all">
                                    <ArrowLeft size={16} /> Back to Register
                                </button>
                            </div>

                            <div className="bg-slate-100 p-2 text-center text-[8px] text-slate-400 uppercase tracking-tighter">
                                Analytical values are derived proportionally from source manufacturing and purchase records
                            </div>
                        </div>,
                        document.body
                    )}
            </div>
        </Modal>
    );
};

export default BagWiseInventoryModal;
