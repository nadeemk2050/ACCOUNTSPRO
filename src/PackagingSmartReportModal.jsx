import React, { useState } from 'react';
import {
    X, Package, Search, Filter, Download, 
    Printer, Calendar, ChevronRight, ChevronLeft,
    TrendingUp, BarChart3, Layers, Box, Archive,
    FileSearch, Info, AlertCircle, Clock, List, Recycle, Plus, Trash2
} from 'lucide-react';
import { 
    getFirestore, collection, query, where, onSnapshot, orderBy,
    doc, updateDoc, getDoc, getDocs, limit, addDoc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { RefreshCw, Check } from 'lucide-react';
import { createPortal } from 'react-dom';
const PackagingSmartReportModal = ({ 
    isOpen, onClose, zIndex = 1500, currencySymbol = 'AED',
    user, subUser, dataOwnerId, products, units, launchView
}) => {
    const [activeTab, setActiveTab] = useState('jumbo_bags');
    const [isDeepAnalysing, setIsDeepAnalysing] = useState(false);
    const [viewingDetail, setViewingDetail] = useState(null); // 'jumbo_in', 'jumbo_out', 'manuf_reg', 'ready_stock', 'jumbo_allocated', 'reusable_bags'
    const [dateRange, setDateRange] = useState({ 
        from: '2025-01-01', 
        to: new Date().toISOString().split('T')[0]
    });

    // --- Reusable Bags state ---
    const [reusableBags, setReusableBags] = useState([]);
    const [showMakeReusableModal, setShowMakeReusableModal] = useState(false);
    const [selectedReusableBag, setSelectedReusableBag] = useState(null);
    const [newReusableBagNo, setNewReusableBagNo] = useState('');
    const [savingReusable, setSavingReusable] = useState(false);
    
    // Data States
    const [bags, setBags] = useState([]);
    const [stockJournals, setStockJournals] = useState([]);
    const [salesInvoices, setSalesInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedVchId, setExpandedVchId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewBagListVch, setViewBagListVch] = useState(null); // The voucher object to show bags for
    const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
    const [viewMode, setViewMode] = useState('detail'); // 'detail' or 'summary'
    const [readyStockSubTab, setReadyStockSubTab] = useState('remaining'); // 'in', 'out', 'remaining'
    const [selectedReadyStockProductId, setSelectedReadyStockProductId] = useState('');
    const [deleteBagPrompt, setDeleteBagPrompt] = useState(null);
    const [deletePassword, setDeletePassword] = useState('');
    const [detailModal, setDetailModal] = useState(null); // 'inward' | 'outward' | 'ready' | 'orphan' | null

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const db = getFirestore();
    const targetUid = dataOwnerId || user?.uid;

    const handleDeleteOrphanBag = async (bag) => {
        if (!bag || !bag.id) {
            alert('Cannot delete this bag because it lacks a valid database ID. It may be an embedded or virtual record.');
            return;
        }
        setDeleteBagPrompt(bag);
        setDeletePassword('');
    };

    const confirmDeleteOrphanBag = async () => {
        if (deletePassword === "abcd") {
            try {
                await deleteDoc(doc(db, 'jumbo_bags', deleteBagPrompt.id));
                setDeleteBagPrompt(null);
                setDeletePassword('');
            } catch (err) {
                console.error("Error deleting orphan bag:", err);
                alert("❌ Failed to delete orphan bag. See console for details.");
            }
        } else {
            alert("❌ Incorrect password.");
        }
    };

    React.useEffect(() => {
        if (!isOpen || !launchView?.detail) return;

        setIsDeepAnalysing(true);
        setViewingDetail(launchView.detail);
        if (launchView.subTab) setReadyStockSubTab(launchView.subTab);
        if (launchView.mode) setViewMode(launchView.mode);
    }, [isOpen, launchView]);

    // Fetch Data
    // Persistent cache for multi-source listeners to prevent flip-flopping
    const bagCache = React.useRef({});
    const journalCache = React.useRef({});
    const salesInvoiceCache = React.useRef({});

    // Date Normalizer: Handles Timestamps, JS Dates, and ISO Strings consistently
    const normalizeDate = (val) => {
        if (!val) return '';
        if (typeof val?.toDate === 'function') {
            const d = val.toDate();
            return d.toISOString().split('T')[0];
        }
        if (val instanceof Date) return val.toISOString().split('T')[0];
        const str = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.split('T')[0];
        const parsed = new Date(str);
        return !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : str;
    };

    React.useEffect(() => {
        if (!isOpen || !targetUid) return;

        setLoading(true);
        const uidCandidates = [...new Set([dataOwnerId, user?.uid].filter(Boolean))];

        // 1. Setup Stock Journals Listeners (Check both User and Owner) - Filter out deleted records
        const journalUnsubs = uidCandidates.flatMap(uid => {
            return ['userId', 'ownerId'].map(field => {
                const q = query(
                    collection(db, 'stock_journals'),
                    where(field, '==', uid),
                    where('date', '>=', dateRange.from),
                    where('date', '<=', dateRange.to)
                );
                return onSnapshot(q, (snap) => {
                    journalCache.current[`${uid}-${field}`] = snap.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .filter(sj => !sj.isDeleted && sj.status !== 'deleted' && sj.status !== 'bulk_deleted');
                    const merged = new Map();
                    Object.values(journalCache.current).forEach(list => list.forEach(sj => {
                        const normalizedDate = normalizeDate(sj.date);
                        merged.set(sj.id, { ...sj, date: normalizedDate });
                    }));
                    setStockJournals([...merged.values()]);
                    setLoading(false);
                }, (err) => console.warn(`Journals sync error (${field}):`, err));
            });
        });

        // 1.5 Setup Sales Invoice Listeners (for instant sold-bags reflection in OUT report)
        const salesInvoiceUnsubs = uidCandidates.flatMap(uid => {
            return ['userId', 'ownerId'].map(field => {
                const qSales = query(
                    collection(db, 'invoices'),
                    where(field, '==', uid),
                    where('type', '==', 'sales')
                );
                return onSnapshot(qSales, (snap) => {
                    salesInvoiceCache.current[`${uid}-${field}`] = snap.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .filter(inv => !inv.isDeleted && inv.status !== 'deleted' && inv.status !== 'bulk_deleted');
                    const merged = new Map();
                    Object.values(salesInvoiceCache.current).forEach(list => list.forEach(inv => merged.set(inv.id, inv)));
                    setSalesInvoices([...merged.values()]);
                }, (err) => {
                    console.warn(`Sales invoice sync error (${field}):`, err);
                    getDocs(qSales).then(snap => {
                        salesInvoiceCache.current[`${uid}-${field}`] = snap.docs
                            .map(d => ({ id: d.id, ...d.data() }))
                            .filter(inv => !inv.isDeleted && inv.status !== 'deleted' && inv.status !== 'bulk_deleted');
                        const merged = new Map();
                        Object.values(salesInvoiceCache.current).forEach(list => list.forEach(inv => merged.set(inv.id, inv)));
                        setSalesInvoices([...merged.values()]);
                    }).catch(e2 => console.warn(`Sales invoice fallback getDocs failed (${field}):`, e2));
                });
            });
        });

        // Helper: Merge bag cache into state
        const mergeBagCache = () => {
            const merged = new Map();
            Object.values(bagCache.current).forEach(list => list.forEach(b => merged.set(b.id, b)));
            const allBags = [...merged.values()];
            if (allBags.length > 0) {
                setBags(allBags);
                setLoading(false);
            }
        };

        // 2. Setup Jumbo Bags Listeners (Load all relevant bags) - Filter out deleted records
        const bagUnsubs = uidCandidates.flatMap(uid => {
            return ['userId', 'ownerId', 'companyId'].map(field => {
                const q = query(collection(db, 'jumbo_bags'), where(field, '==', uid));
                return onSnapshot(q, (snap) => {
                    bagCache.current[`${uid}-${field}`] = snap.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .filter(b => !b.isDeleted && b.status !== 'deleted' && b.status !== 'bulk_deleted');
                    mergeBagCache();
                }, (err) => {
                    console.warn(`Bags sync error (${field}):`, err);
                    // Fallback: one-time getDocs when onSnapshot fails (Firestore 404/400 channel bugs)
                    getDocs(q).then(snap => {
                        bagCache.current[`${uid}-${field}`] = snap.docs
                            .map(d => ({ id: d.id, ...d.data() }))
                            .filter(b => !b.isDeleted && b.status !== 'deleted' && b.status !== 'bulk_deleted');
                        mergeBagCache();
                    }).catch(e2 => console.warn(`Bags fallback getDocs also failed (${field}):`, e2));
                });
            });
        });

        // 3. Fallback: Load recent bags regardless of UID if count is low (Handles legacy/unsynced data) - Filter out deleted records
        let fallbackUnsub = () => {};
        let fallbackAttempted = false;
        const attemptFallbackLoad = () => {
            if (fallbackAttempted) return;
            fallbackAttempted = true;
            // One-time getDocs fallback to handle Firestore channel 404/400 errors
            getDocs(query(collection(db, 'jumbo_bags'), limit(5000))).then(snap => {
                const fallbackList = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(b => !b.isDeleted && b.status !== 'deleted' && b.status !== 'bulk_deleted');
                if (fallbackList.length > 0) {
                    bagCache.current['fallback'] = fallbackList;
                    mergeBagCache();
                }
            }).catch(err => console.warn("Fallback bag getDocs failed:", err));
        };

        // Also set up onSnapshot fallback for ongoing sync
        fallbackUnsub = onSnapshot(query(collection(db, 'jumbo_bags'), limit(5000)), (snap) => {
            bagCache.current['fallback'] = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(b => !b.isDeleted && b.status !== 'deleted' && b.status !== 'bulk_deleted');
            mergeBagCache();
        }, (err) => {
            console.warn("Fallback bag onSnapshot error:", err);
            attemptFallbackLoad();
        });

        // 4. Immediate one-time getDocs as a safety net (in case ALL onSnapshot listeners fail)
        //    This handles the Firestore 404/400 Listen channel bug proactively.
        attemptFallbackLoad();

        return () => {
            journalUnsubs.forEach(unsub => unsub());
            salesInvoiceUnsubs.forEach(unsub => unsub());
            bagUnsubs.forEach(unsub => unsub());
            fallbackUnsub();
        };
    }, [isOpen, targetUid, dateRange, dataOwnerId, user?.uid]);

    // Fetch reusable bags from Firestore
    React.useEffect(() => {
        if (!isOpen || !targetUid) return;
        const q = query(collection(db, 'reusable_jumbo_bags'), where('ownerId', '==', targetUid));
        const unsub = onSnapshot(q, (snap) => {
            setReusableBags(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, (err) => console.warn('Reusable bags sync error:', err));
        return () => unsub();
    }, [isOpen, targetUid]);
    // Dynamic Self-Healing to remove historically orphaned manufacturing fills AND add missing timeline entries
    React.useEffect(() => {
        if (!isOpen || !targetUid || reusableBags.length === 0 || stockJournals.length === 0) return;

        const healOrphanedHistory = async () => {
            try {
                for (const rb of reusableBags) {
                    let needsUpdate = false;
                    let nextHistory = Array.isArray(rb.usageHistory) ? [...rb.usageHistory] : [];

                    // Also merge from `history` if it was accidentally saved there from App.jsx
                    if (Array.isArray(rb.history) && rb.history.length > 0) {
                        for (const h of rb.history) {
                            if (!nextHistory.some(existing => existing.stockJournalId === h.stockJournalId)) {
                                nextHistory.push(h);
                                needsUpdate = true;
                            }
                        }
                    }

                    // 1. Remove orphaned history entries (vouchers that were deleted)
                    const validHistory = [];
                    for (const h of nextHistory) {
                        const sjId = h.stockJournalId;
                        const sjRef = h.manufacturingRefNo;
                        
                        let isValid = false;
                        if (sjId) {
                            if (stockJournals.some(sj => sj.id === sjId)) isValid = true;
                            else {
                                const sjSnap = await getDoc(doc(db, 'stock_journals', sjId));
                                isValid = sjSnap.exists();
                            }
                        } else if (sjRef && sjRef !== '-') {
                            if (stockJournals.some(sj => sj.refNo === sjRef)) isValid = true;
                            else {
                                const qSj = query(collection(db, 'stock_journals'), where('refNo', '==', sjRef));
                                const snapSj = await getDocs(qSj);
                                isValid = !snapSj.empty;
                            }
                        } else {
                            // If it has neither ID nor RefNo but is in history, keep it for safety unless we're sure it's dead
                            isValid = true;
                        }
                        
                        if (isValid) validHistory.push(h);
                        else needsUpdate = true;
                    }
                    nextHistory = validHistory;

                    // 2. Add MISSING history entries from loaded stockJournals (covers older vouchers)
                    const rbBagNoMatch = String(rb.bagNo || '').trim().toUpperCase().replace(/^#/, '');
                    for (const sj of stockJournals) {
                        const allVoucherBags = [
                            ...(Array.isArray(sj.jumboBags) ? sj.jumboBags : []),
                            ...(Array.isArray(sj.jumbo_bags) ? sj.jumbo_bags : []),
                            ...(Array.isArray(sj.producedBags) ? sj.producedBags : []),
                            ...(Array.isArray(sj.produced) ? sj.produced.flatMap(p => (Array.isArray(p.jumboBags) ? p.jumboBags : Array.isArray(p.jumbo_bags) ? p.jumbo_bags : [])) : [])
                        ];
                        
                        // Check if this specific reusable bag was filled in this voucher
                        const usedBags = allVoucherBags.filter(b => b && typeof b === 'object' && String(b.bagNo || '').trim().toUpperCase().replace(/^#/, '') === rbBagNoMatch);
                        
                        if (usedBags.length > 0) {
                            // Check if this voucher is already in the history
                            const alreadyExists = nextHistory.some(h => (h.stockJournalId === sj.id) || (h.manufacturingRefNo && h.manufacturingRefNo === sj.refNo && h.date === sj.date));
                            if (!alreadyExists) {
                                // Calculate total quantity for this bag in this voucher
                                const totalQty = usedBags.reduce((sum, b) => sum + Number(b.qty || 0), 0);
                                const productIds = [...new Set(usedBags.map(b => b.productId).filter(Boolean))];
                                const productNames = [...new Set(productIds.map(pId => getProductName(pId)).filter(Boolean))];

                                const usageEntry = {
                                    bagNo: usedBags[0].bagNo,
                                    date: sj.date || '',
                                    manufacturingRefNo: sj.refNo || '',
                                    stockJournalId: sj.id || '',
                                    qty: Number(totalQty),
                                    fillCount: usedBags.length,
                                    productIds: productIds,
                                    productNames: productNames,
                                    createdAtIso: new Date().toISOString()
                                };
                                nextHistory.push(usageEntry);
                                needsUpdate = true;
                            }
                        }
                    }

                    // If changes were made, update the database
                    if (needsUpdate) {
                        // Sort chronologically by date
                        nextHistory.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

                        const nextRefillCount = nextHistory.reduce((sum, h) => sum + Number(h.fillCount || 1), 0);
                        const nextTotalWeight = nextHistory.reduce((sum, h) => sum + Number(h.qty || 0), 0);
                        const lastEntry = nextHistory[nextHistory.length - 1];

                        await updateDoc(doc(db, 'reusable_jumbo_bags', rb.id), {
                            usageHistory: nextHistory,
                            refillCount: nextRefillCount,
                            totalWeight: nextTotalWeight,
                            lastDate: lastEntry ? (lastEntry.date || '') : '',
                            lastRefNo: lastEntry ? (lastEntry.manufacturingRefNo || '') : '',
                            lastStockJournalId: lastEntry ? (lastEntry.stockJournalId || '') : ''
                        });
                        console.log('Self-healed reusable bag #' + rb.bagNo + ' - synchronized complete timeline history.');
                    }
                }
            } catch (err) {
                console.warn('Self-healing routine error:', err);
            }
        };

        healOrphanedHistory();
    }, [isOpen, targetUid, reusableBags.length, stockJournals.length]);


    const handleSaveReusableBag = async () => {
        if (!newReusableBagNo.trim()) return;
        setSavingReusable(true);
        try {
            const normalizedNo = newReusableBagNo.trim().toUpperCase().replace(/^#/, '');
            // Check if already exists
            const existing = reusableBags.find(rb => rb.bagNo?.toUpperCase().replace(/^#/, '') === normalizedNo);
            if (existing) { alert(`Bag #${normalizedNo} is already in the reusable bag registry.`); return; }
            await addDoc(collection(db, 'reusable_jumbo_bags'), {
                bagNo: normalizedNo,
                status: 'active',
                startDate: new Date().toISOString().split('T')[0],
                lastDate: '',
                totalWeight: 0,
                ownerId: targetUid,
                userId: user?.uid,
                createdAt: serverTimestamp()
            });
            setNewReusableBagNo('');
            setShowMakeReusableModal(false);
        } catch (e) {
            alert('Error saving reusable bag: ' + e.message);
        } finally {
            setSavingReusable(false);
        }
    };

    const handleToggleReusableStatus = async (rb) => {
        try {
            const newStatus = rb.status === 'active' ? 'closed' : 'active';
            await updateDoc(doc(db, 'reusable_jumbo_bags', rb.id), {
                status: newStatus,
                lastDate: newStatus === 'closed' ? new Date().toISOString().split('T')[0] : rb.lastDate || ''
            });
        } catch (e) {
            alert('Error updating status: ' + e.message);
        }
    };

    if (!isOpen) return null;




    // Helper functions
    const getProductName = (id) => products?.find(p => p.id === id)?.name || 'Unknown Item';

    const getBagRefNo = (bag = {}) => {
        if (bag?.allFills && bag.allFills.length > 1) {
            const uniqueRefs = [...new Set(bag.allFills.map(f => getBagRefNo(f)).filter(r => r && r !== '-'))];
            return uniqueRefs.length > 0 ? uniqueRefs.join(', ') : '-';
        }
        if (readyStockSubTab === 'out') {
            return (
                bag.salesRefNo ||
                bag.salesId ||
                '-'
            );
        }
        return (
            bag.voucherRefNo ||
            bag.stockJournalRefNo ||
            bag.purchaseRefNo ||
            bag.refNo ||
            bag.stockJournalId ||
            bag.purchaseId ||
            '-'
        );
    };

    const normalizeDateKey = (value) => {
        if (!value) return '';
        if (typeof value?.toDate === 'function') {
            const d = value.toDate();
            if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString().split('T')[0];
        }
        if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().split('T')[0];
        const raw = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
        return '';
    };

    const formatWeight = (val) => Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const formatCurrency = (val) => Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const normalizeStatusGlobal = (status) => String(status || '').trim().toLowerCase();

    const soldInvoiceBagPool = salesInvoices.flatMap((inv) => {
        const invDate = normalizeDateKey(inv.date);
        return (Array.isArray(inv.soldBags) ? inv.soldBags : []).map((bag, idx) => ({
            ...bag,
            id: bag.id || `inv-${inv.id}-sold-${idx}`,
            salesId: inv.id,
            salesRefNo: inv.refNo || bag.salesRefNo || '',
            soldDate: bag.soldDate || invDate || inv.date,
            date: bag.date || bag.soldDate || invDate || inv.date,
            status: 'sold'
        }));
    });

    const soldBagIdsGlobal = new Set(
        [...bags.filter(b => normalizeStatusGlobal(b.status) === 'sold'), ...soldInvoiceBagPool]
            .map(b => String(b.id || '').trim())
            .filter(Boolean)
    );
    const soldBagNosGlobal = new Set(
        [...bags.filter(b => normalizeStatusGlobal(b.status) === 'sold'), ...soldInvoiceBagPool]
            .map(b => String(b.bagNo || '').replace(/^#/, '').trim().toUpperCase())
            .filter(Boolean)
    );

    const isBagSoldGlobally = (bag) => {
        const bagId = String(bag?.id || '').trim();
        const bagNo = String(bag?.bagNo || '').replace(/^#/, '').trim().toUpperCase();
        const dbBag = bagId ? bags.find(entry => String(entry.id || '').trim() === bagId) : null;
        return (
            normalizeStatusGlobal(bag?.status) === 'sold' ||
            normalizeStatusGlobal(dbBag?.status) === 'sold' ||
            (bagId && soldBagIdsGlobal.has(bagId)) ||
            (bagNo && soldBagNosGlobal.has(bagNo)) ||
            !!bag?.salesId ||
            !!bag?.salesRefNo
        );
    };

    const soldBagsInDateRange = [
        ...bags.filter(b => normalizeStatusGlobal(b.status) === 'sold'),
        ...soldInvoiceBagPool
    ].filter((bag) => {
        const bagDate = normalizeDateKey(bag.soldDate || bag.date);
        if (!bagDate) return true;
        return bagDate >= dateRange.from && bagDate <= dateRange.to;
    });

    const isBagReusable = (b) => {
        if (!b) return false;
        if (b.isRefill || b.isReusable || b.reusableBagId) return true;
        return reusableBags.some(rb => String(rb.bagNo || '').replace(/^#/, '').trim().toUpperCase() === String(b.bagNo || '').replace(/^#/, '').trim().toUpperCase());
    };

    const getBagsForVoucher = (vch) => {
        if (!vch) return [];
        
        const vchId = String(vch.id);
        const vchRef = (vch.refNo || '').toLowerCase();
        
        // 1. Find bags in the global collection linked via ID or RefNo
        const linkedInGlobal = bags.filter(b => {
            const bIdMatch = (
                (b.stockJournalId && String(b.stockJournalId) === vchId) ||
                (b.linkedStockJournalId && String(b.linkedStockJournalId) === vchId) ||
                (b.voucherId && String(b.voucherId) === vchId) ||
                (b.purchaseId && String(b.purchaseId) === vchId) ||
                (b.salesId && String(b.salesId) === vchId) ||
                (b.originId && String(b.originId) === vchId)
            );

            const bRefMatch = vchRef && (
                (b.stockJournalRefNo && String(b.stockJournalRefNo).toLowerCase() === vchRef) ||
                (b.voucherRefNo && String(b.voucherRefNo).toLowerCase() === vchRef) ||
                (b.purchaseRefNo && String(b.purchaseRefNo).toLowerCase() === vchRef) ||
                (b.salesRefNo && String(b.salesRefNo).toLowerCase() === vchRef) ||
                (b.refNo && String(b.refNo).toLowerCase() === vchRef)
            );

            const bListMatch = (
                (vch.jumboBags && Array.isArray(vch.jumboBags) && vch.jumboBags.some(jb => (jb.id || jb) === b.id)) ||
                (vch.jumbo_bags && Array.isArray(vch.jumbo_bags) && vch.jumbo_bags.some(jb => (jb.id || jb) === b.id))
            );

            return bIdMatch || bRefMatch || bListMatch;
        }).map(b => ({
            ...b,
            voucherRefNo: b.voucherRefNo || vch.refNo,
            stockJournalRefNo: b.stockJournalRefNo || vch.refNo,
            stockJournalId: b.stockJournalId || vchId
        }));

        // 2. Find bags embedded directly in the voucher (handles unsynced or legacy data)
        const embedded = [
            ...(Array.isArray(vch.jumboBags) ? vch.jumboBags : []),
            ...(Array.isArray(vch.jumbo_bags) ? vch.jumbo_bags : []),
            ...(Array.isArray(vch.producedBags) ? vch.producedBags : []),
            ...(Array.isArray(vch.produced) ? vch.produced.flatMap(p => (Array.isArray(p.jumboBags) ? p.jumboBags : Array.isArray(p.jumbo_bags) ? p.jumbo_bags : [])) : [])
        ].filter(jb => jb && typeof jb === 'object'); // Removed strict jb.id requirement

        // Deduplicate embedded by ID or BagNo
        const uniqueEmbedded = [];
        const seenIds = new Set(linkedInGlobal.map(b => String(b.id)));
        const seenBagNos = new Set(linkedInGlobal.map(b => String(b.bagNo || '').toLowerCase()));
        
        embedded.forEach((eb, idx) => {
            const ebId = eb.id || `embedded-${vchId}-${idx}`;
            const ebBagNo = String(eb.bagNo || '').toLowerCase();
            
            if (!seenIds.has(ebId) && (!ebBagNo || !seenBagNos.has(ebBagNo))) {
                seenIds.add(ebId);
                if (ebBagNo) seenBagNos.add(ebBagNo);
                
                uniqueEmbedded.push({
                    ...eb,
                    id: ebId,
                    date: eb.date || vch.date,
                    voucherRefNo: eb.voucherRefNo || vch.refNo,
                    stockJournalRefNo: vch.refNo,
                    stockJournalId: vchId
                });
            }
        });

        return [...linkedInGlobal, ...uniqueEmbedded];
    };

    const dedupeBagsByKey = (list, keyBuilder) => {
        const map = new Map();
        list.forEach((bag, idx) => {
            const key = keyBuilder(bag, idx);
            if (!map.has(key)) {
                map.set(key, bag);
            }
        });
        return [...map.values()];
    };

    const salesLookupByIdGlobal = new Map();
    const salesLookupByBagNoGlobal = new Map();
    soldInvoiceBagPool.forEach((bag) => {
        const bagId = String(bag.id || '').trim();
        const bagNo = String(bag.bagNo || '').replace(/^#/, '').trim().toUpperCase();
        if (bagId) salesLookupByIdGlobal.set(bagId, bag);
        if (bagNo) salesLookupByBagNoGlobal.set(bagNo, bag);
    });

    const enrichBagWithSalesGlobal = (bag) => {
        const bagId = String(bag?.id || '').trim();
        const bagNo = String(bag?.bagNo || '').replace(/^#/, '').trim().toUpperCase();
        const match = (bagId && salesLookupByIdGlobal.get(bagId)) || (bagNo && salesLookupByBagNoGlobal.get(bagNo));
        if (!match) return bag;
        return {
            ...bag,
            salesId: bag.salesId || match.salesId || '',
            salesRefNo: bag.salesRefNo || match.salesRefNo || '',
            voucherRefNo: bag.salesRefNo || match.salesRefNo || bag.voucherRefNo || '',
            soldDate: bag.soldDate || match.soldDate || bag.date,
            status: 'sold'
        };
    };

    const inwardDashboardBags = dedupeBagsByKey(
        stockJournals.flatMap((sj) => getBagsForVoucher(sj)).filter((b) => !isBagReusable(b)),
        (bag, idx) => {
            const bagNo = String(bag.bagNo || '').replace(/^#/, '').trim().toUpperCase();
            const bagId = String(bag.id || '').trim();
            return bagNo || bagId || `${String(bag.stockJournalRefNo || bag.voucherRefNo || 'NA')}|${idx}`;
        }
    );

    const outwardDashboardBags = dedupeBagsByKey(
        soldBagsInDateRange
            .map(enrichBagWithSalesGlobal)
            .filter((b) => b.salesId || b.salesRefNo),
        (bag, idx) => {
            const salesRef = String(bag.salesRefNo || bag.voucherRefNo || '').trim().toUpperCase();
            const bagNo = String(bag.bagNo || '').replace(/^#/, '').trim().toUpperCase();
            const bagId = String(bag.id || '').trim();
            return `${salesRef || 'NA'}|${bagNo || bagId || `IDX-${idx}`}`;
        }
    );

    const readyDashboardBags = inwardDashboardBags.filter((b) => !isBagSoldGlobally(b));

    const inwardDashboardRefs = new Set(inwardDashboardBags.map((b) => String(b.stockJournalRefNo || b.voucherRefNo || '').trim()).filter(Boolean)).size;
    const outwardDashboardRefs = new Set(outwardDashboardBags.map((b) => String(b.salesRefNo || b.voucherRefNo || '').trim()).filter(Boolean)).size;
    const readyDashboardRefs = new Set(readyDashboardBags.map((b) => String(b.stockJournalRefNo || b.voucherRefNo || '').trim()).filter(Boolean)).size;
    const inwardDashboardWeight = inwardDashboardBags.reduce((sum, b) => sum + Number(b.qty || 0), 0);
    const outwardDashboardWeight = outwardDashboardBags.reduce((sum, b) => sum + Number(b.qty || 0), 0);
    const readyDashboardWeight = readyDashboardBags.reduce((sum, b) => sum + Number(b.qty || 0), 0);



    if (isDeepAnalysing) {
        return (
            <>
            <div 
                className="fixed inset-0 flex items-center justify-center p-0 animate-in fade-in duration-300"
                style={{ zIndex: zIndex + 10, backgroundColor: 'transparent', backdropFilter: 'blur(12px)' }}
            >
                <div className="bg-[#f8fafc] w-full h-full rounded-none shadow-2xl flex flex-col overflow-hidden border-none animate-in zoom-in-95 duration-300">

                    {/* Deep Analysis Header - Compact */}
                    <div className="bg-white px-10 py-3 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <button 
                                onClick={() => viewingDetail ? setViewingDetail(null) : setIsDeepAnalysing(false)}
                                className="w-12 h-12 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-[#1e3264] hover:text-white transition-all active:scale-90"
                            >
                                <ChevronLeft size={24} />
                            </button>
                            <div>
                                <div className="flex items-center gap-3 mb-0.5">
                                    <h2 className="text-[23px] font-black text-[#1e3264] uppercase tracking-tight">
                                        Filled Bags Inventory Intelligence
                                    </h2>
                                    <div className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                        <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">
                                            DB Cache: {bags.length} Records
                                        </span>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                    {viewingDetail ? viewingDetail.replace('_', ' ') : 'Filled Bags Traceability & Analysis Dashboard'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 flex-1 max-w-md ml-10">
                            <div className="relative w-full">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input 
                                    type="text"
                                    placeholder="Search by Ref No or Item..."
                                    className="w-full pl-12 pr-4 py-2.5 bg-slate-100 border-none rounded-2xl text-[11px] font-bold text-[#1e3264] focus:ring-2 focus:ring-[#1e3264]/20 outline-none transition-all"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    data-lpignore="true"
                                    data-form-type="other"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-3 ml-4 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                            <div className="flex flex-col px-3 border-r border-slate-200">
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Period From</span>
                                <input 
                                    type="date" 
                                    value={dateRange.from} 
                                    onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                                    className="bg-transparent text-[11px] font-black text-[#1e3264] outline-none"
                                />
                            </div>
                            <div className="flex flex-col px-3">
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Period To</span>
                                <input 
                                    type="date" 
                                    value={dateRange.to} 
                                    onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                                    className="bg-transparent text-[11px] font-black text-[#1e3264] outline-none"
                                />
                            </div>
                        </div>


                        <button 
                            onClick={onClose}
                            className="w-10 h-10 rounded-full hover:bg-red-50 hover:text-red-500 text-slate-400 flex items-center justify-center transition-all active:scale-90"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    {/* Deep Analysis Content */}
                    <div className="flex-1 overflow-y-auto bg-slate-50/50">

                        {!viewingDetail ? (
                            <div className="w-full h-full flex flex-col p-10">

                                {/* Reconciliation Panel */}
                                <div className="mb-8 p-5 bg-slate-50 border border-blue-200 rounded-2xl shadow-md">
                                    <div className="text-[10px] font-black text-blue-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                                        <BarChart3 size={14} className="inline-block text-blue-700" />
                                        Reconciliation Panel
                                    </div>
                                    {(() => {
                                        // Compute Inward, Outward, Ready, Orphan from deduped live dashboard collections
                                        const manufacturedBags = inwardDashboardBags;
                                        const soldBags = outwardDashboardBags;
                                        const readyBags = readyDashboardBags;
                                        const orphanBags = bags.filter(b => !b.stockJournalId && !b.purchaseId && !b.salesId && !b.voucherRefNo && !b.stockJournalRefNo && !b.purchaseRefNo && !b.salesRefNo);
                                        const sumWeight = arr => arr.reduce((s, b) => s + Number(b.qty || 0), 0);
                                        const format = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
                                        const dashboardInward = manufacturedBags.length;
                                        const dashboardOutward = soldBags.length;
                                        const dashboardReady = readyBags.length;
                                        const expectedReady = dashboardInward - dashboardOutward;
                                        const mismatch = dashboardReady !== expectedReady;

                                        // Card click handler
                                        const openDetail = (type) => setDetailModal(type);

                                        // Running balance helper
                                        const getRunningBalanceRows = (list, type) => {
                                            let running = 0;
                                            return list.map((b, i) => {
                                                if (type === 'inward' || type === 'ready' || (type === 'orphan' && (!b.salesId && !b.salesRefNo))) running += Number(b.qty || 0);
                                                if (type === 'outward' || (type === 'orphan' && (b.salesId || b.salesRefNo))) running -= Number(b.qty || 0);
                                                return { ...b, runningBalance: running };
                                            });
                                        };

                                        // Modal content for each type
                                        const renderDetailTable = (type) => {
                                            let rows = [];
                                            let columns = [];
                                            if (type === 'inward') {
                                                rows = getRunningBalanceRows([...manufacturedBags].sort((a,b)=>new Date(a.date)-new Date(b.date)), 'inward');
                                                columns = ['Bag No.', 'Ref No.', 'Date Mfg', 'Qty', 'Running Qty Balance'];
                                            } else if (type === 'outward') {
                                                rows = getRunningBalanceRows([...soldBags].sort((a,b)=>new Date(a.soldDate||a.date)-new Date(b.soldDate||b.date)), 'outward');
                                                columns = ['Bag No.', 'Ref No.', 'Date Sales', 'Qty', 'Running Qty Balance'];
                                            } else if (type === 'ready') {
                                                rows = getRunningBalanceRows([...readyBags].sort((a,b)=>new Date(a.date)-new Date(b.date)), 'ready');
                                                columns = ['Bag No.', 'Ref No.', 'Date Mfg', 'Qty', 'Running Qty Balance'];
                                            } else if (type === 'orphan') {
                                                rows = getRunningBalanceRows([...orphanBags].sort((a,b)=>new Date(a.date)-new Date(b.date)), 'orphan');
                                                columns = ['Bag No.', 'Ref No.', 'Date Mfg', 'Date Sales', 'Qty', 'Running Qty Balance', 'Delete'];
                                            }
                                            return (
                                                <div className="fixed inset-0 z-[2000] bg-black/40 flex items-center justify-center">
                                                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl max-h-[80vh] overflow-auto relative">
                                                        <button className="absolute top-2 right-2 text-slate-400 hover:text-red-500" onClick={()=>setDetailModal(null)}><X size={20}/></button>
                                                        <div className="font-black text-lg mb-4 uppercase tracking-widest">{type.replace(/^(.)/,c=>c.toUpperCase())} Bags Details</div>
                                                        <table className="w-full text-xs border">
                                                            <thead>
                                                                <tr>{columns.map((c,i)=>(<th key={i} className="px-3 py-2 bg-slate-100 border-b font-black uppercase">{c}</th>))}</tr>
                                                            </thead>
                                                            <tbody>
                                                                {rows.map((b,i)=>(
                                                                    <tr key={b.id||i} className="border-b hover:bg-slate-50">
                                                                        <td className="px-2 py-1">{b.bagNo||'-'}</td>
                                                                        <td className="px-2 py-1">{b.voucherRefNo||b.stockJournalRefNo||'-'}</td>
                                                                        <td className="px-2 py-1">{type==='outward'?'-':(b.date?normalizeDate(b.date):'-')}</td>
                                                                        {type==='orphan'?<td className="px-2 py-1">{b.soldDate?normalizeDate(b.soldDate):'-'}</td>:null}
                                                                        <td className="px-2 py-1">{format(b.qty)}</td>
                                                                        <td className="px-2 py-1">{format(b.runningBalance)}</td>
                                                                        {type==='orphan'?<td className="px-2 py-1">{!b.stockJournalId&&!b.voucherRefNo?<button className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold hover:bg-red-200 transition-colors" onClick={(e)=>{e.stopPropagation(); alert("Delete button clicked for bag: " + (b.bagNo || 'Unknown')); setDeleteBagPrompt(b);setDeletePassword('');}}>Delete</button>:<span className="text-slate-400 text-xs">N/A</span>}</td>:null}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        };

                                        return <>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px]">
                                                <div className="bg-white border border-blue-100 rounded-xl p-3 flex flex-col items-center cursor-pointer hover:shadow-lg transition" onClick={()=>openDetail('inward')}>
                                                    <div className="font-black text-blue-700 uppercase text-[9px] mb-1">Inward (Manufactured)</div>
                                                    <div className="text-blue-900 font-extrabold text-lg">{dashboardInward} Bags</div>
                                                    <div className="text-blue-500 font-bold">{format(sumWeight(manufacturedBags))} KG</div>
                                                </div>
                                                <div className="bg-white border border-emerald-100 rounded-xl p-3 flex flex-col items-center cursor-pointer hover:shadow-lg transition" onClick={()=>openDetail('outward')}>
                                                    <div className="font-black text-emerald-700 uppercase text-[9px] mb-1">Outward (Sold)</div>
                                                    <div className="text-emerald-900 font-extrabold text-lg">{dashboardOutward} Bags</div>
                                                    <div className="text-emerald-500 font-bold">{format(sumWeight(soldBags))} KG</div>
                                                </div>
                                                <div className={`bg-white border ${mismatch ? 'border-red-400' : 'border-amber-100'} rounded-xl p-3 flex flex-col items-center cursor-pointer hover:shadow-lg transition`} onClick={()=>openDetail('ready')}>
                                                    <div className={`font-black uppercase text-[9px] mb-1 ${mismatch ? 'text-red-700' : 'text-amber-700'}`}>Ready (In Stock)</div>
                                                    <div className={`font-extrabold text-lg ${mismatch ? 'text-red-700' : 'text-amber-900'}`}>{dashboardReady} Bags</div>
                                                    <div className={`font-bold ${mismatch ? 'text-red-500' : 'text-amber-500'}`}>{format(sumWeight(readyBags))} KG</div>
                                                    {mismatch && (
                                                        <div className="mt-2 text-xs text-red-600 font-bold flex items-center gap-2">
                                                            <AlertCircle size={14} />
                                                            Mismatch detected! Ready = {expectedReady} expected
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-4 text-[11px] text-orange-700 font-bold flex items-center gap-2 cursor-pointer hover:underline" onClick={()=>openDetail('orphan')}>
                                                <Recycle size={14} />
                                                Orphan Bags: {orphanBags.length}
                                                <span className="text-orange-500 font-normal">(Bags with no parent voucher link)</span>
                                            </div>
                                            {detailModal && renderDetailTable(detailModal)}
                                        </>;
                                    })()}
                                </div>

                                <div className="mb-8 p-5 bg-white border border-slate-200 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-black text-[#1e3264] uppercase tracking-widest mb-2">
                                        Logic Notice Board
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-[11px]">
                                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                                            <div className="font-black text-blue-700 uppercase text-[9px] mb-1">Inward Rule</div>
                                            <div className="text-slate-700 font-semibold">Manufacturing save creates allocated filled bags and links them to voucher reference.</div>
                                        </div>
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                                            <div className="font-black text-emerald-700 uppercase text-[9px] mb-1">Outward Rule</div>
                                            <div className="text-slate-700 font-semibold">Sales save marks only selected in-stock bags as sold and records sales reference.</div>
                                        </div>
                                        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                                            <div className="font-black text-amber-700 uppercase text-[9px] mb-1">Ready Stock Rule</div>
                                            <div className="text-slate-700 font-semibold">Ready Bags = Total Inward - Total Outward (sold). Dashboard syncs live with voucher updates.</div>
                                        </div>
                                        <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
                                            <div className="font-black text-orange-700 uppercase text-[9px] mb-1">Orphan Rule</div>
                                            <div className="text-slate-700 font-semibold">Bags with missing parent links are flagged as orphan and can be removed with admin password.</div>
                                        </div>
                                    </div>
                                </div>


                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">

                                    {/* Button 1: Jumbo Bags In (Manufacturing) */}
                                    <button 
                                        onClick={() => {
                                            setReadyStockSubTab('in');
                                            setViewMode('detail');
                                            setViewingDetail('jumbo_in');
                                        }}
                                        className="group relative bg-white rounded-[2rem] p-8 border border-slate-200 shadow-xl hover:shadow-2xl hover:border-blue-500/50 transition-all duration-500 flex flex-col items-center text-center overflow-hidden h-full"
                                    >
                                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-right from-blue-500 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 shadow-inner">
                                            <Layers size={32} />
                                        </div>
                                        <h3 className="text-base font-black text-[#1e3264] uppercase tracking-tight mb-3 leading-tight">
                                            JBW Inventory (IN)
                                        </h3>
                                        <div className="flex flex-col gap-1 mb-6">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                                                    {inwardDashboardBags.length} BAGS
                                                </span>
                                                <span className="text-[10px] font-black text-[#1e3264] bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                                    {inwardDashboardRefs} REF NOS
                                                </span>
                                                <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                                    {formatWeight(inwardDashboardWeight)} KG
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                                Detailed traceability for manufactured bags with lot association.
                                            </p>
                                        </div>
                                        <div className="mt-auto px-4 py-2 bg-blue-50 text-blue-700 text-[9px] font-black rounded-full opacity-0 group-hover:opacity-100 transition-opacity uppercase">
                                            View Report
                                        </div>
                                    </button>

                                    {/* Button 2: Manufacturing Register */}
                                    <button 
                                        onClick={() => setViewingDetail('manuf_reg')}
                                        className="group relative bg-white rounded-[2rem] p-8 border border-slate-200 shadow-xl hover:shadow-2xl hover:border-[#1e3264]/50 transition-all duration-500 flex flex-col items-center text-center overflow-hidden h-full"
                                    >
                                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-right from-[#1e3264] to-[#2b5797] opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="w-16 h-16 rounded-2xl bg-slate-100 text-[#1e3264] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                                            <FileSearch size={32} />
                                        </div>
                                        <h3 className="text-base font-black text-[#1e3264] uppercase tracking-tight mb-3 leading-tight">
                                            Production Register
                                        </h3>
                                        <div className="flex flex-col gap-1 mb-6">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="text-[10px] font-black text-[#1e3264] bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                                    {stockJournals.length} VOUCHERS
                                                </span>
                                                <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                                                    {stockJournals.reduce((acc, sj) => acc + getBagsForVoucher(sj).filter(b => !isBagReusable(b)).length, 0)} BAGS
                                                </span>
                                                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                                    {formatWeight(stockJournals.reduce((acc, sj) => acc + (sj.produced || []).reduce((sum, p) => sum + Number(p.quantity || 0), 0), 0))} KG
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                                Production logs and weight summaries for all cycles.
                                            </p>
                                        </div>
                                        <div className="mt-auto px-4 py-2 bg-[#1e3264]/10 text-[#1e3264] text-[9px] font-black rounded-full opacity-0 group-hover:opacity-100 transition-opacity uppercase">
                                            Open Register
                                        </div>
                                    </button>

                                    {/* Button 3: Jumbo Bags Out (Sales) */}
                                    <button 
                                        onClick={() => {
                                            setReadyStockSubTab('out');
                                            setViewMode('detail');
                                            setViewingDetail('jumbo_out');
                                        }}
                                        className="group relative bg-white rounded-[2rem] p-8 border border-slate-200 shadow-xl hover:shadow-2xl hover:border-emerald-500/50 transition-all duration-500 flex flex-col items-center text-center overflow-hidden h-full"
                                    >
                                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-right from-emerald-500 to-teal-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-500 shadow-inner">
                                            <TrendingUp size={32} />
                                        </div>
                                        <h3 className="text-base font-black text-[#1e3264] uppercase tracking-tight mb-3 leading-tight">
                                            Jumbo Bags Outflow
                                        </h3>
                                        <div className="flex flex-col gap-1 mb-6">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                                    {outwardDashboardBags.length} BAGS
                                                </span>
                                                <span className="text-[10px] font-black text-[#1e3264] bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                                    {outwardDashboardRefs} REF NOS
                                                </span>
                                                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                                    {formatWeight(outwardDashboardWeight)} KG
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                                Track dispatches and sales deductions automatically.
                                            </p>
                                        </div>
                                        <div className="mt-auto px-4 py-2 bg-emerald-50 text-emerald-700 text-[9px] font-black rounded-full opacity-0 group-hover:opacity-100 transition-opacity uppercase">
                                            View Dispatches
                                        </div>
                                    </button>

                                    {/* Button 6: Reusable Jumbo Bags */}
                                    <button 
                                        onClick={() => setViewingDetail('reusable_bags')}
                                        className="group relative bg-white rounded-[2rem] p-8 border border-slate-200 shadow-xl hover:shadow-2xl hover:border-teal-500/50 transition-all duration-500 flex flex-col items-center text-center overflow-hidden h-full"
                                    >
                                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-right from-teal-400 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="w-16 h-16 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                                            <Recycle size={32} />
                                        </div>
                                        <h3 className="text-base font-black text-[#1e3264] uppercase tracking-tight mb-3 leading-tight">
                                            Reusable Jumbo Bags
                                        </h3>
                                        <div className="flex flex-col gap-1 mb-6">
                                            <div className="flex flex-wrap items-center justify-center gap-1.5 px-2">
                                                <span className="text-[10px] font-black text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">
                                                    {reusableBags.filter(rb => rb.status === 'active').length} ACTIVE
                                                </span>
                                                <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                                    {reusableBags.length} TOTAL
                                                </span>
                                                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                                    {formatWeight(reusableBags.reduce((sum, rb) => sum + (Number(rb.totalWeight || 0) || (Array.isArray(rb.usageHistory) ? rb.usageHistory.reduce((s, h) => s + Number(h.qty || 0), 0) : 0)), 0))} KG
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                                Bags approved for multiple reuses across production cycles.
                                            </p>
                                        </div>
                                        <div className="mt-auto px-4 py-2 bg-teal-50 text-teal-700 text-[9px] font-black rounded-full opacity-0 group-hover:opacity-100 transition-opacity uppercase">
                                            Manage Reusable Bags
                                        </div>
                                    </button>

                                    {/* Button 4: Ready Stock Balance */}
                                    <button 
                                        onClick={() => {
                                            setReadyStockSubTab('remaining');
                                            setViewMode('summary');
                                            setViewingDetail('ready_stock');
                                        }}
                                        className="group relative bg-white rounded-[2rem] p-8 border border-slate-200 shadow-xl hover:shadow-2xl hover:border-amber-500/50 transition-all duration-500 flex flex-col items-center text-center overflow-hidden h-full"
                                    >
                                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-right from-amber-500 to-orange-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                                            <Archive size={32} />
                                        </div>
                                        <h3 className="text-base font-black text-[#1e3264] uppercase tracking-tight mb-3 leading-tight">
                                            Ready Stock Balance
                                        </h3>
                                        <div className="flex flex-col gap-1 mb-6">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                                                    {readyDashboardBags.length} BAGS
                                                </span>
                                                <span className="text-[10px] font-black text-[#1e3264] bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                                    {readyDashboardRefs} REF NOS
                                                </span>
                                                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                                    {formatWeight(readyDashboardWeight)} KG
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                                Live view of available bags. Sold bags are excluded.
                                            </p>
                                        </div>
                                        <div className="mt-auto px-6 py-2 bg-amber-100 text-amber-800 text-[8px] font-black rounded-full uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                                            Open Report
                                        </div>
                                    </button>
                                </div>

                                {/* Deep Analysis Footer Note */}
                                <div className="mt-10 p-6 bg-[#1e3264]/5 border border-[#1e3264]/10 rounded-2xl flex items-start gap-4">
                                    <Info size={20} className="text-[#1e3264] shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-[#1e3264]/70 font-medium leading-relaxed uppercase">
                                        <strong>Real-time Sync:</strong> All data displayed in this deep analysis view is synced with the main inventory ledger. Any changes in manufacturing or sales vouchers reflect here instantly.
                                    </p>
                                </div>
                            </div>
                        ) : viewingDetail === 'jumbo_allocated' ? (() => {
                            // Logic for JUMBO BAGS ALLOCATED INWARD
                            // We pull bags specifically from stockJournals (allocations)
                            const allocatedList = stockJournals.flatMap(sj => {
                                return getBagsForVoucher(sj).map(b => ({
                                    ...b,
                                    date: b.date || sj.date,
                                    voucherRefNo: b.voucherRefNo || sj.refNo,
                                    stockJournalId: sj.id
                                }));
                            });

                            const filteredAllocated = allocatedList.filter(b => {
                                const search = searchTerm.toLowerCase();
                                const bNo = (b.bagNo || '').toLowerCase();
                                const vRef = (b.voucherRefNo || '').toLowerCase();
                                return bNo.includes(search) || vRef.includes(search);
                            }).sort((a, b) => {
                                if (!sortConfig.key) return 0;
                                let aVal, bVal;
                                
                                if (sortConfig.key === 'date') {
                                    aVal = new Date(a.date || 0);
                                    bVal = new Date(b.date || 0);
                                } else if (sortConfig.key === 'voucher') {
                                    aVal = (a.voucherRefNo || '').toLowerCase();
                                    bVal = (b.voucherRefNo || '').toLowerCase();
                                } else if (sortConfig.key === 'bagNo') {
                                    aVal = (a.bagNo || '');
                                    bVal = (b.bagNo || '');
                                    return sortConfig.direction === 'asc' 
                                        ? aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' })
                                        : bVal.localeCompare(aVal, undefined, { numeric: true, sensitivity: 'base' });
                                } else if (sortConfig.key === 'weight') {
                                    aVal = Number(a.qty || 0);
                                    bVal = Number(b.qty || 0);
                                }

                                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                                return 0;
                            });

                            const totalAllocatedWeight = filteredAllocated.reduce((acc, b) => acc + Number(b.qty || 0), 0);
                            const uniqueAllocatedRefCount = new Set(
                                allocatedList
                                    .map(b => String((b.voucherRefNo || b.stockJournalRefNo || '').trim()).toUpperCase())
                                    .filter(Boolean)
                            ).size;

                            const SortIcon = ({ column }) => {
                                if (sortConfig.key !== column) return <span className="ml-1 opacity-20">↕</span>;
                                return sortConfig.direction === 'asc' ? <span className="ml-1 text-white">↑</span> : <span className="ml-1 text-white">↓</span>;
                            };

                            return (
                                <div className="w-full h-full p-0 flex flex-col">
                                    <div className="bg-white border-none shadow-none overflow-hidden flex flex-col h-full">
                                        <div className="px-6 py-3 bg-violet-50 border-b border-violet-100 flex items-center gap-3 text-[10px] font-black uppercase tracking-widest">
                                            <span className="bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full border border-violet-200">{allocatedList.length} BAGS</span>
                                            <span className="bg-[#1e3264]/10 text-[#1e3264] px-2 py-0.5 rounded-full border border-[#1e3264]/20">{uniqueAllocatedRefCount} REF NOS</span>
                                            <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">{formatWeight(totalAllocatedWeight)} KG</span>
                                        </div>
                                        <div className="overflow-x-auto flex-1">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-violet-900 text-white select-none">
                                                        <th 
                                                            className="px-6 py-4 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-violet-800 transition-colors"
                                                            onClick={() => requestSort('date')}
                                                        >
                                                            Date <SortIcon column="date" />
                                                        </th>
                                                        <th 
                                                            className="px-6 py-4 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-violet-800 transition-colors"
                                                            onClick={() => requestSort('bagNo')}
                                                        >
                                                            Bag No. <SortIcon column="bagNo" />
                                                        </th>
                                                        <th 
                                                            className="px-6 py-4 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-violet-800 transition-colors"
                                                            onClick={() => requestSort('voucher')}
                                                        >
                                                            Voucher No. (Ref) <SortIcon column="voucher" />
                                                        </th>
                                                        <th 
                                                            className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-violet-800 transition-colors"
                                                            onClick={() => requestSort('weight')}
                                                        >
                                                            Weight (KG) <SortIcon column="weight" />
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {filteredAllocated.map((b, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                                                            <td className="px-6 py-3 text-[11px] font-bold text-slate-500">{normalizeDate(b.date)}</td>
                                                            <td className="px-6 py-3">
                                                                <span className="bg-violet-50 text-violet-700 px-3 py-1 rounded-full text-[10px] font-black border border-violet-100 uppercase tracking-tighter">
                                                                    #{b.bagNo || b.id?.slice(-4)}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-3 text-[11px] font-black text-[#1e3264] uppercase tracking-tight">{b.voucherRefNo || '-'}</td>
                                                            <td className="px-6 py-3 text-right text-[12px] font-black text-slate-900">{formatWeight(b.qty)}</td>
                                                        </tr>
                                                    ))}
                                                    {filteredAllocated.length === 0 && (
                                                        <tr>
                                                            <td colSpan="4" className="px-6 py-20 text-center text-slate-400 font-bold uppercase tracking-widest italic">
                                                                No Allocations Found for this period
                                                                <br/>
                                                                <span className="text-[10px] opacity-60">Check "Period From" date range</span>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                                <tfoot className="bg-slate-50 sticky bottom-0 border-t-2 border-slate-200">
                                                    <tr>
                                                        <td colSpan="3" className="px-6 py-4 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Allocated:</td>
                                                        <td className="px-6 py-4 text-right text-[16px] font-black text-violet-700">{formatWeight(totalAllocatedWeight)}</td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            );
                        })() : (viewingDetail === 'jumbo_in' || viewingDetail === 'ready_stock' || viewingDetail === 'jumbo_out') ? (() => {
                            const normalizeStatus = (status) => String(status || '').trim().toLowerCase();

                            const isManufacturedBag = (b = {}) => {
                                const src = String(b.source || '').toLowerCase();
                                return !!(
                                    b.stockJournalId ||
                                    b.linkedStockJournalId ||
                                    b.voucherId ||
                                    b.originId ||
                                    b.parentVoucherId ||
                                    b.purchaseId ||
                                    b.salesId ||
                                    src.includes('prod') ||
                                    src.includes('manufact') ||
                                    src.includes('stock') ||
                                    src.includes('purch') ||
                                    src.includes('sale')
                                );
                            };

                            const activeSjIds = new Set(stockJournals.map(sj => String(sj.id)));
                            const activeSjRefs = new Set(stockJournals.map(sj => String(sj.refNo || '').trim().toLowerCase()).filter(Boolean));
                            const sjRefById = new Map(stockJournals.map(sj => [String(sj.id), sj.refNo || '']));

                            const directManufactured = bags
                                .filter(b => {
                                    if (!isManufacturedBag(b)) return false;
                                    
                                    const pId = String(b.stockJournalId || b.linkedStockJournalId || b.voucherId || b.originId || b.parentVoucherId || b.salesId || '').trim();
                                    const pRef = String(b.stockJournalRefNo || b.voucherRefNo || b.refNo || b.salesRefNo || '').trim().toLowerCase();

                                    // 1. If we have a parent ID, it MUST exist in our active stock journals
                                    if (pId && !activeSjIds.has(pId)) {
                                        if (b.purchaseId || b.salesId) return true; // Bypass active check for purchased/sold bags
                                        return false; // It's an orphan by ID! Exclude it.
                                    }

                                    // 2. If we have a parent RefNo, it MUST exist in our active stock journals
                                    if (pRef && !activeSjRefs.has(pRef)) {
                                        if (b.purchaseRefNo || b.purchaseId || b.salesRefNo || b.salesId) return true; // Bypass active check
                                        return false; // It's an orphan by RefNo! Exclude it.
                                    }

                                    // 3. If it has neither ID nor RefNo, it has no link to any active voucher
                                    if (!pId && !pRef) {
                                        if (b.purchaseId || b.purchaseRefNo || b.salesId || b.salesRefNo) return true;
                                        return false;
                                    }

                                    return true;
                                })
                                .map((b) => ({
                                    ...b,
                                    stockJournalRefNo: b.stockJournalRefNo || sjRefById.get(String(b.stockJournalId || b.linkedStockJournalId || '')) || '',
                                    voucherRefNo: b.voucherRefNo || b.stockJournalRefNo || b.salesRefNo || sjRefById.get(String(b.stockJournalId || b.linkedStockJournalId || '')) || '',
                                    date: b.date || b.soldDate
                                }));

                            const embeddedFromVouchers = stockJournals.flatMap(sj => {
                                const vchBags = getBagsForVoucher(sj);
                                return vchBags.map(b => ({
                                    ...b,
                                    date: b.date || sj.date,
                                    stockJournalRefNo: b.stockJournalRefNo || sj.refNo,
                                    stockJournalId: b.stockJournalId || sj.id,
                                    voucherRefNo: b.voucherRefNo || sj.refNo
                                }));
                            });

                            const mergedMap = new Map();
                            [...directManufactured, ...embeddedFromVouchers].forEach((b, idx) => {
                                const key = b.id || `${b.bagNo || 'na'}|${b.stockJournalId || b.voucherRefNo || 'na'}|${idx}`;
                                mergedMap.set(key, b);
                            });

                            // ✅ CALCULATE REUSABLE REFILLS CHRONOLOGICALLY ACROSS ENTIRE HISTORY
                            const allHistoricalBags = [...mergedMap.values()];
                            const reusableOccurrences = {};

                            allHistoricalBags.forEach(b => {
                                const cleanB = String(b.bagNo || '').replace(/^#/, '').trim().toUpperCase();
                                const isReusable = b.isReusable || b.reusableBagId || reusableBags.some(rb => {
                                    const cleanR = String(rb.bagNo || '').replace(/^#/, '').trim().toUpperCase();
                                    return cleanR === cleanB;
                                });
                                if (isReusable && cleanB) {
                                    if (!reusableOccurrences[cleanB]) {
                                        reusableOccurrences[cleanB] = [];
                                    }
                                    reusableOccurrences[cleanB].push(b);
                                }
                            });

                            Object.keys(reusableOccurrences).forEach(cleanB => {
                                const occurrences = reusableOccurrences[cleanB];
                                occurrences.sort((a, b) => {
                                    const dateA = new Date(normalizeDateKey(a.date) || '1970-01-01');
                                    const dateB = new Date(normalizeDateKey(b.date) || '1970-01-01');
                                    if (dateA.getTime() !== dateB.getTime()) {
                                        return dateA.getTime() - dateB.getTime();
                                    }
                                    return String(a.id || '').localeCompare(String(b.id || ''));
                                });
                                occurrences.forEach((occ, idx) => {
                                    occ.isRefill = idx > 0;
                                    occ.refillCount = idx; // 0 is initial, >=1 is refill/reuse
                                });
                            });

                            const productionBagsList = allHistoricalBags.filter((b) => {
                                if (isBagReusable(b)) return false;
                                // Include bags linked to manufacturing, purchase, OR sales (for JUMBO OUT tracking)
                                const isTracked = b.stockJournalId || b.stockJournalRefNo || b.voucherRefNo || b.purchaseId || b.purchaseRefNo || b.salesId || b.salesRefNo;
                                if (!isTracked) return false;
                                
                                const bagDate = normalizeDateKey(b.date || b.soldDate);
                                if (!bagDate) return true;
                                return bagDate >= dateRange.from && bagDate <= dateRange.to;
                            });

                            const soldFromBagCollection = bags
                                .filter(b => normalizeStatus(b.status) === 'sold')
                                .map(b => ({
                                    ...b,
                                    date: b.date || b.soldDate,
                                    voucherRefNo: b.voucherRefNo || b.salesRefNo || '',
                                    stockJournalRefNo: b.stockJournalRefNo || ''
                                }));

                            const soldFromSalesInvoices = salesInvoices.flatMap((inv) => {
                                const invDate = normalizeDateKey(inv.date);
                                const sold = Array.isArray(inv.soldBags) ? inv.soldBags : [];
                                return sold.map((b, idx) => ({
                                    ...b,
                                    id: b.id || `inv-${inv.id}-sold-${idx}`,
                                    productId: b.productId,
                                    qty: Number(b.qty || 0),
                                    status: 'sold',
                                    salesId: inv.id,
                                    salesRefNo: inv.refNo || b.salesRefNo || '',
                                    voucherRefNo: b.voucherRefNo || inv.refNo || '',
                                    date: b.date || b.soldDate || invDate || inv.date,
                                    soldDate: b.soldDate || invDate || inv.date
                                }));
                            }).filter((b) => {
                                const bagDate = normalizeDateKey(b.soldDate || b.date);
                                if (!bagDate) return true;
                                return bagDate >= dateRange.from && bagDate <= dateRange.to;
                            });

                            const salesByBagId = new Map();
                            const salesByBagNo = new Map();
                            soldFromSalesInvoices.forEach((bag) => {
                                const bagId = String(bag.id || '').trim();
                                const bagNo = String(bag.bagNo || '').replace(/^#/, '').trim().toUpperCase();
                                if (bagId) salesByBagId.set(bagId, bag);
                                if (bagNo) salesByBagNo.set(bagNo, bag);
                            });

                            const enrichWithSalesLink = (bag) => {
                                const bagId = String(bag?.id || '').trim();
                                const bagNo = String(bag?.bagNo || '').replace(/^#/, '').trim().toUpperCase();
                                const match = (bagId && salesByBagId.get(bagId)) || (bagNo && salesByBagNo.get(bagNo));
                                if (!match) return bag;
                                return {
                                    ...bag,
                                    salesId: bag.salesId || match.salesId || '',
                                    salesRefNo: bag.salesRefNo || match.salesRefNo || '',
                                    voucherRefNo: bag.salesRefNo || match.salesRefNo || bag.voucherRefNo || '',
                                    soldDate: bag.soldDate || match.soldDate || bag.date,
                                    status: 'sold'
                                };
                            };

                            const soldBagIds = new Set(
                                [...soldFromBagCollection, ...soldFromSalesInvoices]
                                    .map(b => String(b.id || '').trim())
                                    .filter(Boolean)
                            );
                            const soldBagNos = new Set(
                                [...soldFromBagCollection, ...soldFromSalesInvoices]
                                    .map(b => String(b.bagNo || '').replace(/^#/, '').trim().toUpperCase())
                                    .filter(Boolean)
                            );

                            const isBagMarkedSold = (bag) => {
                                const bagId = String(bag?.id || '').trim();
                                const bagNo = String(bag?.bagNo || '').replace(/^#/, '').trim().toUpperCase();
                                const dbBag = bagId ? bags.find(gb => String(gb.id || '').trim() === bagId) : null;
                                return (
                                    normalizeStatus(bag?.status) === 'sold' ||
                                    normalizeStatus(dbBag?.status) === 'sold' ||
                                    (bagId && soldBagIds.has(bagId)) ||
                                    (bagNo && soldBagNos.has(bagNo)) ||
                                    !!bag?.salesId ||
                                    !!bag?.salesRefNo
                                );
                            };

                            // ✅ DYNAMICALLY FILTER LIST BY SUB-TAB VALUE
                            const subTabFilteredList = productionBagsList.filter(b => {
                                const isSold = isBagMarkedSold(b);
                                if (readyStockSubTab === 'out') {
                                    return isSold;
                                } else if (readyStockSubTab === 'remaining') {
                                    return !isSold;
                                }
                                return true; // 'in' shows all
                            });

                            // Always include sold data from both bag docs and sales invoices when OUT is open.
                            let filteredBagsList;
                            if (readyStockSubTab === 'out') {
                                const mergedOut = new Map();
                                [...subTabFilteredList, ...soldFromBagCollection, ...soldFromSalesInvoices].forEach((rawBag, idx) => {
                                    const b = enrichWithSalesLink(rawBag);
                                    const bagId = String(b.id || '').trim();
                                    const bagNo = String(b.bagNo || '').replace(/^#/, '').trim().toUpperCase();
                                    const salesRef = String(b.salesRefNo || b.voucherRefNo || '').trim().toUpperCase();
                                    const key = `${salesRef || 'NA'}|${bagNo || bagId || `IDX-${idx}`}`;
                                    mergedOut.set(key, b);
                                });

                                filteredBagsList = [...mergedOut.values()]
                                    .filter(b => {
                                        const linked = enrichWithSalesLink(b);
                                        return isBagMarkedSold(linked) && !!(linked.salesId || linked.salesRefNo);
                                    })
                                    .filter(b => !selectedReadyStockProductId || b.productId === selectedReadyStockProductId)
                                    .filter(b => {
                                        const search = searchTerm.toLowerCase();
                                        const prodName = getProductName(b.productId).toLowerCase();
                                        const ref = (b.stockJournalRefNo || b.voucherRefNo || b.refNo || b.salesRefNo || '').toLowerCase();
                                        const bNo = (b.bagNo || '').toLowerCase();
                                        return prodName.includes(search) || ref.includes(search) || bNo.includes(search);
                                    });

                                const finalDedupedOut = new Map();
                                filteredBagsList.forEach((rawBag, idx) => {
                                    const b = enrichWithSalesLink(rawBag);
                                    const bagId = String(b.id || '').trim();
                                    const bagNo = String(b.bagNo || '').replace(/^#/, '').trim().toUpperCase();
                                    const salesRef = String(b.salesRefNo || b.voucherRefNo || '').trim().toUpperCase();
                                    const dedupeKey = `${salesRef || 'NA'}|${bagNo || bagId || `IDX-${idx}`}`;
                                    if (!finalDedupedOut.has(dedupeKey)) {
                                        finalDedupedOut.set(dedupeKey, b);
                                    }
                                });
                                filteredBagsList = [...finalDedupedOut.values()];
                            } else {
                                filteredBagsList = subTabFilteredList
                                    .filter(b => !selectedReadyStockProductId || b.productId === selectedReadyStockProductId)
                                    .filter(b => {
                                        const search = searchTerm.toLowerCase();
                                        const prodName = getProductName(b.productId).toLowerCase();
                                        const ref = (b.stockJournalRefNo || b.voucherRefNo || b.refNo || '').toLowerCase();
                                        const bNo = (b.bagNo || '').toLowerCase();
                                        return prodName.includes(search) || ref.includes(search) || bNo.includes(search);
                                    });
                            }

                            // Apply sorting
                            filteredBagsList = filteredBagsList.sort((a, b) => {
                                if (!sortConfig.key) return 0;
                                let aVal, bVal;
                                
                                if (sortConfig.key === 'date') {
                                    const aDate = readyStockSubTab === 'out' ? (a.soldDate || a.date) : a.date;
                                    const bDate = readyStockSubTab === 'out' ? (b.soldDate || b.date) : b.date;
                                    aVal = new Date(aDate || 0);
                                    bVal = new Date(bDate || 0);
                                } else if (sortConfig.key === 'voucher') {
                                    aVal = (a.stockJournalRefNo || a.voucherRefNo || a.salesRefNo || '').toLowerCase();
                                    bVal = (b.stockJournalRefNo || b.voucherRefNo || b.salesRefNo || '').toLowerCase();
                                    } else if (sortConfig.key === 'voucherType') {
                                        aVal = getVoucherType(a).toLowerCase();
                                        bVal = getVoucherType(b).toLowerCase();
                                    } else if (sortConfig.key === 'bagNo') {
                                        aVal = (a.bagNo || '');
                                        bVal = (b.bagNo || '');
                                        return sortConfig.direction === 'asc' 
                                            ? aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' })
                                            : bVal.localeCompare(aVal, undefined, { numeric: true, sensitivity: 'base' });
                                    } else if (sortConfig.key === 'weight') {
                                        aVal = Number(a.qty || 0);
                                        bVal = Number(b.qty || 0);
                                    }

                                    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                                    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                                    return 0;
                                });

                            const totalWeight = filteredBagsList.reduce((acc, b) => acc + Number(b.qty || 0), 0);
                            const totalVoucherRefs = new Set(
                                filteredBagsList
                                    .map(b => readyStockSubTab === 'out'
                                        ? (b.salesRefNo || b.voucherRefNo || '')
                                        : (b.stockJournalRefNo || b.voucherRefNo || ''))
                                    .filter(Boolean)
                            ).size;

                            const getVoucherType = (bag) => {
                                if (readyStockSubTab === 'out') {
                                    if (bag.salesRefNo || bag.salesId) return 'SALE';
                                } else {
                                    if (bag.voucherRefNo || bag.stockJournalRefNo || bag.stockJournalId) return 'MFG';
                                    if (bag.purchaseRefNo || bag.purchaseId) return 'PURCHASE';
                                }
                                
                                // Fallbacks
                                if (bag.salesRefNo || bag.salesId) return 'SALE';
                                if (bag.voucherRefNo || bag.stockJournalRefNo || bag.stockJournalId) return 'MFG';
                                if (bag.purchaseRefNo || bag.purchaseId) return 'PURCHASE';
                                return 'MFG'; 
                            };

                            const SortIcon = ({ column }) => {
                                if (sortConfig.key !== column) return <span className="ml-1 opacity-20">↕</span>;
                                return sortConfig.direction === 'asc' ? <span className="ml-1 text-white">↑</span> : <span className="ml-1 text-white">↓</span>;
                            };

                             const getSummary = () => {
                                 const summaryMap = {};
                                 
                                 // Initialize with all products
                                 products.forEach(p => {
                                     summaryMap[p.id] = {
                                         productId: p.id,
                                         productName: p.name,
                                         totalIn: 0,
                                         totalInWeight: 0,
                                         totalOut: 0,
                                         totalOutWeight: 0,
                                         remaining: 0,
                                         remainingWeight: 0
                                     };
                                 });

                                 // Logic: IN Balance = Manufactured (productionBagsList)
                                 productionBagsList.forEach(b => {
                                     if (summaryMap[b.productId]) {
                                         if (!isBagReusable(b)) {
                                             summaryMap[b.productId].totalIn++;
                                         }
                                         summaryMap[b.productId].totalInWeight += Number(b.qty || 0);
                                     }
                                 });

                                 // Logic: Remaining Balance = unsold bags in this voucher/production list
                                 productionBagsList.forEach(b => {
                                     const isSold = isBagMarkedSold(b);
                                     if (!isSold && summaryMap[b.productId]) {
                                         if (!isBagReusable(b)) {
                                             summaryMap[b.productId].remaining++;
                                         }
                                         summaryMap[b.productId].remainingWeight += Number(b.qty || 0);
                                     }
                                 });

                                 // Logic: OUT Balance = sold bags from the IN pool
                                 Object.keys(summaryMap).forEach(pId => {
                                     summaryMap[pId].totalOut = Math.max(0, summaryMap[pId].totalIn - summaryMap[pId].remaining);
                                     summaryMap[pId].totalOutWeight = Math.max(0, summaryMap[pId].totalInWeight - summaryMap[pId].remainingWeight);
                                 });

                                 return Object.values(summaryMap).sort((a, b) => b.totalIn - a.totalIn);
                             };

                            return (
                                <div className="w-full h-full p-0">
                                    <div className="bg-white border-none shadow-none overflow-hidden flex flex-col h-full">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-[#1e3264] text-white">
                                                        <th className="px-6 py-2 w-fit">
                                                            {viewMode === 'detail' ? (
                                                                <div className="flex items-center gap-3">
                                                                    <button
                                                                        onClick={() => {
                                                                            setViewMode('summary');
                                                                            setSelectedReadyStockProductId('');
                                                                        }}
                                                                        className="bg-white/20 hover:bg-white/30 text-white text-[9px] font-black px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-2 border border-white/10 uppercase tracking-widest"
                                                                    >
                                                                        <Layers size={12} />
                                                                        STOCK WISE SUMMARY
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => requestSort('date')}
                                                                        className="text-[10px] font-black uppercase tracking-widest hover:text-blue-100 transition-colors"
                                                                    >
                                                                        DATE <SortIcon column="date" />
                                                                    </button>
                                                                    {selectedReadyStockProductId && (
                                                                        <button
                                                                            onClick={() => setSelectedReadyStockProductId('')}
                                                                            className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 text-[9px] font-black px-3 py-1.5 rounded-lg transition-all border border-emerald-300/30 uppercase tracking-widest"
                                                                            title="Clear product filter"
                                                                        >
                                                                            FILTER: {getProductName(selectedReadyStockProductId)} (CLEAR)
                                                                        </button>
                                                                    )}
                                                                    <div className="flex items-center bg-black/20 p-1 rounded-xl border border-white/5 shadow-inner">
                                                                        <button
                                                                            onClick={() => setReadyStockSubTab('in')}
                                                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${readyStockSubTab === 'in' ? 'bg-white text-[#1e3264] shadow-lg' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
                                                                        >
                                                                            BAGS IN
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setReadyStockSubTab('out')}
                                                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${readyStockSubTab === 'out' ? 'bg-white text-[#1e3264] shadow-lg' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
                                                                        >
                                                                            BAGS OUT
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setReadyStockSubTab('remaining')}
                                                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${readyStockSubTab === 'remaining' ? 'bg-white text-[#1e3264] shadow-lg' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
                                                                        >
                                                                            BAGS REMAINING
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <button 
                                                                    onClick={() => {
                                                                        if (viewMode === 'detail') {
                                                                            setViewMode('summary');
                                                                            setSelectedReadyStockProductId('');
                                                                        } else {
                                                                            setViewMode('detail');
                                                                        }
                                                                    }}
                                                                    className="bg-white/20 hover:bg-white/30 text-white text-[9px] font-black px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-2 border border-white/10 uppercase tracking-widest"
                                                                >
                                                                    <List size={12} />
                                                                    VIEW DETAILED
                                                                </button>
                                                            )}
                                                        </th>
                                                        {viewMode === 'detail' ? (
                                                            <>
                                                                <th 
                                                                    className="px-6 py-2 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                                    onClick={() => requestSort('bagNo')}
                                                                >
                                                                    <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter">{filteredBagsList.filter(b => !isBagReusable(b)).length}</div>
                                                                    BAGS <SortIcon column="bagNo" />
                                                                </th>
                                                                <th 
                                                                    className="px-6 py-2 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                                    onClick={() => requestSort('voucher')}
                                                                >
                                                                    {readyStockSubTab === 'in' && (
                                                                        <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter">
                                                                            {new Set(filteredBagsList.map(b => b.stockJournalRefNo || b.voucherRefNo).filter(Boolean)).size}
                                                                            <span className="text-[10px] ml-2 opacity-80 font-normal">MFG REFs</span>
                                                                        </div>
                                                                    )}
                                                                    {readyStockSubTab === 'out' && (
                                                                        <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter">
                                                                            {totalVoucherRefs}
                                                                            <span className="text-[10px] ml-2 opacity-80 font-normal">SALE REFs</span>
                                                                        </div>
                                                                    )}
                                                                    REF NO. <SortIcon column="voucher" />
                                                                </th>
                                                                <th
                                                                    className="px-6 py-2 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                                    onClick={() => requestSort('voucherType')}
                                                                >
                                                                    VCH TYPE <SortIcon column="voucherType" />
                                                                </th>
                                                                <th 
                                                                    className="px-6 py-2 text-right text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                                    onClick={() => requestSort('weight')}
                                                                >
                                                                    <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter">{formatWeight(totalWeight)}</div>
                                                                    WEIGHT (KG) <SortIcon column="weight" />
                                                                </th>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <th className="px-6 py-2 text-left text-[10px] font-black uppercase tracking-widest">
                                                                    PRODUCT NAME
                                                                </th>
                                                                <th className="px-6 py-2 text-center text-[10px] font-black uppercase tracking-widest">
                                                                    <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter text-center">
                                                                        {getSummary().reduce((acc, s) => acc + s.totalIn, 0)}
                                                                    </div>
                                                                    IN BAGS
                                                                </th>
                                                                <th className="px-6 py-2 text-center text-[10px] font-black uppercase tracking-widest text-red-300">
                                                                    <div className="text-red-300 mb-1 text-[26px] font-bold leading-tight tracking-tighter text-center">
                                                                        {getSummary().reduce((acc, s) => acc + s.totalOut, 0)}
                                                                    </div>
                                                                    OUT BAGS
                                                                </th>
                                                                <th className="px-6 py-2 text-right text-[10px] font-black uppercase tracking-widest text-emerald-300">
                                                                    <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter text-right">
                                                                        {getSummary().reduce((acc, s) => acc + s.remaining, 0)} BAGS
                                                                        <div className="text-[11px] opacity-80 mt-[-4px] font-mono">{formatWeight(getSummary().reduce((acc, s) => acc + s.remainingWeight, 0))} KG</div>
                                                                    </div>
                                                                    STOCK BALANCE (IN-OUT)
                                                                </th>
                                                            </>
                                                        )}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 text-xs">
                                                    {viewMode === 'detail' ? (
                                                        filteredBagsList.map((bag, i) => (
                                                            <tr key={`${bag.id}-${i}`} className={`h-[21px] ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-blue-50 transition-colors group`}>
                                                                <td className="px-6 py-0 font-mono text-[10px] text-slate-500 leading-none">
                                                                    {readyStockSubTab === 'out' ? bag.soldDate : bag.date}
                                                                </td>
                                                                <td className="px-6 py-0 leading-none">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-[9px] font-black border border-blue-100">
                                                                            #{bag.bagNo || 'N/A'}
                                                                        </span>
                                                                        {(bag.isReusable || bag.isRefill || bag.reusableBagId || reusableBags.some(rb => String(rb.bagNo || '').replace(/^#/, '').trim().toUpperCase() === String(bag.bagNo || '').replace(/^#/, '').trim().toUpperCase())) && (
                                                                            <span className="bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded text-[8px] font-black uppercase border border-teal-200 ml-1">
                                                                                REUSE BAG
                                                                            </span>
                                                                        )}
                                                                        <span className="text-[8px] font-bold text-slate-400 uppercase truncate max-w-[150px]">
                                                                            {getProductName(bag.productId)}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-0 font-bold text-[#1e3264] text-[10px] leading-none uppercase">
                                                                    {getBagRefNo(bag) === '-' && readyStockSubTab === 'in' ? (
                                                                        <div className="flex items-center justify-between w-full">
                                                                            <span className="text-red-500 bg-red-50 border border-red-200 px-2 py-0.5 rounded font-black text-[9px] uppercase tracking-widest truncate">
                                                                                ORPHAN BAG
                                                                            </span>
                                                                            <button 
                                                                                onClick={(e) => { 
                                                                                    e.stopPropagation(); 
                                                                                    alert("Trash icon clicked for bag: " + (bag.bagNo || 'Unknown'));
                                                                                    handleDeleteOrphanBag(bag); 
                                                                                }} 
                                                                                className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors ml-2"
                                                                                title="Delete Orphan Bag"
                                                                            >
                                                                                <Trash2 size={12} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center justify-between w-full">
                                                                            <span className="truncate">{getBagRefNo(bag)}</span>
                                                                            {readyStockSubTab === 'in' && getBagRefNo(bag) !== '-' && (
                                                                                <button 
                                                                                    onClick={(e) => { 
                                                                                        e.stopPropagation(); 
                                                                                        alert("❌ Cannot delete this bag directly! It has a parent voucher. You must delete the parent voucher directly to remove this bag."); 
                                                                                    }} 
                                                                                    className="text-slate-300 hover:text-slate-400 p-1 transition-colors cursor-not-allowed ml-2"
                                                                                    title="Cannot delete directly. Has parent voucher."
                                                                                >
                                                                                    <Trash2 size={12} />
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-0 font-bold text-[10px] leading-none uppercase text-slate-600">
                                                                    {getVoucherType(bag)}
                                                                </td>
                                                                <td className="px-6 py-0 text-right font-mono font-black text-[#1e3264] text-[10px] leading-none">
                                                                    {formatWeight(bag.qty)}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    ) : (
                                                        getSummary().map((s, i) => (
                                                            <tr
                                                                key={s.productId}
                                                                onClick={() => {
                                                                    setSelectedReadyStockProductId(s.productId);
                                                                    setReadyStockSubTab('remaining');
                                                                    setViewMode('detail');
                                                                }}
                                                                className={`h-[40px] ${i % 2 === 0 ? 'bg-white' : 'bg-blue-50/10'} hover:bg-blue-50 transition-colors group text-[11px] cursor-pointer`}
                                                                title={`View remaining bags details for ${getProductName(s.productId)}`}
                                                            >
                                                                <td className="px-6 py-0 font-black text-slate-400 text-[10px] italic">{i + 1}</td>
                                                                <td className="px-6 py-0">
                                                                    <div className="font-black text-slate-700 uppercase tracking-tight">
                                                                        {getProductName(s.productId)}
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-0 text-center">
                                                                    <div className="flex flex-col items-center">
                                                                        <span className="text-[12px] font-black text-slate-400">{s.totalIn}</span>
                                                                        <span className="text-[8px] font-bold text-slate-300 uppercase leading-none">{formatWeight(s.totalInWeight)} KG</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-0 text-center">
                                                                    <div className="flex flex-col items-center">
                                                                        <span className="text-[12px] font-black text-red-400">{s.totalOut}</span>
                                                                        <span className="text-[8px] font-bold text-red-300 uppercase leading-none">{formatWeight(s.totalOutWeight)} KG</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-0 text-right">
                                                                    <div className="flex flex-col items-end">
                                                                        <span className="px-3 py-0.5 rounded bg-emerald-600 text-white text-[13px] font-black shadow-sm mb-0.5">
                                                                            {s.remaining} BAGS
                                                                        </span>
                                                                        <div className="text-[11px] font-black text-emerald-700 font-mono">
                                                                            {formatWeight(s.remainingWeight)} <span className="text-[8px] opacity-60 ml-0.5 uppercase">KG</span>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                    {filteredBagsList.length === 0 && (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-20 text-center">
                                                                <Clock size={40} className="mx-auto text-slate-300 mb-4" />
                                                                <div className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                                                                    {searchTerm ? 'No stock matches your search' : 'No Jumbo Bags in Stock'}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            );
                        })() : viewingDetail === 'manuf_reg' ? (() => {
                            // Logic for MANUFACTURING REGISTER
                            const sortedJournals = [...stockJournals]
                                .filter(sj => {
                                    const search = searchTerm.toLowerCase();
                                    const ref = (sj.refNo || '').toLowerCase();
                                    const prodItems = (sj.produced || []).map(p => getProductName(p.productId).toLowerCase()).join(' ');
                                    return ref.includes(search) || prodItems.includes(search);
                                })
                                .sort((a, b) => {
                                    if (!sortConfig.key) return 0;
                                    let aVal, bVal;

                                    if (sortConfig.key === 'date') {
                                        aVal = new Date(a.date || 0);
                                        bVal = new Date(b.date || 0);
                                    } else if (sortConfig.key === 'voucher') {
                                        aVal = (a.refNo || '');
                                        bVal = (b.refNo || '');
                                        return sortConfig.direction === 'asc' 
                                            ? aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' })
                                            : bVal.localeCompare(aVal, undefined, { numeric: true, sensitivity: 'base' });
                                    } else if (sortConfig.key === 'bagsCount') {
                                        aVal = getBagsForVoucher(a).filter(b => !isBagReusable(b)).length;
                                        bVal = getBagsForVoucher(b).filter(b => !isBagReusable(b)).length;
                                    } else if (sortConfig.key === 'weight') {
                                        aVal = (a.produced || []).reduce((sum, p) => sum + Number(p.quantity || 0), 0);
                                        bVal = (b.produced || []).reduce((sum, p) => sum + Number(p.quantity || 0), 0);
                                    }

                                    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                                    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                                    return 0;
                                });

                            const totalVouchersCount = sortedJournals.length;
                            const totalWeightProduced = sortedJournals.reduce((acc, sj) => {
                                const producedWt = (sj.produced || []).reduce((sum, p) => sum + Number(p.quantity || 0), 0);
                                return acc + producedWt;
                            }, 0);
                            const totalBagsProduced = sortedJournals.reduce((acc, sj) => acc + getBagsForVoucher(sj).filter(b => !isBagReusable(b)).length, 0);

                            const SortIcon = ({ column }) => {
                                if (sortConfig.key !== column) return <span className="ml-1 opacity-20">↕</span>;
                                return sortConfig.direction === 'asc' ? <span className="ml-1 text-white">↑</span> : <span className="ml-1 text-white">↓</span>;
                            };

                            return (
                                <div className="w-full h-full p-0 flex flex-col">
                                    <div className="bg-white border-none shadow-none overflow-hidden flex flex-col h-full">
                                        <div className="overflow-x-auto flex-1">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-[#1e3264] text-white select-none">
                                                        <th 
                                                            className="px-6 py-4 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                            onClick={() => requestSort('date')}
                                                        >
                                                            Date <SortIcon column="date" />
                                                        </th>
                                                        <th 
                                                            className="px-6 py-4 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                            onClick={() => requestSort('voucher')}
                                                        >
                                                            Voucher No. (Ref) <SortIcon column="voucher" />
                                                        </th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Produced Products</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Consumed Materials</th>
                                                        <th 
                                                            className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                            onClick={() => requestSort('bagsCount')}
                                                        >
                                                            <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter text-center">{totalBagsProduced}</div>
                                                            Jumbo Bags <SortIcon column="bagsCount" />
                                                        </th>
                                                        <th 
                                                            className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-[#2b458a] transition-colors"
                                                            onClick={() => requestSort('weight')}
                                                        >
                                                            <div className="text-white mb-1 text-[26px] font-bold leading-tight tracking-tighter text-right">{formatWeight(totalWeightProduced)}</div>
                                                            Weight Produced (KG) <SortIcon column="weight" />
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 text-xs">
                                                    {sortedJournals.map((sj, idx) => {
                                                        const producedWt = (sj.produced || []).reduce((sum, p) => sum + Number(p.quantity || 0), 0);
                                                        const mfgBags = getBagsForVoucher(sj).filter(b => !isBagReusable(b));
                                                        const isExpanded = expandedVchId === sj.id;
                                                        
                                                        return (
                                                            <React.Fragment key={sj.id || idx}>
                                                                <tr 
                                                                    onClick={() => setExpandedVchId(isExpanded ? null : sj.id)}
                                                                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                                                                >
                                                                    <td className="px-6 py-3 text-[11px] font-bold text-slate-500">{normalizeDate(sj.date)}</td>
                                                                    <td className="px-6 py-3 text-[11px] font-black text-[#1e3264] uppercase tracking-tight">{sj.refNo || 'N/A'}</td>
                                                                    <td className="px-6 py-3">
                                                                        <div className="flex flex-col gap-0.5">
                                                                            {(sj.produced || []).map((p, i) => (
                                                                                <span key={i} className="font-black text-slate-700">
                                                                                    {getProductName(p.productId)} ({formatWeight(p.quantity)} units)
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-3">
                                                                        <div className="flex flex-col gap-0.5 opacity-80">
                                                                            {(sj.consumed || []).map((c, i) => (
                                                                                <span key={i} className="text-slate-500 font-medium">
                                                                                    {getProductName(c.productId)} ({formatWeight(c.quantity)} units)
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                                        {mfgBags.length > 0 ? (
                                                                            <button 
                                                                                onClick={() => setViewBagListVch(sj)}
                                                                                className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-[9px] font-black border border-blue-100 hover:bg-blue-100 uppercase transition-colors"
                                                                            >
                                                                                {mfgBags.length} Bags
                                                                            </button>
                                                                        ) : (
                                                                            <span className="text-slate-400 text-[10px] font-bold">-</span>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-6 py-3 text-right text-[12px] font-black text-slate-900">{formatWeight(producedWt)}</td>
                                                                </tr>
                                                                
                                                                {isExpanded && (
                                                                    <tr className="bg-slate-50/50">
                                                                        <td colSpan="6" className="px-8 py-4 border-l-4 border-blue-500">
                                                                            <div className="flex flex-col gap-3">
                                                                                <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                                                                                    Voucher Bag Association Details
                                                                                </div>
                                                                                {mfgBags.length > 0 ? (
                                                                                    <div className="flex flex-wrap gap-2">
                                                                                        {mfgBags.map((bag, bIdx) => (
                                                                                            <div key={bIdx} className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm">
                                                                                                <span className="bg-blue-100 text-blue-800 text-[8px] font-black px-1.5 py-0.5 rounded">
                                                                                                    #{bag.bagNo || 'N/A'}
                                                                                                </span>
                                                                                                <span className="text-[10px] font-bold text-slate-700">
                                                                                                    {getProductName(bag.productId)}
                                                                                                </span>
                                                                                                <span className="text-[10px] font-black text-[#1e3264]">
                                                                                                    {formatWeight(bag.qty)} KG
                                                                                                </span>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="text-[10px] text-slate-400 font-bold uppercase italic">
                                                                                        No raw bags individually serialized in this voucher.
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                    {sortedJournals.length === 0 && (
                                                        <tr>
                                                            <td colSpan="6" className="px-6 py-20 text-center text-slate-400 font-bold uppercase tracking-widest italic">
                                                                No Manufacturing Journals Found for this period
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                                <tfoot className="bg-slate-50 sticky bottom-0 border-t border-slate-200">
                                                     <tr>
                                                         <td colSpan="5" className="px-6 py-4 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                                             Total Weight Manufactured ({totalVouchersCount} Vouchers):
                                                         </td>
                                                         <td className="px-6 py-4 text-right text-[16px] font-black text-[#1e3264]">{formatWeight(totalWeightProduced)}</td>
                                                     </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            );
                        })() : viewingDetail === 'reusable_bags' ? (() => {
                            const filteredReusable = reusableBags.filter(rb => {
                                const search = searchTerm.toLowerCase();
                                return (rb.bagNo || '').toLowerCase().includes(search);
                            }).sort((a, b) => (a.bagNo || '').localeCompare(b.bagNo || '', undefined, { numeric: true }));

                            return (
                                <div className="w-full h-full p-6 flex flex-col gap-4">
                                    {/* Header row with button */}
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <h3 className="text-base font-black text-[#1e3264] uppercase tracking-tight flex items-center gap-2">
                                                <Recycle size={18} className="text-teal-500" />
                                                Reusable Jumbo Bags Registry
                                            </h3>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                                Bags approved for multiple reuses — select in manufacturing allocation
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setShowMakeReusableModal(true)}
                                            className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-black rounded-xl shadow-lg shadow-teal-600/20 active:scale-95 transition-all uppercase tracking-widest"
                                        >
                                            <Plus size={15} />
                                            Make Reusable Bags
                                        </button>
                                    </div>

                                    {/* Table */}
                                    <div className="bg-white rounded-2xl shadow-md overflow-hidden flex-1">
                                        <div className="overflow-x-auto h-full">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-teal-800 text-white">
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">#</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Bag Number</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-right">Weight (KG)</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Allowed to Reuse in Jumbo Bag Allocation?</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Status</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Start Date</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Last Date</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-center">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {filteredReusable.map((rb, idx) => (
                                                        <tr key={rb.id} className="hover:bg-slate-50/80 transition-colors">
                                                            <td className="px-6 py-3 text-[11px] font-bold text-slate-400">{idx + 1}</td>
                                                            <td className="px-6 py-3">
                                                                <button
                                                                    onClick={() => setSelectedReusableBag(rb)}
                                                                    className="bg-teal-50 text-teal-700 px-3 py-1 rounded-full text-[11px] font-black border border-teal-100 uppercase tracking-tighter hover:bg-teal-100 transition-colors cursor-pointer underline decoration-dotted underline-offset-2"
                                                                    title="Open reuse history"
                                                                >
                                                                    #{rb.bagNo}
                                                                </button>
                                                            </td>
                                                            <td className="px-6 py-3 text-right text-[11px] font-black text-slate-700">
                                                                {formatWeight(
                                                                    Number(rb.totalWeight || 0) ||
                                                                    (Array.isArray(rb.usageHistory)
                                                                        ? rb.usageHistory.reduce((s, h) => s + Number(h.qty || 0), 0)
                                                                        : 0)
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-3 text-[11px] font-bold">
                                                                {rb.status === 'active'
                                                                    ? <span className="text-emerald-600 flex items-center gap-1"><Check size={13} /> YES — Active &amp; Refillable</span>
                                                                    : <span className="text-slate-400 flex items-center gap-1"><X size={13} /> NO — Closed</span>
                                                                }
                                                            </td>
                                                            <td className="px-6 py-3">
                                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter border ${rb.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                                                    {rb.status === 'active' ? 'Active' : 'Closed'}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-3 text-[11px] font-bold text-slate-500">{rb.startDate || '—'}</td>
                                                            <td className="px-6 py-3 text-[11px] font-bold text-slate-500">{rb.lastDate || '—'}</td>
                                                            <td className="px-6 py-3 text-center">
                                                                <button
                                                                    onClick={() => handleToggleReusableStatus(rb)}
                                                                    className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${rb.status === 'active' ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100'}`}
                                                                >
                                                                    {rb.status === 'active' ? 'Close' : 'Reactivate'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {filteredReusable.length === 0 && (
                                                        <tr>
                                                            <td colSpan="8" className="px-6 py-20 text-center text-slate-400 font-bold uppercase tracking-widest italic">
                                                                No reusable bags registered yet.
                                                                <br/>
                                                                <span className="text-[10px] opacity-60">Click "Make Reusable Bags" to add one.</span>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                                <tfoot className="bg-slate-50 sticky bottom-0 border-t-2 border-slate-200">
                                                    <tr>
                                                        <td colSpan="4" className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                                            {reusableBags.filter(rb => rb.status === 'active').length} Active &nbsp;·&nbsp; {reusableBags.filter(rb => rb.status === 'closed').length} Closed &nbsp;·&nbsp; {reusableBags.length} Total
                                                        </td>
                                                        <td colSpan="4" className="px-6 py-4 text-right text-[10px] font-black text-teal-700 uppercase tracking-widest">
                                                            Total Reusable Weight: {formatWeight(reusableBags.reduce((s, rb) => {
                                                                const fallback = Array.isArray(rb.usageHistory)
                                                                    ? rb.usageHistory.reduce((t, h) => t + Number(h.qty || 0), 0)
                                                                    : 0;
                                                                return s + (Number(rb.totalWeight || 0) || fallback);
                                                            }, 0))} KG
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            );
                        })() : null}

                        {/* Reusable Bag History Popup */}
                        {selectedReusableBag && (
                            <div className="fixed inset-0 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" style={{ zIndex: zIndex + 20 }}>
                                <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                                    <div className="bg-gradient-to-r from-teal-500 to-cyan-600 px-6 py-4 flex items-center justify-between text-white">
                                        <div>
                                            <div className="text-white font-black uppercase text-sm tracking-tight">
                                                Reusable Bag Details: #{selectedReusableBag.bagNo}
                                            </div>
                                            <div className="text-white/70 text-[10px] font-bold uppercase tracking-widest mt-0.5">
                                                Filled {selectedReusableBag.refillCount || (selectedReusableBag.usageHistory || []).reduce((s, h) => s + Number(h.fillCount || 1), 0)} time(s)
                                            </div>
                                        </div>
                                        <button onClick={() => setSelectedReusableBag(null)} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all">
                                            <X size={18} />
                                        </button>
                                    </div>
                                    <div className="max-h-[520px] overflow-y-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-slate-50 sticky top-0">
                                                <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-100">
                                                    <th className="px-6 py-3">#</th>
                                                    <th className="px-6 py-3">Date</th>
                                                    <th className="px-6 py-3">Manufacturing Ref No.</th>
                                                    <th className="px-6 py-3">Item Name</th>
                                                    <th className="px-6 py-3 text-right">Qty</th>
                                                    <th className="px-6 py-3 text-center">Fills</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {((selectedReusableBag.usageHistory || [])
                                                    .slice()
                                                    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
                                                ).map((h, idx) => (
                                                    <tr key={`${selectedReusableBag.id}-h-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                                                        <td className="px-6 py-3 text-[11px] font-bold text-slate-400">{idx + 1}</td>
                                                        <td className="px-6 py-3 text-[11px] font-bold text-slate-600">{h.date || '-'}</td>
                                                        <td className="px-6 py-3">
                                                            <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 text-[10px] font-black uppercase tracking-wider">
                                                                {h.manufacturingRefNo || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-3 text-[11px] font-bold text-slate-700">
                                                            {(() => {
                                                                if (Array.isArray(h.productNames) && h.productNames.length > 0) return h.productNames.join(', ');
                                                                if (Array.isArray(h.productIds) && h.productIds.length > 0) {
                                                                    return h.productIds.map(pid => getProductName(pid)).join(', ');
                                                                }
                                                                if (h.itemName) return h.itemName;
                                                                return '-';
                                                            })()}
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-[11px] font-black text-slate-700">{formatWeight(h.qty || 0)}</td>
                                                        <td className="px-6 py-3 text-center text-[11px] font-black text-emerald-700">{h.fillCount || 1}</td>
                                                    </tr>
                                                ))}
                                                {(selectedReusableBag.usageHistory || []).length === 0 && (
                                                    <tr>
                                                        <td colSpan="6" className="px-6 py-20 text-center text-slate-400 font-bold uppercase tracking-widest italic">
                                                            No reuse history yet for this reusable bag.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-between items-center">
                                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                            Last Ref: {selectedReusableBag.lastRefNo || '-'} · Last Date: {selectedReusableBag.lastDate || '-'}
                                        </div>
                                        <button onClick={() => setSelectedReusableBag(null)} className="px-6 py-2 bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-teal-900/20 active:scale-95 transition-all">
                                            Close
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* BAG LIST SUB-MODAL */}
                        {viewBagListVch && (
                            <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                                <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                                    <div className="bg-[#1e3264] px-6 py-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white">
                                                <Box size={20} />
                                            </div>
                                            <div>
                                                <div className="text-white font-black uppercase text-sm tracking-tight">Jumbo Bag Breakdown</div>
                                                <div className="text-white/60 text-[10px] font-bold uppercase tracking-widest">Voucher: {viewBagListVch.refNo}</div>
                                            </div>
                                        </div>
                                        <button onClick={() => setViewBagListVch(null)} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all">
                                            <X size={18} />
                                        </button>
                                    </div>
                                    <div className="max-h-[500px] overflow-y-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-slate-50 sticky top-0">
                                                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                                    <th className="px-6 py-3">Bag Number</th>
                                                    <th className="px-6 py-3">Item / Product</th>
                                                    <th className="px-6 py-3 text-right">Weight (kg)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {getBagsForVoucher(viewBagListVch).map((bag, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                                            <td className="px-6 py-3">
                                                                <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg text-[11px] font-black border border-blue-100">
                                                                    #{bag.bagNo}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-3 text-[11px] font-bold text-slate-700">
                                                                {getProductName(bag.productId)}
                                                            </td>
                                                            <td className="px-6 py-3 text-right font-mono font-black text-[#1e3264]">
                                                                {formatWeight(bag.qty)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-between items-center">
                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            Total Bags: {getBagsForVoucher(viewBagListVch).length}
                                        </div>

                                        <button onClick={() => setViewBagListVch(null)} className="px-6 py-2 bg-[#1e3264] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/20 active:scale-95 transition-all">
                                            Close Breakdown
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {/* ===================== MAKE REUSABLE BAG MODAL ===================== */}
            {showMakeReusableModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-black text-[#1e3264] uppercase tracking-tight flex items-center gap-2">
                                <Recycle size={18} className="text-teal-500" />
                                Issue New Reusable Bag
                            </h3>
                            <button onClick={() => setShowMakeReusableModal(false)} className="text-slate-400 hover:text-red-500 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Bag Number</label>
                            <input
                                type="text"
                                value={newReusableBagNo}
                                onChange={e => setNewReusableBagNo(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSaveReusableBag()}
                                placeholder="e.g. R-001 or A500"
                                autoFocus
                                className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#1e3264] focus:outline-none focus:border-teal-400 uppercase"
                            />
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setShowMakeReusableModal(false)} className="px-4 py-2 text-slate-500 font-bold text-sm rounded-xl hover:bg-slate-100">Cancel</button>
                            <button
                                onClick={handleSaveReusableBag}
                                disabled={savingReusable || !newReusableBagNo.trim()}
                                className="px-6 py-2 bg-teal-600 text-white font-black text-sm rounded-xl hover:bg-teal-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {savingReusable ? 'Saving...' : <><Plus size={14} /> Save</> }
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Custom Prompt Modal for Orphan Bag Deletion inside Deep Analysis */}
            {deleteBagPrompt && (
                <div className="fixed inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-200" style={{ zIndex: 999999 }}>
                    <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 border border-slate-200 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4 text-red-600">
                            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                                <Trash2 size={20} />
                            </div>
                            <h3 className="font-black text-[14px] uppercase tracking-tight">Delete Orphan Bag</h3>
                        </div>
                        <p className="text-[12px] font-bold text-slate-500 mb-2">
                            Bag No: <span className="text-slate-800">{deleteBagPrompt.bagNo}</span>
                        </p>
                        <p className="text-[11px] font-medium text-slate-500 mb-6 leading-relaxed">
                            This action cannot be undone. Enter password to confirm removal.
                        </p>
                        {/* Fake inputs to stop Chrome from autofilling the search bar with email */}
                        <input type="text" name="fakeusernameremembered" style={{ display: 'none' }} aria-hidden="true" autoComplete="username" />
                        <input type="password" name="fakepasswordremembered" style={{ display: 'none' }} aria-hidden="true" autoComplete="current-password" />
                        
                        <input
                            type="password"
                            placeholder="Enter password..."
                            className="w-full px-4 py-2 border-2 border-slate-200 rounded-xl mb-6 text-[14px] font-bold outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100 transition-all"
                            value={deletePassword}
                            onChange={(e) => setDeletePassword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && confirmDeleteOrphanBag()}
                            autoFocus
                        />
                        <div className="flex items-center gap-3 justify-end">
                            <button
                                onClick={(e) => { e.stopPropagation(); setDeleteBagPrompt(null); setDeletePassword(''); }}
                                className="px-5 py-2 rounded-xl text-[11px] font-black uppercase text-slate-500 hover:bg-slate-100 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); confirmDeleteOrphanBag(); }}
                                className="px-5 py-2 rounded-xl text-[11px] font-black uppercase bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-200 transition-all active:scale-95"
                            >
                                Confirm Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </>
        );
    }

    const tabs = [
        { id: 'jumbo_bags', label: 'Jumbo Bags Allocated Inventory', icon: <Box size={16} />, status: 'Coming Soon' },
        { id: 'other_reports', label: 'Other Packaging Reports', icon: <Archive size={16} />, status: 'Coming Soon' },
        { id: 'stock_summary', label: 'Packaging Stock Summary', icon: <Layers size={16} />, status: 'Coming Soon' },
        { id: 'consumption', label: 'Consumption Analysis', icon: <TrendingUp size={16} />, status: 'Coming Soon' }
    ];

    return (
        <div 
            className="fixed inset-0 flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-300"
            style={{ zIndex, backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)' }}
        >
            <div className="bg-[#f8fafc] w-full max-w-6xl h-full max-h-[850px] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
                
                {/* Header Section */}
                <div className="bg-white px-8 py-6 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1e3264] to-[#2b5797] flex items-center justify-center text-white shadow-xl shadow-blue-900/20">
                            <Package size={28} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-[#1e3264] uppercase tracking-tighter leading-tight italic">
                                Packaging Smart Report
                            </h2>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] mt-1">
                                Advanced Packaging & Inventory Intelligence
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="hidden md:flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                            <span className="text-[10px] font-black text-slate-500 uppercase">Live Intelligence Engine</span>
                        </div>
                        <button 
                            onClick={onClose}
                            className="w-10 h-10 rounded-full hover:bg-red-50 hover:text-red-500 text-slate-400 flex items-center justify-center transition-all active:scale-90"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="px-8 bg-white border-b border-slate-200 overflow-x-auto custom-scrollbar">
                    <div className="flex items-center gap-2">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    flex items-center gap-3 px-6 py-5 text-[11px] font-black uppercase tracking-widest transition-all relative whitespace-nowrap
                                    ${activeTab === tab.id ? 'text-[#1e3264]' : 'text-slate-400 hover:text-slate-600'}
                                `}
                            >
                                {tab.icon}
                                {tab.label}
                                {activeTab === tab.id && (
                                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#1e3264] rounded-t-full shadow-[0_-4px_10px_rgba(30,50,100,0.3)]"></div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto p-10 bg-slate-50/50">
                    <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto">
                        <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mb-8 animate-bounce">
                            <Clock size={48} />
                        </div>
                        <h3 className="text-3xl font-black text-[#1e3264] mb-4">Module Under Development</h3>
                        <p className="text-slate-500 font-medium leading-relaxed mb-10">
                            We are currently building this high-performance intelligence engine. This section will feature advanced 
                            real-time tracking, lot-wise allocation, and predictive consumption analytics for your packaging materials.
                        </p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                            <button 
                                onClick={() => setIsDeepAnalysing(true)}
                                className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center text-center hover:shadow-xl hover:border-blue-500/50 transition-all group"
                            >
                                <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600 mb-4 group-hover:scale-110 transition-transform">
                                    <FileSearch size={24} />
                                </div>
                                <div className="text-[12px] font-black text-[#1e3264] uppercase mb-2">Deep Tracking Analysis</div>
                                <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">
                                    Trace every bag from procurement to final shipping with surgical precision.
                                </p>
                            </button>
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center text-center">
                                <div className="p-3 bg-amber-50 rounded-xl text-amber-600 mb-4">
                                    <BarChart3 size={24} />
                                </div>
                                <div className="text-[12px] font-black text-[#1e3264] uppercase mb-2">Pro Analytics</div>
                                <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">
                                    Visual dashboards for waste reduction and cost optimization.
                                </p>
                            </div>
                        </div>

                        <div className="mt-12 flex items-center gap-3 px-6 py-3 bg-[#1e3264] text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-xl shadow-blue-900/30">
                            <AlertCircle size={14} className="text-blue-300" />
                            Expected Release: Version 2.7.0
                        </div>
                    </div>
                </div>

                {/* Footer Toolbar */}
                <div className="bg-white px-8 py-5 border-t border-slate-200 flex items-center justify-between text-slate-400">
                    <div className="text-[10px] font-black uppercase tracking-widest flex items-center gap-3">
                        <Info size={14} />
                        Accpro Intelligence Framework V2.6.5
                    </div>
                    <div className="flex gap-3">
                        <button disabled className="px-6 py-2.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest opacity-50 cursor-not-allowed">
                            <Printer size={14} className="inline mr-2" /> Print Preview
                        </button>
                        <button disabled className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest opacity-50 cursor-not-allowed shadow-lg">
                            <Download size={14} className="inline mr-2" /> Export Dataset
                        </button>
                    </div>
                </div>
                    {/* Custom Prompt Modal for Orphan Bag Deletion */}
                    {deleteBagPrompt && (
                        <div className="fixed inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-200" style={{ zIndex: 999999 }}>
                            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 border border-slate-200 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-3 mb-4 text-red-600">
                                    <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                                        <Trash2 size={20} />
                                    </div>
                                    <h3 className="font-black text-[14px] uppercase tracking-tight">Delete Orphan Bag</h3>
                                </div>
                                <p className="text-[12px] font-bold text-slate-500 mb-2">
                                    Bag No: <span className="text-slate-800">{deleteBagPrompt.bagNo}</span>
                                </p>
                                <p className="text-[11px] font-medium text-slate-500 mb-6 leading-relaxed">
                                    This action cannot be undone. Enter password to confirm removal.
                                </p>
                                {/* Fake inputs to stop Chrome from autofilling the search bar with email */}
                                <input type="text" name="fakeusernameremembered" style={{ display: 'none' }} aria-hidden="true" autoComplete="username" />
                                <input type="password" name="fakepasswordremembered" style={{ display: 'none' }} aria-hidden="true" autoComplete="current-password" />
                                
                                <input
                                    type="password"
                                    placeholder="Enter password..."
                                    className="w-full px-4 py-2 border-2 border-slate-200 rounded-xl mb-6 text-[14px] font-bold outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100 transition-all"
                                    value={deletePassword}
                                    onChange={(e) => setDeletePassword(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && confirmDeleteOrphanBag()}
                                    autoComplete="new-password"
                                    data-lpignore="true"
                                    autoFocus
                                />
                                <div className="flex items-center gap-3 justify-end">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setDeleteBagPrompt(null); setDeletePassword(''); }}
                                        className="px-5 py-2 rounded-xl text-[11px] font-black uppercase text-slate-500 hover:bg-slate-100 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); confirmDeleteOrphanBag(); }}
                                        className="px-5 py-2 rounded-xl text-[11px] font-black uppercase bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-200 transition-all active:scale-95"
                                    >
                                        Confirm Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
            </div>
        </div>
    );
};

export default PackagingSmartReportModal;
