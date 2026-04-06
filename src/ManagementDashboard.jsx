import React, { useState } from 'react';
import {
    LayoutDashboard, FileText, Settings, Database,
    BookOpen, BarChart3, Layers,
    Wrench, GraduationCap, X, User, Bell, Search,
    Briefcase, Archive, ShieldAlert, ShoppingBag, Zap, RefreshCw,
    DownloadCloud, UploadCloud, ShieldCheck, Key,
    BarChart2, History, Building2, Ruler, Coins, ReceiptText, MapPin,
    Users, Truck, PlusCircle, Trash, FileImage, Eye, Pencil, Edit3
} from 'lucide-react';
import { db, auth } from './firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';

import {
    collection, addDoc, serverTimestamp, query,
    where, onSnapshot, deleteDoc, doc, setDoc, getDoc
} from 'firebase/firestore';
import {
    generateInvoicePDF,
    generatePackingListPDF,
    generateBillOfExchangePDF,
    generateBankApplicationPDF
} from './invoiceGenerator';
import CustomersProfileModule from './CustomersProfileModule';

const ManagementDashboard = ({
    onClose,
    onRecalculateAll,
    onRecalculateStock,
    onRecalculateParties,
    onRecalculateAccounts,
    onRecalculateExpenses,
    onRecalculateCapital,
    onInstall,
    onBackup,
    onRestore,
    functions,
    dataOwnerId,
    onChangePassword,
    onManageUsers,
    onShowStatistics,
    onShowLogs,
    onManageCompany,
    onSelectCompany,
    onManageUnits,
    onManageCurrency,
    onManageTaxes,
    onManageLocations,
    onManageStaff,
    onManageImageStorage,
    onShowInvoiceSettings,
    onShowLotProfit,
    onShowFinancials,
    onShowProfile,
    onManageOrders,
    user,
    effectiveName,
    companyProfile,
    onUpdateProfile,
    onShowPaymentRegister,
    onShowReceiptRegister,
    onShowContraRegister,
    isInstallable,
    invoices,
    payments,
    journalVouchers,
    dashboardDate,
    currencySymbol,
    accounts,
    parties,
    expenses,
    incomeAccounts,
    stockJournals,
    products,
    vehicles,
    isRecalculating,
    currentRole
}) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [summarySubTab, setSummarySubTab] = useState('cashflow');
    const [rulesSubTab, setRulesSubTab] = useState('general');
    const [selectedSummaryProductId, setSelectedSummaryProductId] = useState('');
    const [summaryDateRange, setSummaryDateRange] = useState({
        from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0]
    });

    const [serialKeys, setSerialKeys] = useState([]);
    const [loadingKeys, setLoadingKeys] = useState(false);
    const [devSubTab, setDevSubTab] = useState('registry');
    const [genKey, setGenKey] = useState('');
    const [genStatus, setGenStatus] = useState('');
    const [genLoading, setGenLoading] = useState(false);
    const [approveLoadingId, setApproveLoadingId] = useState(null);
    const [approvalDaysMap, setApprovalDaysMap] = useState({}); // keyId -> days
    const [licenseFilter, setLicenseFilter] = useState('all');

    const FIREBASE_API_KEY = auth?.app?.options?.apiKey || 'AIzaSyAgTuSqvk5qGtP5bHBOXRL3CTar-Uw9F7I';
    const PROJECT_ID = 'cashshams';
    const BASE_LICENSE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

    const parseFirestoreValue = React.useCallback((value) => {
        if (!value) return null;
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
        if (value.doubleValue !== undefined) return Number(value.doubleValue);
        if (value.timestampValue !== undefined) return new Date(value.timestampValue);
        if (value.nullValue !== undefined) return null;
        if (value.arrayValue !== undefined) {
            const arr = value.arrayValue.values || [];
            return arr.map(parseFirestoreValue);
        }
        if (value.mapValue !== undefined) {
            const nested = value.mapValue.fields || {};
            return Object.fromEntries(Object.entries(nested).map(([k, v]) => [k, parseFirestoreValue(v)]));
        }
        return null;
    }, []);

    const firstString = (...values) => {
        for (const v of values) {
            if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return '';
    };

    const firstNumber = (...values) => {
        for (const v of values) {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string' && v.trim() !== '') {
                const n = Number(v);
                if (Number.isFinite(n)) return n;
            }
        }
        return null;
    };

    const formatStorage = (storageMb) => {
        if (storageMb === null || storageMb === undefined || !Number.isFinite(storageMb)) return '—';
        if (storageMb < 1024) return `${storageMb.toFixed(storageMb >= 100 ? 0 : 1)} MB`;
        const gb = storageMb / 1024;
        return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
    };

    const formatDeviceList = (devices = []) => {
        if (!devices.length) return '—';
        const [first, ...rest] = devices;
        if (rest.length === 0) return first;
        return `${first} +${rest.length}`;
    };

    const fetchAllLicenses = React.useCallback(async () => {
        setLoadingKeys(true);
        try {
            const url = `${BASE_LICENSE_URL}/nadtally_licenses?key=${FIREBASE_API_KEY}&pageSize=200`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const docs = (json.documents || []).map(d => {
                const f = d.fields || {};
                const parsed = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, parseFirestoreValue(v)]));
                const usage = parsed.usageStats || parsed.usage || parsed.metrics || {};
                const storageMbFromBytes = firstNumber(parsed.storageBytes, usage.storageBytes) !== null
                    ? firstNumber(parsed.storageBytes, usage.storageBytes) / (1024 * 1024)
                    : null;
                const storageMb = firstNumber(
                    parsed.storageMb,
                    parsed.storageMB,
                    parsed.storageUsedMb,
                    usage.storageMb,
                    usage.storageMB,
                    usage.storageUsedMb,
                    usage.storageUsed,
                    storageMbFromBytes
                );
                const deviceCandidates = [
                    parsed.deviceId,
                    parsed.currentDeviceId,
                    parsed.lastDeviceId,
                    parsed.deviceName,
                    ...(Array.isArray(parsed.deviceIds) ? parsed.deviceIds : []),
                    ...(Array.isArray(parsed.devices) ? parsed.devices : []),
                    ...(Array.isArray(usage.devices) ? usage.devices : []),
                ]
                    .map(v => (typeof v === 'string' ? v.trim() : ''))
                    .filter(Boolean);
                const devices = [...new Set(deviceCandidates)];

                return {
                    id: d.name.split('/').pop(),
                    serialKey: firstString(parsed.serialKey) || d.name.split('/').pop(),
                    email: firstString(parsed.email),
                    mobile: firstString(parsed.mobile),
                    userName: firstString(parsed.userName, parsed.ownerName, parsed.fullName),
                    status: firstString(parsed.status),
                    expiresAt: parsed.expiresAt,
                    activatedAt: parsed.activatedAt,
                    requestedAt: parsed.requestedAt,
                    deviceId: devices[0] || '',
                    deviceIds: devices,
                    version: firstString(parsed.version, parsed.appVersion, parsed.clientVersion, parsed.buildVersion) || '2.5.1',
                    liveCompaniesCount: firstNumber(parsed.liveCompaniesCount, parsed.companyCount, parsed.liveDataCount, usage.liveCompaniesCount),
                    usageReads: firstNumber(parsed.reads, parsed.readCount, usage.reads, usage.readCount, usage.firestoreReads),
                    usageWrites: firstNumber(parsed.writes, parsed.writeCount, usage.writes, usage.writeCount, usage.firestoreWrites),
                    usageStorageMb: storageMb,
                };
            });

            const liveRegistryByLicense = {};
            const liveRegistryByEmail = {};
            try {
                const liveUrl = `${BASE_LICENSE_URL}/nadtally_live_registry?key=${FIREBASE_API_KEY}&pageSize=500`;
                const liveRes = await fetch(liveUrl);
                if (liveRes.ok) {
                    const liveJson = await liveRes.json();
                    (liveJson.documents || []).forEach(docItem => {
                        const fields = docItem.fields || {};
                        const parsed = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseFirestoreValue(v)]));
                        const companyId = parsed.id || docItem.name.split('/').pop();
                        const licenseKey = firstString(parsed.licenseKey);
                        const email = firstString(parsed.ownerEmail).toLowerCase();
                        const device = firstString(parsed.deviceId);

                        if (licenseKey) {
                            if (!liveRegistryByLicense[licenseKey]) liveRegistryByLicense[licenseKey] = { companyIds: new Set(), devices: new Set() };
                            liveRegistryByLicense[licenseKey].companyIds.add(companyId);
                            if (device) liveRegistryByLicense[licenseKey].devices.add(device);
                        }
                        if (email) {
                            if (!liveRegistryByEmail[email]) liveRegistryByEmail[email] = { companyIds: new Set(), devices: new Set() };
                            liveRegistryByEmail[email].companyIds.add(companyId);
                            if (device) liveRegistryByEmail[email].devices.add(device);
                        }
                    });
                }
            } catch (liveErr) {
                console.warn('Live registry telemetry fetch skipped:', liveErr);
            }

            const merged = docs.map(item => {
                const byLicense = liveRegistryByLicense[item.serialKey];
                const byEmail = item.email ? liveRegistryByEmail[item.email.toLowerCase()] : null;
                const liveAggregate = byLicense || byEmail;
                const aggregateDevices = liveAggregate ? Array.from(liveAggregate.devices) : [];
                const mergedDevices = [...new Set([...(item.deviceIds || []), ...aggregateDevices])];

                return {
                    ...item,
                    deviceIds: mergedDevices,
                    deviceId: mergedDevices[0] || item.deviceId || '',
                    liveCompaniesCount: item.liveCompaniesCount ?? (liveAggregate ? liveAggregate.companyIds.size : null),
                };
            });

            setSerialKeys(merged);
        } catch (err) {
            console.error('Error fetching licenses via REST:', err);
        }
        setLoadingKeys(false);
    }, [BASE_LICENSE_URL, FIREBASE_API_KEY, parseFirestoreValue]);

    React.useEffect(() => {
        if (activeTab === 'developer_tools' && currentRole === 'developer') {
            fetchAllLicenses();
        }
    }, [activeTab, currentRole, fetchAllLicenses]);

    const generateNextSerialKey = async () => {
        setGenLoading(true);
        setGenStatus('');
        try {
            // Find the highest NDTL number from existing keys
            const ndtlKeys = serialKeys
                .map(k => k.id)
                .filter(id => /^NDTL\d+$/.test(id))
                .map(id => parseInt(id.replace('NDTL', '')))
                .sort((a, b) => a - b);
            const nextNum = ndtlKeys.length > 0 ? ndtlKeys[ndtlKeys.length - 1] + 1 : 111;
            const newKey = `NDTL${nextNum}`;

            // ✅ Get Firebase Auth ID token for authenticated REST write
            const currentUser = auth?.currentUser;
            if (!currentUser) throw new Error('Not authenticated. Please sign in as developer first.');

            const idToken = await currentUser.getIdToken(true); // true = force refresh

            const url = `${BASE_LICENSE_URL}/nadtally_licenses/${newKey}?key=${FIREBASE_API_KEY}`;
            const body = {
                fields: {
                    status: { stringValue: 'inactive' },
                    createdAt: { timestampValue: new Date().toISOString() },
                    createdBy: { stringValue: currentUser.email || 'developer' },
                    version: { stringValue: '2.5.1' },
                    isGenerated: { booleanValue: true },
                }
            };

            const res = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errText = await res.text();
                if (res.status === 403) {
                    const devEmail = currentUser.email || 'unknown-email';
                    throw new Error(`HTTP 403: Permission denied for ${devEmail}. Sign in with a developer account (users.role=developer) and redeploy Firestore rules.`);
                }
                throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
            }

            setGenKey(newKey);
            setGenStatus('success');

            // Fetch immediately + retry after 2s (Firebase REST can have propagation delay)
            await fetchAllLicenses();
            setTimeout(() => fetchAllLicenses(), 2000);
        } catch (err) {
            console.error('Generate key error:', err);
            setGenStatus('error: ' + err.message);
        }
        setGenLoading(false);
    };

    const handleLicenseAction = async (serialKeyId, action, days = 365) => {
        const actionLabels = { approve: 'Approve', reject: 'Reject', expire: 'Revoke', inactive: 'Deactivate' };
        if (!window.confirm(`${actionLabels[action] || action} license: ${serialKeyId}?`)) return;
        setApproveLoadingId(serialKeyId);
        try {
            // Use Auth token for proper permissions
            const currentUser = auth?.currentUser;
            const authHeaders = {};
            if (currentUser) {
                const idToken = await currentUser.getIdToken(true);
                authHeaders['Authorization'] = `Bearer ${idToken}`;
            }

            // ── STEP 1: If approving, first read the license to get email & create Firebase Auth user ──
            if (action === 'approve') {
                try {
                    const readUrl = `${BASE_LICENSE_URL}/nadtally_licenses/${serialKeyId}?key=${FIREBASE_API_KEY}`;
                    const readRes = await fetch(readUrl);
                    if (readRes.ok) {
                        const readJson = await readRes.json();
                        const f = readJson.fields || {};
                        const userEmail = f.email?.stringValue || '';
                        const rawPassword = f.rawPassword?.stringValue || ''; // stored if user submitted via new flow

                        if (userEmail) {
                            // Use a known default temp password if rawPassword is not stored
                            const tempPassword = rawPassword || '123456'; // user can change later
                            try {
                                // Try creating via Firebase Auth SDK
                                await createUserWithEmailAndPassword(auth, userEmail, tempPassword);
                                console.log(`[LicenseApprove] Firebase Auth user created for: ${userEmail}`);
                            } catch (authErr) {
                                if (authErr.code === 'auth/email-already-in-use') {
                                    console.log(`[LicenseApprove] Firebase Auth user already exists for: ${userEmail} — skipping creation.`);
                                } else {
                                    console.warn(`[LicenseApprove] Could not create Auth user for ${userEmail}: ${authErr.message}`);
                                    // Don't block — still approve in Firestore
                                }
                            }
                            // Also store the temp password in Firestore so user knows it
                            if (!rawPassword) {
                                // Patch tempPassword into the license doc for admin reference
                                const pwPatch = `${BASE_LICENSE_URL}/nadtally_licenses/${serialKeyId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=tempPassword`;
                                await fetch(pwPatch, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json', ...authHeaders },
                                    body: JSON.stringify({ fields: { tempPassword: { stringValue: tempPassword } } })
                                });
                            }
                        }
                    }
                } catch (readErr) {
                    console.warn('[LicenseApprove] Could not read license for Auth creation:', readErr.message);
                    // Don't block Firestore approval
                }
            }

            // ── STEP 2: Update Firestore license status ──
            const expiresAt = action === 'approve'
                ? new Date(Date.now() + days * 86400000).toISOString()
                : null;
            const fields = action === 'approve'
                ? { status: { stringValue: 'approved' }, expiresAt: { timestampValue: expiresAt }, activatedAt: { timestampValue: new Date().toISOString() }, approvedBy: { stringValue: currentUser?.email || 'developer' }, approvedAt: { timestampValue: new Date().toISOString() } }
                : action === 'reject'
                ? { status: { stringValue: 'rejected' }, rejectedBy: { stringValue: currentUser?.email || 'developer' }, rejectedAt: { timestampValue: new Date().toISOString() } }
                : action === 'expire'
                ? { status: { stringValue: 'expired' } }
                : { status: { stringValue: 'inactive' } };

            const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
            const url = `${BASE_LICENSE_URL}/nadtally_licenses/${serialKeyId}?key=${FIREBASE_API_KEY}&${fieldPaths}`;
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ fields })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await fetchAllLicenses();
            setTimeout(() => fetchAllLicenses(), 1500);

            if (action === 'approve') {
                alert(`✅ License ${serialKeyId} approved!\n\nFirebase Auth account has been created/verified.\n\nUser can now sign in using:\n• Email: (their registered email)\n• Password: 123456 (default — ask them to change it)`);
            }
        } catch (err) {
            alert('Action failed: ' + err.message);
        }
        setApproveLoadingId(null);
    };


    const [vehicleForm, setVehicleForm] = useState({
        vNo: '',
        city: '',
        company: '',
        category: 'our' // 'our' or 'outside'
    });
    const [isSavingVehicle, setIsSavingVehicle] = useState(false);
    const [editingDocId, setEditingDocId] = useState(null);
    const [editDocName, setEditDocName] = useState('');

    const handleSaveVehicle = async (e) => {
        e.preventDefault();
        if (!vehicleForm.vNo || !vehicleForm.city || !vehicleForm.company) {
            alert("Please fill all fields");
            return;
        }
        setIsSavingVehicle(true);
        try {
            await addDoc(collection(db, 'vehicles'), {
                ...vehicleForm,
                userId: dataOwnerId,
                createdAt: serverTimestamp(),
                createdBy: user.uid
            });
            setVehicleForm({ vNo: '', city: '', company: '', category: vehicleForm.category });
            alert("Vehicle saved successfully!");
        } catch (err) {
            console.error(err);
            alert("Error saving vehicle");
        } finally {
            setIsSavingVehicle(false);
        }
    };

    const handleDeleteVehicle = async (id) => {
        if (!window.confirm("Are you sure to delete this vehicle?")) return;
        try {
            await deleteDoc(doc(db, 'vehicles', id));
        } catch (err) {
            console.error(err);
            alert("Error deleting vehicle");
        }
    };

    // --- SUMMARY CALCULATIONS ---
    const getSummaryData = () => {
        const inRange = (d) => d >= summaryDateRange.from && d <= summaryDateRange.to;

        // 1. Payments
        const filteredPayments = payments?.filter(p => p.type === 'out' && inRange(p.date)) || [];
        const totalPaid = filteredPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
        const countPaid = filteredPayments.length;

        const paymentsByEntity = {};
        filteredPayments.forEach(p => {
            const addValue = (id, cat, amt) => {
                let name = "Unknown";
                if (cat === 'party') name = parties.find(x => x.id === id)?.name || "Unknown Customer";
                else if (cat === 'expense') name = expenses.find(x => x.id === id)?.name || "Unknown Expense";
                else if (cat === 'account') name = accounts.find(x => x.id === id)?.name || "Unknown Account";
                else if (cat === 'income') name = incomeAccounts.find(x => x.id === id)?.name || "Unknown Income";

                if (!paymentsByEntity[name]) paymentsByEntity[name] = 0;
                paymentsByEntity[name] += Number(amt || 0);
            };

            if (!p.isMulti) {
                const entityId = p.partyId || p.expenseId || p.toAccountId || p.capitalId || p.assetId || p.incomeId;
                addValue(entityId, p.transactionCategory, p.amount);
            } else if (p.splits) {
                p.splits.forEach(s => addValue(s.targetId, s.category, s.amount));
            }
        });

        // 2. Receipts
        const filteredReceipts = payments?.filter(p => p.type === 'in' && inRange(p.date)) || [];
        const totalReceived = filteredReceipts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
        const countReceived = filteredReceipts.length;

        const receiptsByEntity = {};
        const receivedByAccounts = {}; // Internal Cash/Bank receiving money
        filteredReceipts.forEach(p => {
            const addValue = (id, cat, amt) => {
                let name = "Unknown";
                if (cat === 'party') name = parties.find(x => x.id === id)?.name || "Unknown Customer";
                else if (cat === 'expense') name = expenses.find(x => x.id === id)?.name || "Unknown Expense";
                else if (cat === 'account') name = accounts.find(x => x.id === id)?.name || "Unknown Account";
                else if (cat === 'income') name = incomeAccounts.find(x => x.id === id)?.name || "Unknown Income";

                if (!receiptsByEntity[name]) receiptsByEntity[name] = 0;
                receiptsByEntity[name] += Number(amt || 0);
            };

            // Aggregate the internal account (the one receiving)
            const internalAccName = accounts.find(a => a.id === p.accountId)?.name || "Unknown Account";
            if (!receivedByAccounts[internalAccName]) receivedByAccounts[internalAccName] = 0;
            receivedByAccounts[internalAccName] += Number(p.amount || 0);

            if (!p.isMulti) {
                const entityId = p.partyId || p.expenseId || p.toAccountId || p.capitalId || p.assetId || p.incomeId;
                addValue(entityId, p.transactionCategory, p.amount);
            } else if (p.splits) {
                p.splits.forEach(s => addValue(s.targetId, s.category, s.amount));
            }
        });

        const paidFromAccounts = {}; // Internal Cash/Bank paying money
        filteredPayments.forEach(p => {
            // Aggregate the internal account (the one paying)
            const internalAccName = accounts.find(a => a.id === p.accountId)?.name || "Unknown Account";
            if (!paidFromAccounts[internalAccName]) paidFromAccounts[internalAccName] = 0;
            paidFromAccounts[internalAccName] += Number(p.amount || 0);
        });

        // 3. Items (Total Produced from stock journals)
        let totalQtyProduced = 0;
        let totalValProduced = 0;
        let countMfg = 0;
        stockJournals?.forEach(sj => {
            if (sj.produced && inRange(sj.date)) {
                countMfg++;
                sj.produced.forEach(item => {
                    totalQtyProduced += (Number(item.quantity) || 0);
                    totalValProduced += (Number(item.amount) || Number(item.quantity * item.rate) || 0);
                });
            }
        });

        // 4. Item Wise Analysis (specific selected item)
        const itemStats = { purchase: {}, sales: {}, totalPqty: 0, totalPval: 0, totalSqty: 0, totalSval: 0 };
        if (selectedSummaryProductId) {
            invoices?.filter(inv => inRange(inv.date)).forEach(inv => {
                inv.items?.forEach(item => {
                    if (item.productId === selectedSummaryProductId) {
                        const qty = Number(item.quantity) || 0;
                        const val = Number(item.amount) || (qty * (Number(item.rate) || 0));
                        const partyName = parties.find(p => p.id === inv.partyId)?.name || "Direct/Unknown";

                        if (inv.type === 'purchase') {
                            if (!itemStats.purchase[partyName]) itemStats.purchase[partyName] = { qty: 0, val: 0 };
                            itemStats.purchase[partyName].qty += qty;
                            itemStats.purchase[partyName].val += val;
                            itemStats.totalPqty += qty;
                            itemStats.totalPval += val;
                        } else if (inv.type === 'sales') {
                            if (!itemStats.sales[partyName]) itemStats.sales[partyName] = { qty: 0, val: 0 };
                            itemStats.sales[partyName].qty += qty;
                            itemStats.sales[partyName].val += val;
                            itemStats.totalSqty += qty;
                            itemStats.totalSval += val;
                        }
                    }
                });
            });
        }

        return {
            totalPaid, countPaid,
            totalReceived, countReceived,
            totalQtyProduced, totalValProduced, countMfg,
            paymentsByEntity, receiptsByEntity,
            receivedByAccounts, paidFromAccounts,
            itemStats
        };
    };

    const summary = getSummaryData();

    // Oracle-like TEAL/Dark Gradient Background
    const bgGradient = "bg-gradient-to-br from-[#0f4c5c] to-[#0a2e38]";

    const modules = [
        { id: 'infolets', name: 'Company Management Tools', icon: <LayoutDashboard className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'data', name: 'Data', icon: <Database className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'reports', name: 'Reports', icon: <FileText className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'summary_reports', name: 'Summarised Reports', icon: <Archive className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'charts', name: 'Charts & Graphs', icon: <BarChart3 className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'approvals', name: 'Approvals', icon: <Layers className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'rules', name: 'Rules', icon: <ShieldAlert className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'transport', name: 'Transport SECTION', icon: <Truck className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'staff', name: 'Staff and Team', icon: <Users className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'tools', name: 'Tools', icon: <Wrench className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'customers_profile', name: 'Customers Profile', icon: <User className="w-6 h-6 md:w-8 md:h-8 text-indigo-400" /> },
        { id: 'recalculate', name: 'Recalculate', icon: <Zap className="w-6 h-6 md:w-8 md:h-8" /> },
        { id: 'recalculate_new', name: 'Recalculate (New)', icon: <RefreshCw className="w-6 h-6 md:w-8 md:h-8 text-green-400" /> },
        { id: 'orders', name: 'Orders & Notes', icon: <ShoppingBag className="w-6 h-6 md:w-8 md:h-8" /> }
    ];

    if (currentRole === 'developer') {
        modules.push({ id: 'developer_tools', name: 'Dev Center', icon: <ShieldCheck className="w-6 h-6 md:w-8 md:h-8 text-red-500 animate-pulse" /> });
    }

    return (
        <div className={`fixed inset-0 z-[100] ${bgGradient} text-white font-sans flex flex-col`}>
            {/* HEADER */}
            <div className="h-12 bg-black/20 flex items-center justify-between px-4 backdrop-blur-sm">
                <div className="flex items-center gap-4 cursor-pointer hover:bg-white/10 px-2 py-1 rounded transition-colors" onClick={onClose}>
                    <button className="p-1 rounded"><LayoutDashboard size={20} /></button>
                    <div className="flex flex-col select-none">
                        <span className="nadtally-brand-styled text-xl leading-none">NADTALLY<span className="text-[10px] font-black ml-1 italic">v 2.5.1</span></span>
                        {companyProfile?.name && (
                            <span className="text-[10px] uppercase tracking-[0.2em] font-black text-white/40 mt-0.5 ml-0.5 truncate max-w-[150px]">
                                {companyProfile.name}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 md:gap-4">
                    <button className="hover:text-cyan-300"><Search size={18} /></button>
                    <button className="hover:text-cyan-300"><Bell size={18} /></button>
                    <div
                        className="flex items-center gap-2 cursor-pointer hover:bg-white/10 px-3 py-1.5 rounded-full transition-all active:scale-95"
                        onClick={onShowProfile}
                    >
                        <div className="w-8 h-8 md:w-9 md:h-9 bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-full flex items-center justify-center text-sm font-black shadow-lg border-2 border-white/20">
                            {(effectiveName || user?.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="hidden sm:flex flex-col text-left">
                            <span className="text-xs font-black truncate max-w-[100px] leading-tight text-white italic">
                                {effectiveName || 'Set Name'}
                            </span>
                            <span className="text-[9px] opacity-40 font-bold truncate max-w-[80px] leading-none uppercase tracking-tighter">
                                {user?.email?.split('@')[0]}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT SPLIT */}
            <div className="flex-1 flex overflow-hidden">



                {/* GRID AREA */}
                <div className="flex-1 p-4 md:p-10 overflow-y-auto">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                        <h1 className="text-2xl md:text-3xl font-light opacity-90">Management Dashboard</h1>
                    </div>

                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-x-2 md:gap-x-8 gap-y-6 md:gap-y-12">
                        {modules.map(mod => (
                            <div
                                key={mod.id}
                                className="group flex flex-col items-center gap-2 cursor-pointer"
                                onClick={() => setActiveTab(activeTab === mod.id ? 'dashboard' : mod.id)}
                            >
                                <div className={`w-14 h-14 md:w-20 md:h-20 rounded-lg md:rounded-xl border border-white/20 flex items-center justify-center bg-white/5 group-hover:bg-white/20 group-hover:scale-105 transition-all shadow-lg backdrop-blur-sm ${activeTab === mod.id ? 'bg-white/20 ring-2 ring-white/50' : ''}`}>
                                    <div className="opacity-80 group-hover:opacity-100 flex items-center justify-center">
                                        {mod.icon}
                                    </div>
                                </div>
                                <span className="text-[10px] md:text-sm font-medium tracking-wide opacity-80 group-hover:opacity-100 text-center leading-tight px-1">{mod.name}</span>
                            </div>
                        ))}
                    </div>

                    {/* CONTENT PREVIEW AREA */}
                    {activeTab === 'infolets' && (
                        <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><LayoutDashboard className="text-teal-400" /> Company Management Tools</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <ActionCard
                                    title="Manage Company"
                                    desc="Update company profile, logo, and contact info."
                                    onClick={onManageCompany}
                                    color="blue"
                                    icon={<Building2 />}
                                />
                                <ActionCard
                                    title="Select/Switch Company"
                                    desc="Pick or Change your working company (Tally Style)."
                                    onClick={onSelectCompany}
                                    color="emerald"
                                    icon={<Layers />}
                                />
                                <ActionCard
                                    title="Manage Units"
                                    desc="Define measure units like KGS, PCS, BAGS."
                                    onClick={onManageUnits}
                                    color="green"
                                    icon={<Ruler />}
                                />
                                <ActionCard
                                    title="Manage Currency"
                                    desc="Configure base currency and exchange rates."
                                    onClick={onManageCurrency}
                                    color="orange"
                                    icon={<Coins />}
                                />
                                <ActionCard
                                    title="Manage Taxes (VAT/GST)"
                                    desc="Set up tax slabs and VAT registration details."
                                    onClick={onManageTaxes}
                                    color="teal"
                                    icon={<ReceiptText />}
                                />
                                <ActionCard
                                    title="Locations"
                                    desc="Manage branch office and warehouse locations."
                                    onClick={onManageLocations}
                                    color="purple"
                                    icon={<MapPin />}
                                />
                                <ActionCard
                                    title="Image Files Storage"
                                    desc="Upload and manage company headers, stumps, and signatures."
                                    onClick={onManageImageStorage}
                                    color="indigo"
                                    icon={<FileImage />}
                                />
                                <ActionCard
                                    title="Invoice Print Settings"
                                    desc="Configure titles, headers, and stamps for invoice printing."
                                    onClick={onShowInvoiceSettings}
                                    color="blue"
                                    icon={<FileText />}
                                />
                            </div>
                        </div>
                    )}



                    {activeTab === 'data' && (
                        <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Database className="text-cyan-400" /> Data Management</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <ActionCard
                                    title="Statistics"
                                    desc="View system usage and data overview."
                                    onClick={onShowStatistics}
                                    color="blue"
                                    icon={<BarChart2 />}
                                />
                                <ActionCard
                                    title="Log File (History)"
                                    desc="Track all system changes and activities."
                                    onClick={onShowLogs}
                                    color="orange"
                                    icon={<History />}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'staff' && (
                        <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Users className="text-indigo-400" /> Staff & Team Management</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <ActionCard
                                    title="Manage Team / Users"
                                    desc="Create or edit team members and roles."
                                    onClick={onManageUsers}
                                    color="teal"
                                    icon={<User />}
                                />
                                <ActionCard
                                    title="Manage Staff"
                                    desc="Maintain employee records and payroll info."
                                    onClick={onManageStaff}
                                    color="indigo"
                                    icon={<Users />}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'reports' && (
                        <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><FileText className="text-blue-400" /> System Reports</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <ActionCard
                                    title="Lot Wise Profit Report"
                                    desc="Analyze profitability across different stock lots."
                                    onClick={onShowLotProfit}
                                    color="green"
                                    icon={<BarChart2 />}
                                />
                                <ActionCard
                                    title="Financial Statements"
                                    desc="View Balance Sheet, P&L, and Trial Balances."
                                    onClick={onShowFinancials}
                                    color="indigo"
                                    icon={<FileText />}
                                />
                                <ActionCard
                                    title="Payment Register"
                                    desc="Detailed list of all payment vouchers."
                                    onClick={onShowPaymentRegister}
                                    color="orange"
                                    icon={<DownloadCloud />}
                                />
                                <ActionCard
                                    title="Receipt Register"
                                    desc="Detailed list of all receipt vouchers."
                                    onClick={onShowReceiptRegister}
                                    color="green"
                                    icon={<UploadCloud />}
                                />
                                <ActionCard
                                    title="Contra Register"
                                    desc="Detailed list of all contra entries."
                                    onClick={onShowContraRegister}
                                    color="teal"
                                    icon={<RefreshCw />}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'rules' && (
                        <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><ShieldAlert /> System Rules</h3>
                            <p className="opacity-60 text-sm mb-6">Configure system-wide validation rules and logic here.</p>

                            <div className="flex bg-white/10 p-1 rounded-lg w-fit mb-6 overflow-x-auto">
                                <button
                                    onClick={() => setRulesSubTab('general')}
                                    className={`whitespace-nowrap px-4 py-2 text-xs font-bold rounded-md transition-all ${rulesSubTab === 'general' ? 'bg-teal-500 text-white shadow-lg' : 'hover:bg-white/5 text-white/60'}`}
                                >
                                    General Rules
                                </button>
                                <button
                                    onClick={() => setRulesSubTab('docs')}
                                    className={`whitespace-nowrap px-4 py-2 text-xs font-bold rounded-md transition-all ${rulesSubTab === 'docs' ? 'bg-teal-500 text-white shadow-lg' : 'hover:bg-white/5 text-white/60'}`}
                                >
                                    Documentation Rules
                                </button>
                            </div>

                            {rulesSubTab === 'general' ? (
                                <div className="overflow-hidden border border-white/10 rounded-lg">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-white/10 text-[10px] uppercase tracking-wider font-bold">
                                            <tr>
                                                <th className="px-4 py-3 border-b border-white/10">Rule Name</th>
                                                <th className="px-4 py-3 border-b border-white/10 w-32 text-center">Enable (Yes/No)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/10">
                                            {[
                                                { id: 'includeCashBankInVouchers', name: 'Cash/Bank include in payment receipt vouchers or not' }
                                            ].map(rule => (
                                                <tr key={rule.id} className="hover:bg-white/5 transition-colors">
                                                    <td className="px-4 py-4 text-sm font-medium">{rule.name}</td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 rounded border-white/20 bg-white/5 text-teal-500 focus:ring-teal-500 focus:ring-offset-0 cursor-pointer"
                                                            checked={companyProfile?.rules?.[rule.id] || false}
                                                            onChange={async (e) => {
                                                                const newValue = e.target.checked;
                                                                const updatedRules = {
                                                                    ...(companyProfile?.rules || {}),
                                                                    [rule.id]: newValue
                                                                };

                                                                const updatedProfile = {
                                                                    ...companyProfile,
                                                                    rules: updatedRules
                                                                };

                                                                // Update local state first for responsiveness
                                                                if (onUpdateProfile) onUpdateProfile(updatedProfile);

                                                                // Also save to Firestore
                                                                try {
                                                                    if (functions && (dataOwnerId || companyProfile?.id)) {
                                                                        const { httpsCallable } = await import('firebase/functions');
                                                                        const updateFn = httpsCallable(functions, 'updateCompanyProfile');
                                                                        await updateFn({ targetId: dataOwnerId || companyProfile.id, data: updatedProfile });
                                                                    }
                                                                } catch (err) {
                                                                    console.error("Failed to save rule:", err);
                                                                }
                                                            }}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="overflow-hidden border border-white/10 rounded-lg">
                                    <div className="bg-white/5 p-4 border-b border-white/10 flex justify-between items-center">
                                        <span className="text-xs font-bold text-teal-400">Configure Documents</span>
                                        <button
                                            onClick={async () => {
                                                const currentDocs = companyProfile?.rules?.docConfigs || [
                                                    { id: 'invoice', templateId: 'invoice', name: 'Tax Invoice', enabled: true },
                                                    { id: 'packing_list', templateId: 'packing_list', name: 'Packing List', enabled: true },
                                                    { id: 'bill_of_exchange', templateId: 'bill_of_exchange', name: 'Bill of Exchange', enabled: true },
                                                    { id: 'bank_application', templateId: 'bank_application', name: 'HBZ Bank Covering Letter', enabled: true }
                                                ];

                                                // Identify missing templates to add
                                                const templates = [
                                                    { id: 'invoice', name: 'Tax Invoice' },
                                                    { id: 'packing_list', name: 'Packing List' },
                                                    { id: 'bill_of_exchange', name: 'Bill of Exchange' },
                                                    { id: 'bank_application', name: 'Bank Form' }
                                                ];

                                                const nextTemplate = templates.find(t => !currentDocs.some(d => d.templateId === t.id));
                                                if (!nextTemplate) {
                                                    alert("All standard document templates are already added.");
                                                    return;
                                                }

                                                const newDoc = {
                                                    id: `${nextTemplate.id}_${Date.now()}`,
                                                    templateId: nextTemplate.id,
                                                    name: nextTemplate.name,
                                                    enabled: true
                                                };

                                                const updatedProfile = {
                                                    ...companyProfile,
                                                    rules: {
                                                        ...(companyProfile?.rules || {}),
                                                        docConfigs: [...currentDocs, newDoc]
                                                    }
                                                };

                                                if (onUpdateProfile) onUpdateProfile(updatedProfile);
                                                try {
                                                    if (functions && (dataOwnerId || companyProfile?.id)) {
                                                        const { httpsCallable } = await import('firebase/functions');
                                                        const updateFn = httpsCallable(functions, 'updateCompanyProfile');
                                                        await updateFn({ targetId: dataOwnerId || companyProfile.id, data: updatedProfile });
                                                    }
                                                } catch (err) { console.error(err); }
                                            }}
                                            className="flex items-center gap-1 bg-teal-500 hover:bg-teal-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-md transition-all"
                                        >
                                            <PlusCircle size={14} /> Add Document
                                        </button>
                                    </div>
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-white/10 text-[10px] uppercase tracking-wider font-bold">
                                            <tr>
                                                <th className="px-4 py-3 border-b border-white/10">Document Name</th>
                                                <th className="px-4 py-3 border-b border-white/10 text-center">Actions</th>
                                                <th className="px-4 py-3 border-b border-white/10 w-32 text-center">Enable</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/10">
                                            {(companyProfile?.rules?.docConfigs || [
                                                { id: 'invoice', templateId: 'invoice', name: 'Tax Invoice', enabled: companyProfile?.rules?.enabledDocs?.invoice !== false },
                                                { id: 'packing_list', templateId: 'packing_list', name: 'Packing List', enabled: companyProfile?.rules?.enabledDocs?.packing_list !== false },
                                                { id: 'bill_of_exchange', templateId: 'bill_of_exchange', name: 'Bill of Exchange', enabled: companyProfile?.rules?.enabledDocs?.bill_of_exchange !== false },
                                                { id: 'bank_application', templateId: 'bank_application', name: 'HBZ Bank Covering Letter', enabled: companyProfile?.rules?.enabledDocs?.bank_application !== false }
                                            ]).map((docType, index) => (
                                                <tr key={docType.id || index} className="hover:bg-white/5 transition-colors">
                                                    <td className="px-4 py-4">
                                                        {editingDocId === docType.id ? (
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type="text"
                                                                    className="bg-white/10 border border-white/20 rounded px-2 py-1 text-xs focus:ring-teal-500 focus:border-teal-500 outline-none"
                                                                    value={editDocName}
                                                                    onChange={e => setEditDocName(e.target.value)}
                                                                />
                                                                <button
                                                                    onClick={async () => {
                                                                        const currentDocs = companyProfile?.rules?.docConfigs || [
                                                                            { id: 'invoice', templateId: 'invoice', name: 'Tax Invoice', enabled: true },
                                                                            { id: 'packing_list', templateId: 'packing_list', name: 'Packing List', enabled: true },
                                                                            { id: 'bill_of_exchange', templateId: 'bill_of_exchange', name: 'Bill of Exchange', enabled: true },
                                                                            { id: 'bank_application', templateId: 'bank_application', name: 'HBZ Bank Covering Letter', enabled: true }
                                                                        ];
                                                                        const updatedDocs = currentDocs.map(d => d.id === docType.id ? { ...d, name: editDocName } : d);
                                                                        const updatedProfile = {
                                                                            ...companyProfile,
                                                                            rules: { ...(companyProfile?.rules || {}), docConfigs: updatedDocs }
                                                                        };
                                                                        if (onUpdateProfile) onUpdateProfile(updatedProfile);
                                                                        setEditingDocId(null);
                                                                        try {
                                                                            if (functions && (dataOwnerId || companyProfile?.id)) {
                                                                                const { httpsCallable } = await import('firebase/functions');
                                                                                const updateFn = httpsCallable(functions, 'updateCompanyProfile');
                                                                                await updateFn({ targetId: dataOwnerId || companyProfile.id, data: updatedProfile });
                                                                            }
                                                                        } catch (err) { console.error(err); }
                                                                    }}
                                                                    className="text-teal-400 font-bold text-[10px]"
                                                                >Save</button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-medium">{docType.name}</span>
                                                                <button onClick={() => { setEditingDocId(docType.id); setEditDocName(docType.name); }} className="opacity-40 hover:opacity-100 transition-opacity">
                                                                    <Pencil size={12} />
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div className="text-[10px] opacity-40 uppercase font-black">Template: {docType.templateId}</div>
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        <div className="flex items-center justify-center gap-3">
                                                            <button
                                                                onClick={async () => {
                                                                    // PREVIEW DEMO LOGIC
                                                                    const dummyData = {
                                                                        invoiceNo: "DEMO-1234",
                                                                        date: new Date().toISOString().split('T')[0],
                                                                        partyName: "Demo Corporation Ltd",
                                                                        partyAddress: "123 Business Avenue, Downtown, Dubai",
                                                                        partyTrn: "100200300400500",
                                                                        items: [
                                                                            { productName: "Premium Quality Product A", qty: 100, rate: 50, amount: 5000 },
                                                                            { productName: "Industrial Material Category B", qty: 50, rate: 120, amount: 6000 }
                                                                        ],
                                                                        subTotal: 11000,
                                                                        vatTotal: 550,
                                                                        grandTotal: 11550,
                                                                        grandTotalForeign: 11550,
                                                                        currencySymbol: 'AED',
                                                                        seller: {
                                                                            name: companyProfile?.name || 'Your Company Name',
                                                                            address: companyProfile?.address || 'Your Address',
                                                                            trn: companyProfile?.trn || 'TRN-000-000',
                                                                            email: companyProfile?.email || 'email@example.com'
                                                                        },
                                                                        printOptions: {
                                                                            selectedHeading: docType.name
                                                                        }
                                                                    };

                                                                    if (docType.templateId === 'invoice') await generateInvoicePDF(dummyData, 'preview');
                                                                    else if (docType.templateId === 'packing_list') await generatePackingListPDF(dummyData, 'preview');
                                                                    else if (docType.templateId === 'bill_of_exchange') await generateBillOfExchangePDF(dummyData, 'preview');
                                                                    else if (docType.templateId === 'bank_application') await generateBankApplicationPDF(dummyData, 'preview');
                                                                }}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 rounded-md transition-all text-[10px] font-bold"
                                                            >
                                                                <Eye size={12} /> View Demo
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    if (!confirm(`Are you sure you want to remove ${docType.name}?`)) return;
                                                                    const currentDocs = companyProfile?.rules?.docConfigs || [
                                                                        { id: 'invoice', templateId: 'invoice', name: 'Tax Invoice', enabled: true },
                                                                        { id: 'packing_list', templateId: 'packing_list', name: 'Packing List', enabled: true },
                                                                        { id: 'bill_of_exchange', templateId: 'bill_of_exchange', name: 'Bill of Exchange', enabled: true },
                                                                        { id: 'bank_application', templateId: 'bank_application', name: 'HBZ Bank Covering Letter', enabled: true }
                                                                    ];
                                                                    const updatedDocs = currentDocs.filter(d => d.id !== docType.id);
                                                                    const updatedProfile = {
                                                                        ...companyProfile,
                                                                        rules: { ...(companyProfile?.rules || {}), docConfigs: updatedDocs }
                                                                    };
                                                                    if (onUpdateProfile) onUpdateProfile(updatedProfile);
                                                                    try {
                                                                        if (functions && (dataOwnerId || companyProfile?.id)) {
                                                                            const { httpsCallable } = await import('firebase/functions');
                                                                            const updateFn = httpsCallable(functions, 'updateCompanyProfile');
                                                                            await updateFn({ targetId: dataOwnerId || companyProfile.id, data: updatedProfile });
                                                                        }
                                                                    } catch (err) { console.error(err); }
                                                                }}
                                                                className="p-1.5 bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded-md transition-all"
                                                            >
                                                                <Trash size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 rounded border-white/20 bg-white/5 text-teal-500 focus:ring-teal-500 focus:ring-offset-0 cursor-pointer"
                                                            checked={docType.enabled}
                                                            onChange={async (e) => {
                                                                const newValue = e.target.checked;
                                                                const currentDocs = companyProfile?.rules?.docConfigs || [
                                                                    { id: 'invoice', templateId: 'invoice', name: 'Tax Invoice', enabled: true },
                                                                    { id: 'packing_list', templateId: 'packing_list', name: 'Packing List', enabled: true },
                                                                    { id: 'bill_of_exchange', templateId: 'bill_of_exchange', name: 'Bill of Exchange', enabled: true },
                                                                    { id: 'bank_application', templateId: 'bank_application', name: 'HBZ Bank Covering Letter', enabled: true }
                                                                ];
                                                                const updatedDocs = currentDocs.map(d => d.id === docType.id ? { ...d, enabled: newValue } : d);
                                                                const updatedProfile = {
                                                                    ...companyProfile,
                                                                    rules: { ...(companyProfile?.rules || {}), docConfigs: updatedDocs }
                                                                };
                                                                if (onUpdateProfile) onUpdateProfile(updatedProfile);
                                                                try {
                                                                    if (functions && (dataOwnerId || companyProfile?.id)) {
                                                                        const { httpsCallable } = await import('firebase/functions');
                                                                        const updateFn = httpsCallable(functions, 'updateCompanyProfile');
                                                                        await updateFn({ targetId: dataOwnerId || companyProfile.id, data: updatedProfile });
                                                                    }
                                                                } catch (err) { console.error(err); }
                                                            }}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <div className="p-4 bg-white/5 mt-4 rounded-lg border border-white/10">
                                        <p className="text-[10px] text-white/40 italic">* Note: Enabled documents with 'Show in Download' checked will appear in the invoice options.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'summary_reports' && (
                        <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
                                <h3 className="text-xl font-bold flex items-center gap-2"><Archive className="text-amber-400" /> Summarised Reports</h3>

                                {/* DATE FILTER */}
                                <div className="flex gap-4 bg-white/5 p-3 rounded-xl border border-white/10">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[9px] font-black opacity-30 uppercase tracking-widest pl-1">From Period</span>
                                        <input
                                            type="date"
                                            className="bg-transparent border-none text-xs font-bold text-amber-200 focus:ring-0 cursor-pointer"
                                            value={summaryDateRange.from}
                                            onChange={e => setSummaryDateRange({ ...summaryDateRange, from: e.target.value })}
                                        />
                                    </div>
                                    <div className="w-px bg-white/10"></div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[9px] font-black opacity-30 uppercase tracking-widest pl-1">To Period</span>
                                        <input
                                            type="date"
                                            className="bg-transparent border-none text-xs font-bold text-amber-200 focus:ring-0 cursor-pointer"
                                            value={summaryDateRange.to}
                                            onChange={e => setSummaryDateRange({ ...summaryDateRange, to: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex bg-white/10 p-1 rounded-lg w-fit mb-8 overflow-x-auto no-scrollbar max-w-full">
                                <button
                                    onClick={() => setSummarySubTab('cashflow')}
                                    className={`whitespace-nowrap px-4 py-2 text-xs font-bold rounded-md transition-all ${summarySubTab === 'cashflow' ? 'bg-amber-500 text-white shadow-lg' : 'hover:bg-white/5 text-white/60'}`}
                                >
                                    Cash Flow Summary
                                </button>
                                <button
                                    onClick={() => setSummarySubTab('items')}
                                    className={`whitespace-nowrap px-4 py-2 text-xs font-bold rounded-md transition-all ${summarySubTab === 'items' ? 'bg-amber-500 text-white shadow-lg' : 'hover:bg-white/5 text-white/60'}`}
                                >
                                    Item Wise Summary
                                </button>
                            </div>

                            <div className="min-h-[300px]">
                                {summarySubTab === 'cashflow' && (
                                    <div className="animate-in fade-in duration-300">
                                        <h4 className="text-lg font-bold mb-4 opacity-80 text-blue-200">Payment & Receipts Combined Analysis</h4>
                                        <p className="text-white/40 italic text-sm mb-8 font-mono">Side-by-side view of money coming in (Left), internal accounts (Center), and money going out (Right).</p>
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                                            {/* LEFT SIDE: RECEIPTS */}
                                            <div className="flex flex-col gap-6">
                                                <div className="bg-gradient-to-br from-cyan-500/20 to-transparent p-6 rounded-2xl border border-cyan-500/20 shadow-xl">
                                                    <div className="text-[10px] text-cyan-400 uppercase font-black mb-1 flex items-center gap-2 underline decoration-cyan-500/50 underline-offset-4">Total Amount Received</div>
                                                    <div className="text-3xl font-black text-cyan-400 font-mono">
                                                        {currencySymbol} {summary.totalReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </div>
                                                    <div className="text-[10px] text-white/40 mt-1 uppercase font-bold">{summary.countReceived} Receipt Vouchers</div>
                                                </div>

                                                <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                                                    <div className="px-6 py-4 border-b border-white/10 bg-cyan-500/5 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-cyan-400">
                                                        <span>Source (Customer/Incomes)</span>
                                                        <span>Amount</span>
                                                    </div>
                                                    <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                                                        {Object.entries(summary.receiptsByEntity)
                                                            .sort((a, b) => b[1] - a[1])
                                                            .map(([name, val], idx) => (
                                                                <div key={idx} className="px-6 py-3 border-b border-white/5 flex justify-between items-center hover:bg-cyan-500/5 transition-colors">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-5 h-5 rounded-full bg-cyan-500/10 flex items-center justify-center text-[9px] font-bold text-cyan-500">
                                                                            {idx + 1}
                                                                        </div>
                                                                        <span className="text-[10px] font-bold text-white/80 line-clamp-1">{name}</span>
                                                                    </div>
                                                                    <span className="text-[10px] font-mono font-bold text-cyan-400 ml-4">{val.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                                </div>
                                                            ))
                                                        }
                                                    </div>
                                                </div>
                                            </div>

                                            {/* CENTER SIDE: RECEIVED BY / PAID FROM (Internal Accounts) */}
                                            <div className="flex flex-col gap-6">
                                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20 flex flex-col items-center justify-center h-[120px]">
                                                    <div className="text-[10px] text-white/40 uppercase font-black mb-1 tracking-widest">Internal Point Summary</div>
                                                    <div className="text-sm font-black text-white px-3 py-1 bg-white/10 rounded-full border border-white/10 italic">Recv By / Paid From</div>
                                                </div>

                                                {/* RECEIVED BY LIST */}
                                                <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                                                    <div className="px-6 py-4 border-b border-white/10 bg-cyan-500/10 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-cyan-200">
                                                        <span>Received By (Our Account)</span>
                                                        <span>Total Recv.</span>
                                                    </div>
                                                    <div className="max-h-[200px] overflow-y-auto no-scrollbar">
                                                        {Object.entries(summary.receivedByAccounts)
                                                            .sort((a, b) => b[1] - a[1])
                                                            .map(([name, val], idx) => (
                                                                <div key={idx} className="px-6 py-3 border-b border-white/5 flex justify-between items-center hover:bg-white/5 transition-colors">
                                                                    <span className="text-[10px] font-bold text-white/80">{name}</span>
                                                                    <span className="text-[10px] font-mono font-bold text-cyan-400 ml-4">{val.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                                </div>
                                                            ))
                                                        }
                                                    </div>
                                                </div>

                                                {/* PAID FROM LIST */}
                                                <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                                                    <div className="px-6 py-4 border-b border-white/10 bg-amber-500/10 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-amber-200">
                                                        <span>Paid From (Our Account)</span>
                                                        <span>Total Paid</span>
                                                    </div>
                                                    <div className="max-h-[200px] overflow-y-auto no-scrollbar">
                                                        {Object.entries(summary.paidFromAccounts)
                                                            .sort((a, b) => b[1] - a[1])
                                                            .map(([name, val], idx) => (
                                                                <div key={idx} className="px-6 py-3 border-b border-white/5 flex justify-between items-center hover:bg-white/5 transition-colors">
                                                                    <span className="text-[10px] font-bold text-white/80">{name}</span>
                                                                    <span className="text-[10px] font-mono font-bold text-amber-400 ml-4">{val.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                                </div>
                                                            ))
                                                        }
                                                    </div>
                                                </div>
                                            </div>

                                            {/* RIGHT SIDE: PAYMENTS */}
                                            <div className="flex flex-col gap-6">
                                                <div className="bg-gradient-to-br from-amber-500/20 to-transparent p-6 rounded-2xl border border-amber-500/20 shadow-xl">
                                                    <div className="text-[10px] text-amber-400 uppercase font-black mb-1 flex items-center gap-2 underline decoration-amber-500/50 underline-offset-4">Total Amount Paid</div>
                                                    <div className="text-3xl font-black text-amber-400 font-mono">
                                                        {currencySymbol} {summary.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </div>
                                                    <div className="text-[10px] text-white/40 mt-1 uppercase font-bold">{summary.countPaid} Payment Vouchers</div>
                                                </div>

                                                <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                                                    <div className="px-6 py-4 border-b border-white/10 bg-amber-500/5 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-amber-400">
                                                        <span>Recipient (Vendors/Exp)</span>
                                                        <span>Amount</span>
                                                    </div>
                                                    <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                                                        {Object.entries(summary.paymentsByEntity)
                                                            .sort((a, b) => b[1] - a[1])
                                                            .map(([name, val], idx) => (
                                                                <div key={idx} className="px-6 py-3 border-b border-white/5 flex justify-between items-center hover:bg-amber-500/5 transition-colors">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-[9px] font-bold text-amber-500">
                                                                            {idx + 1}
                                                                        </div>
                                                                        <span className="text-[10px] font-bold text-white/80 line-clamp-1">{name}</span>
                                                                    </div>
                                                                    <span className="text-[10px] font-mono font-bold text-amber-400 ml-4">{val.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                                </div>
                                                            ))
                                                        }
                                                    </div>
                                                </div>
                                            </div>

                                        </div>
                                    </div>
                                )}

                                {summarySubTab === 'items' && (
                                    <div className="animate-in fade-in duration-300">
                                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
                                            <div>
                                                <h4 className="text-lg font-bold opacity-80 text-green-200">Item Wise Summary Analysis</h4>
                                                <p className="text-white/40 italic text-sm font-mono">Select an item to see purchase and sales breakdown by party.</p>
                                            </div>

                                            <div className="w-full md:w-64">
                                                <select
                                                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-green-500 outline-none"
                                                    value={selectedSummaryProductId}
                                                    onChange={e => setSelectedSummaryProductId(e.target.value)}
                                                >
                                                    <option value="" className="bg-slate-900 text-white">-- Select Item --</option>
                                                    {products?.sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                                        <option key={p.id} value={p.id} className="bg-slate-900 text-white">{p.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        {selectedSummaryProductId ? (
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                                                {/* PURCHASE SUMMARY */}
                                                <div className="flex flex-col gap-4">
                                                    <div className="px-4 py-2 bg-green-500/10 border-l-4 border-green-500 rounded-r-lg">
                                                        <div className="text-[10px] font-black uppercase text-green-400">Total Purchase Analysis</div>
                                                        <div className="flex justify-between items-end">
                                                            <div className="text-2xl font-black text-white">{summary.itemStats.totalPqty.toLocaleString()} <span className="text-[10px] opacity-40">Qty</span></div>
                                                            <div className="text-sm font-mono text-green-400">{currencySymbol} {summary.itemStats.totalPval.toLocaleString()}</div>
                                                        </div>
                                                    </div>

                                                    <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                                                        <table className="w-full text-[10px]">
                                                            <thead className="bg-green-500/5 text-green-400 uppercase font-black tracking-widest">
                                                                <tr>
                                                                    <th className="px-4 py-3 text-left">Purchased From</th>
                                                                    <th className="px-4 py-3 text-right">Qty</th>
                                                                    <th className="px-4 py-3 text-right">Avg Rate</th>
                                                                    <th className="px-4 py-3 text-right">Value</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-white/5">
                                                                {Object.entries(summary.itemStats.purchase).map(([party, data], idx) => (
                                                                    <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                                        <td className="px-4 py-2 text-white/80 font-bold">{party}</td>
                                                                        <td className="px-4 py-2 text-right text-white/60">{data.qty.toLocaleString()}</td>
                                                                        <td className="px-4 py-2 text-right text-green-400 font-mono">{(data.val / data.qty).toFixed(2)}</td>
                                                                        <td className="px-4 py-2 text-right text-white/80 font-bold">{data.val.toLocaleString()}</td>
                                                                    </tr>
                                                                ))}
                                                                {Object.keys(summary.itemStats.purchase).length === 0 && (
                                                                    <tr><td colSpan="4" className="p-8 text-center text-white/20 italic">No purchase records in this period</td></tr>
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>

                                                {/* SALES SUMMARY */}
                                                <div className="flex flex-col gap-4">
                                                    <div className="px-4 py-2 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg">
                                                        <div className="text-[10px] font-black uppercase text-blue-400">Total Sales Analysis</div>
                                                        <div className="flex justify-between items-end">
                                                            <div className="text-2xl font-black text-white">{summary.itemStats.totalSqty.toLocaleString()} <span className="text-[10px] opacity-40">Qty</span></div>
                                                            <div className="text-sm font-mono text-blue-400">{currencySymbol} {summary.itemStats.totalSval.toLocaleString()}</div>
                                                        </div>
                                                    </div>

                                                    <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                                                        <table className="w-full text-[10px]">
                                                            <thead className="bg-blue-500/5 text-blue-400 uppercase font-black tracking-widest">
                                                                <tr>
                                                                    <th className="px-4 py-3 text-left">Sold To Customer</th>
                                                                    <th className="px-4 py-3 text-right">Qty</th>
                                                                    <th className="px-4 py-3 text-right">Avg Rate</th>
                                                                    <th className="px-4 py-3 text-right">Value</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-white/5">
                                                                {Object.entries(summary.itemStats.sales).map(([party, data], idx) => (
                                                                    <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                                        <td className="px-4 py-2 text-white/80 font-bold">{party}</td>
                                                                        <td className="px-4 py-2 text-right text-white/60">{data.qty.toLocaleString()}</td>
                                                                        <td className="px-4 py-2 text-right text-blue-400 font-mono">{(data.val / data.qty).toFixed(2)}</td>
                                                                        <td className="px-4 py-2 text-right text-white/80 font-bold">{data.val.toLocaleString()}</td>
                                                                    </tr>
                                                                ))}
                                                                {Object.keys(summary.itemStats.sales).length === 0 && (
                                                                    <tr><td colSpan="4" className="p-8 text-center text-white/20 italic">No sales records in this period</td></tr>
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>

                                            </div>
                                        ) : (
                                            <div className="mt-12 flex flex-col items-center justify-center p-20 bg-white/5 border border-dashed border-white/10 rounded-2xl">
                                                <Archive className="w-12 h-12 text-white/10 mb-4" />
                                                <p className="text-white/40 font-mono text-center">Please select an item from the dropdown above <br />to view its purchase and sales movement.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {
                        activeTab === 'tools' && (
                            <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                                <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Wrench className="text-blue-400" /> Utility Tools</h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    <ActionCard
                                        title="Install / Re-install App"
                                        desc={isInstallable ? "Install app for offline access." : "App is already installed."}
                                        onClick={onInstall}
                                        color="green"
                                        icon={<DownloadCloud />}
                                    />
                                    <ActionCard
                                        title="Backup Data"
                                        desc="Download a copy of your system data."
                                        onClick={onBackup}
                                        color="blue"
                                        icon={<UploadCloud />}
                                    />
                                    <ActionCard
                                        title="Restore Data"
                                        desc="Upload and restore previously backed up data."
                                        onClick={onRestore}
                                        color="orange"
                                        icon={<RefreshCw />}
                                    />
                                    <ActionCard
                                        title="Change Password"
                                        desc="Update your account login password."
                                        onClick={onChangePassword}
                                        color="purple"
                                        icon={<Key />}
                                    />
                                </div>
                            </div>
                        )
                    }

                    {/* CHARTS & GRAPHS TAB */}
                    {/* CHARTS & GRAPHS TAB */}
                    {
                        activeTab === 'charts' && (
                            <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-8 backdrop-blur-md animate-in slide-in-from-bottom duration-500 min-h-[400px] flex flex-col items-center justify-center text-center">
                                <BarChart3 size={64} className="text-cyan-400/20 mb-4" />
                                <h3 className="text-2xl font-bold opacity-90 mb-2 text-cyan-400">Advanced Analytics</h3>
                                <p className="text-white/40 max-w-md">Our engineering team is currently developing rich, interactive visualization tools for your business data. This module will be available in the next major update.</p>
                                <div className="mt-8 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-xs font-black uppercase tracking-widest">
                                    Coming Soon
                                </div>
                            </div>
                        )
                    }

                    {/* RECALCULATE TAB */}
                    {
                        activeTab === 'recalculate' && (
                            <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                                <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Zap className="text-yellow-400" /> Recalculate System Data</h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    <div
                                        className={`col-span-1 md:col-span-2 lg:col-span-3 bg-red-500/10 border border-red-500/30 p-6 rounded-xl flex items-center justify-between hover:bg-red-500/20 transition-colors ${isRecalculating ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                                        onClick={() => !isRecalculating && onRecalculateAll && onRecalculateAll()}
                                    >
                                        <div>
                                            <h4 className="text-lg font-bold text-red-200">{isRecalculating ? 'Recalculation in Progress...' : 'Full System Diagnostics & Reset'}</h4>
                                            <p className="text-sm text-red-100/60 mt-1">Recalculate Stock, Parties, Accounts, Capital, and Expenses in one go.</p>
                                        </div>
                                        <div className="bg-red-500 p-3 rounded-full shadow-lg">
                                            <RefreshCw size={24} className={`text-white ${isRecalculating ? 'animate-spin' : 'animate-spin-slow'}`} />
                                        </div>
                                    </div>

                                    <ActionCard title="Stock Inventory" desc="Recalculate weighted average costs and quantities." onClick={onRecalculateStock} color="blue" disabled={isRecalculating} />
                                    <ActionCard title="Party Balances" desc="Fix customer and supplier ledger mismatches." onClick={onRecalculateParties} color="green" disabled={isRecalculating} />
                                    <ActionCard title="Cash/Bank" desc="Re-align Cash/Bank balances." onClick={onRecalculateAccounts} color="purple" disabled={isRecalculating} />
                                    <ActionCard title="Expenses" desc="Sum up all expense journal entries." onClick={onRecalculateExpenses} color="orange" disabled={isRecalculating} />
                                    <ActionCard title="Capital Accounts" desc="Recalculate owner equity and capital." onClick={onRecalculateCapital} color="teal" disabled={isRecalculating} />
                                </div>
                            </div>
                        )
                    }

                    {/* RECALCULATE NEW TAB */}
                    {
                        activeTab === 'recalculate_new' && (
                            <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                                <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Zap className="text-green-400" /> Recalculate System (Pro Engine)</h3>
                                <p className="text-sm text-white/60 mb-6 max-w-2xl leading-relaxed">
                                    Welcome to the new unified recalculation engine. This advanced tool processes all financial data across the entire system in a single, optimized pass.
                                    It ensures perfect consistency between Transactional Vouchers and Ledger Balances for: <b className="text-white">Accounts, Stock Items, Parties, Cashiers, Expenses, Assets, and Capital.</b>
                                </p>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    <div
                                        className={`col-span-1 md:col-span-2 lg:col-span-3 bg-gradient-to-r from-green-500/20 to-teal-500/20 border border-green-500/30 p-8 rounded-xl flex items-center justify-between hover:from-green-500/30 hover:to-teal-500/30 transition-all shadow-xl ${isRecalculating ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:border-green-400/50'}`}
                                        onClick={() => !isRecalculating && onRecalculateAll && onRecalculateAll()}
                                    >
                                        <div>
                                            <h4 className="text-2xl font-black text-green-200 tracking-tight">{isRecalculating ? 'Executing Logic...' : 'Execute New Recalculation Engine'}</h4>
                                            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-xs font-bold text-green-100/70">
                                                <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Rebuilds All Account & Customer Ledgers</span>
                                                <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Recalculates Weighted Avg Stock Costs</span>
                                                <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Verifies Expense & Capital Entries</span>
                                                <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Processes Cashier & Asset Transactions</span>
                                            </div>
                                        </div>
                                        <div className="bg-green-500 p-5 rounded-full shadow-lg shadow-green-900/50 border-4 border-green-600/50">
                                            <RefreshCw size={40} strokeWidth={2.5} className={`text-white ${isRecalculating ? 'animate-spin' : ''}`} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    }

                    {/* TRANSPORT SECTION TAB */}
                    {
                        activeTab === 'transport' && (
                            <div className="mt-12 animate-in slide-in-from-bottom duration-500">
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                                    {/* ADD VEHICLE FORM */}
                                    <div className="lg:col-span-1 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md">
                                        <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><PlusCircle className="text-green-400" /> Add New Vehicle</h3>

                                        <form onSubmit={handleSaveVehicle} className="space-y-4">
                                            <div>
                                                <label className="text-[10px] font-black uppercase text-white/40 block mb-1">Category</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setVehicleForm({ ...vehicleForm, category: 'our' })}
                                                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${vehicleForm.category === 'our' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-white/5 border-white/10 text-white/40'}`}
                                                    >
                                                        OUR VEHICLE
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setVehicleForm({ ...vehicleForm, category: 'outside' })}
                                                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${vehicleForm.category === 'outside' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-white/5 border-white/10 text-white/40'}`}
                                                    >
                                                        OUTSIDE
                                                    </button>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-black uppercase text-white/40 block mb-1">Vehicle Number</label>
                                                <input
                                                    type="text"
                                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-green-500 outline-none uppercase font-mono"
                                                    placeholder="ex. DUBAI 12345"
                                                    value={vehicleForm.vNo}
                                                    onChange={e => setVehicleForm({ ...vehicleForm, vNo: e.target.value })}
                                                />
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-black uppercase text-white/40 block mb-1">City</label>
                                                <input
                                                    type="text"
                                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-green-500 outline-none"
                                                    placeholder="ex. Dubai, Sharjah..."
                                                    value={vehicleForm.city}
                                                    onChange={e => setVehicleForm({ ...vehicleForm, city: e.target.value })}
                                                />
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-black uppercase text-white/40 block mb-1">Company Name</label>
                                                <input
                                                    type="text"
                                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-green-500 outline-none"
                                                    placeholder="ex. Own, Transport LLC..."
                                                    value={vehicleForm.company}
                                                    onChange={e => setVehicleForm({ ...vehicleForm, company: e.target.value })}
                                                />
                                            </div>

                                            <button
                                                disabled={isSavingVehicle}
                                                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-black py-3 rounded-lg shadow-lg active:scale-95 transition-all mt-4 uppercase tracking-widest text-xs"
                                            >
                                                {isSavingVehicle ? 'SAVING...' : 'SAVE VEHICLE DETAILS'}
                                            </button>
                                        </form>
                                    </div>

                                    {/* VEHICLE LISTS */}
                                    <div className="lg:col-span-2 space-y-8">

                                        {/* OUR VEHICLES */}
                                        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-md">
                                            <div className="bg-green-500/10 px-6 py-4 border-b border-white/10 flex justify-between items-center">
                                                <h4 className="text-lg font-bold text-green-400">1. Our Vehicles</h4>
                                                <span className="text-[10px] font-black bg-green-500/20 px-2 py-1 rounded text-green-400">
                                                    {vehicles.filter(v => v.category === 'our').length} TOTAL
                                                </span>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-left">
                                                    <thead className="bg-white/5 text-[10px] uppercase font-black tracking-widest text-white/40">
                                                        <tr>
                                                            <th className="px-6 py-4">Vehicle Number</th>
                                                            <th className="px-6 py-4">City</th>
                                                            <th className="px-6 py-4">Company</th>
                                                            <th className="px-6 py-4 w-10"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-white/5">
                                                        {vehicles.filter(v => v.category === 'our').map(v => (
                                                            <tr key={v.id} className="hover:bg-white/5 transition-colors group">
                                                                <td className="px-6 py-4 text-sm font-black font-mono text-green-100">{v.vNo}</td>
                                                                <td className="px-6 py-4 text-sm opacity-60">{v.city}</td>
                                                                <td className="px-6 py-4 text-sm opacity-60">{v.company}</td>
                                                                <td className="px-6 py-4">
                                                                    <button onClick={() => handleDeleteVehicle(v.id)} className="text-white/10 group-hover:text-red-400 transition-colors"><Trash size={14} /></button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {vehicles.filter(v => v.category === 'our').length === 0 && (
                                                            <tr><td colSpan="4" className="px-6 py-10 text-center text-white/20 italic">No owned vehicles added yet.</td></tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {/* OUTSIDE VEHICLES */}
                                        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-md">
                                            <div className="bg-blue-500/10 px-6 py-4 border-b border-white/10 flex justify-between items-center">
                                                <h4 className="text-lg font-bold text-blue-400">2. Outside Vehicles</h4>
                                                <span className="text-[10px] font-black bg-blue-500/20 px-2 py-1 rounded text-blue-400">
                                                    {vehicles.filter(v => v.category === 'outside').length} TOTAL
                                                </span>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-left">
                                                    <thead className="bg-white/5 text-[10px] uppercase font-black tracking-widest text-white/40">
                                                        <tr>
                                                            <th className="px-6 py-4">Vehicle Number</th>
                                                            <th className="px-6 py-4">City</th>
                                                            <th className="px-6 py-4">Company</th>
                                                            <th className="px-6 py-4 w-10"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-white/5">
                                                        {vehicles.filter(v => v.category === 'outside').map(v => (
                                                            <tr key={v.id} className="hover:bg-white/5 transition-colors group">
                                                                <td className="px-6 py-4 text-sm font-black font-mono text-blue-100">{v.vNo}</td>
                                                                <td className="px-6 py-4 text-sm opacity-60">{v.city}</td>
                                                                <td className="px-6 py-4 text-sm opacity-60">{v.company}</td>
                                                                <td className="px-6 py-4">
                                                                    <button onClick={() => handleDeleteVehicle(v.id)} className="text-white/10 group-hover:text-red-400 transition-colors"><Trash size={14} /></button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {vehicles.filter(v => v.category === 'outside').length === 0 && (
                                                            <tr><td colSpan="4" className="px-6 py-10 text-center text-white/20 italic">No outside vehicles added yet.</td></tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            </div>
                        )
                    }

                    {activeTab === 'orders' && (
                        <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><ShoppingBag className="text-pink-400" /> Orders & Notes Center</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <ActionCard
                                    title="Orders Center"
                                    desc="View and manage all your pending orders and notes."
                                    onClick={() => onManageOrders('orders_vouchers')}
                                    color="purple"
                                    icon={<Archive />}
                                />
                                <ActionCard
                                    title="Sales Order"
                                    desc="Create a pre-order for your customers."
                                    onClick={() => onManageOrders('sales_order')}
                                    color="blue"
                                    icon={<ShoppingBag />}
                                />
                                <ActionCard
                                    title="Purchase Order"
                                    desc="Issue a pre-order to your suppliers."
                                    onClick={() => onManageOrders('purchase_order')}
                                    color="green"
                                    icon={<Zap />}
                                />
                                <ActionCard
                                    title="Credit Note"
                                    desc="Issue credit notes (memo only)."
                                    onClick={() => onManageOrders('credit_note')}
                                    color="red"
                                    icon={<ReceiptText />}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'customers_profile' && (
                        <div className="mt-12 animate-in slide-in-from-bottom duration-500">
                            <CustomersProfileModule user={user} dataOwnerId={dataOwnerId} />
                        </div>
                    )}

                    {activeTab === 'developer_tools' && currentRole === 'developer' && (
                        <div className="mt-8 animate-in slide-in-from-bottom duration-500">
                            {/* HEADER */}
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-xl font-bold flex items-center gap-2"><ShieldAlert className="text-red-400" /> Developer Control Center</h3>
                                <div className="flex items-center gap-3">
                                    <button onClick={fetchAllLicenses} className="text-[10px] bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg font-black uppercase tracking-wider flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
                                    <div className="text-[10px] font-black bg-red-500/20 px-3 py-1 rounded-full text-red-400 uppercase tracking-widest">NADTALLY INTERNAL USE ONLY</div>
                                </div>
                            </div>

                            {/* SUB-TABS */}
                            <div className="flex gap-2 mb-5 border-b border-white/5 pb-3 overflow-x-auto">
                                {[
                                    { id: 'registry', label: '📋 License Registry', count: serialKeys.length },
                                    { id: 'pending', label: '⏳ Pending Requests', count: serialKeys.filter(k => k.status === 'pending').length },
                                    { id: 'generate', label: '🔑 Generate Serial Key' },
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setDevSubTab(tab.id)}
                                        className={`px-4 py-2 text-xs font-black rounded-lg uppercase tracking-wider flex items-center gap-2 transition-all whitespace-nowrap ${
                                            devSubTab === tab.id ? 'bg-red-600 text-white shadow-lg' : 'bg-white/5 hover:bg-white/10 text-white/60'
                                        }`}
                                    >
                                        {tab.label}
                                        {tab.count !== undefined && <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                            devSubTab === tab.id ? 'bg-white/20' : 'bg-white/10'
                                        } font-black`}>{tab.count}</span>}
                                    </button>
                                ))}
                            </div>

                            {/* SUB-TAB: LICENSE REGISTRY */}
                            {devSubTab === 'registry' && (
                                <div className="bg-black/40 rounded-xl overflow-hidden border border-white/5 shadow-2xl">
                                    <div className="max-h-[600px] overflow-auto custom-scrollbar">
                                        <table className="w-full text-left text-[11px]">
                                            <thead className="bg-white/10 text-white/40 uppercase font-black sticky top-0 z-10">
                                                <tr>
                                                    <th className="px-3 py-3">#</th>
                                                    <th className="px-3 py-3">Serial Key</th>
                                                    <th className="px-3 py-3">Status</th>
                                                    <th className="px-3 py-3">Assigned Email</th>
                                                    <th className="px-3 py-3">Owner Name</th>
                                                    <th className="px-3 py-3">TEL Number</th>
                                                    <th className="px-3 py-3">Version No.</th>
                                                    <th className="px-3 py-3">Device/PC ID</th>
                                                    <th className="px-3 py-3">Live Companies</th>
                                                    <th className="px-3 py-3">Reads/Writes/Storage</th>
                                                    <th className="px-3 py-3">Requested</th>
                                                    <th className="px-3 py-3">Start Date</th>
                                                    <th className="px-3 py-3">Expiry Date</th>
                                                    <th className="px-3 py-3">Days Left</th>
                                                    <th className="px-3 py-3">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {loadingKeys ? (
                                                    <tr><td colSpan="15" className="p-16 text-center"><div className="animate-spin h-6 w-6 border-2 border-red-500 border-t-transparent rounded-full mx-auto mb-2"></div><span className="text-white/30 font-bold">LOADING LICENSE DATABASE...</span></td></tr>
                                                ) : serialKeys.length === 0 ? (
                                                    <tr><td colSpan="15" className="p-16 text-center text-white/20 italic">No license keys found. Generate your first key using the Generate tab.</td></tr>
                                                ) : (
                                                    serialKeys.map((key, idx) => {
                                                        const isExpired = key.expiresAt && new Date(key.expiresAt) < new Date();
                                                        const statusColor = {
                                                            approved: 'bg-green-500/20 text-green-400',
                                                            pending: 'bg-yellow-500/20 text-yellow-400',
                                                            rejected: 'bg-red-500/20 text-red-400',
                                                            expired: 'bg-red-900/40 text-red-600',
                                                            inactive: 'bg-white/5 text-white/20',
                                                        }[key.status] || 'bg-white/5 text-white/20';
                                                        const isLoading = approveLoadingId === key.id;
                                                        const daysLeft = key.expiresAt ? Math.ceil((new Date(key.expiresAt) - new Date()) / 86400000) : null;
                                                        const daysColor = daysLeft === null ? 'text-white/20' : daysLeft <= 0 ? 'text-red-500 font-black' : daysLeft <= 30 ? 'text-orange-400 font-bold' : 'text-green-400 font-bold';
                                                        return (
                                                            <tr key={key.id} className="hover:bg-white/5 transition-colors group">
                                                                <td className="px-3 py-2.5 text-white/20 font-bold">{idx + 1}</td>
                                                                <td className="px-3 py-2.5 font-mono font-black text-blue-400 text-[12px]">{key.id}</td>
                                                                <td className="px-3 py-2.5">
                                                                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase ${statusColor}`}>
                                                                        {key.status || 'inactive'}
                                                                        {isExpired && key.status === 'approved' ? ' ✗' : ''}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2.5 text-cyan-400/70">{key.email || <span className="opacity-20">—</span>}</td>
                                                                <td className="px-3 py-2.5 font-bold text-white/80">{key.userName || <span className="opacity-20">—</span>}</td>
                                                                <td className="px-3 py-2.5 text-white/40">{key.mobile || <span className="opacity-20">—</span>}</td>
                                                                <td className="px-3 py-2.5 text-[10px] text-amber-300/90 font-bold">{key.version || '2.5.1'}</td>
                                                                <td className="px-3 py-2.5 text-[10px] text-white/50 font-mono" title={(key.deviceIds || []).join(', ')}>{formatDeviceList(key.deviceIds || [])}</td>
                                                                <td className="px-3 py-2.5 text-[10px] text-white/70 font-bold">{key.liveCompaniesCount ?? '—'}</td>
                                                                <td className="px-3 py-2.5 text-[10px]">
                                                                    <div className="leading-tight">
                                                                        <span className="text-sky-300/90">R: {key.usageReads ?? '—'}</span>
                                                                        <span className="text-white/30"> | </span>
                                                                        <span className="text-emerald-300/90">W: {key.usageWrites ?? '—'}</span>
                                                                    </div>
                                                                    <div className="text-white/35">S: {formatStorage(key.usageStorageMb)}</div>
                                                                </td>
                                                                <td className="px-3 py-2.5 text-white/30 text-[10px]">{key.requestedAt ? new Date(key.requestedAt).toLocaleDateString('en-GB') : '—'}</td>
                                                                <td className="px-3 py-2.5 text-[10px]">
                                                                    {key.activatedAt
                                                                        ? <span className="text-emerald-400/80 font-bold">{new Date(key.activatedAt).toLocaleDateString('en-GB')}</span>
                                                                        : <span className="opacity-20">—</span>
                                                                    }
                                                                </td>
                                                                <td className="px-3 py-2.5 text-[10px]">
                                                                    <span className={isExpired ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}>
                                                                        {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString('en-GB') : '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2.5 text-[10px]">
                                                                    <span className={daysColor}>
                                                                        {daysLeft === null ? '—' : daysLeft <= 0 ? 'EXPIRED' : `${daysLeft}d`}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2.5">
                                                                    <div className="flex gap-1">
                                                                        {key.status === 'pending' && (
                                                                            <button disabled={isLoading} onClick={() => handleLicenseAction(key.id, 'approve')} className="text-[9px] bg-green-600/30 hover:bg-green-600/60 text-green-400 px-2 py-1 rounded font-black uppercase">{isLoading ? '...' : '✓ Approve'}</button>
                                                                        )}
                                                                        {key.status === 'pending' && (
                                                                            <button disabled={isLoading} onClick={() => handleLicenseAction(key.id, 'reject')} className="text-[9px] bg-red-600/30 hover:bg-red-600/60 text-red-400 px-2 py-1 rounded font-black uppercase">{isLoading ? '...' : '✗ Reject'}</button>
                                                                        )}
                                                                        {key.status === 'approved' && (
                                                                            <button disabled={isLoading} onClick={() => handleLicenseAction(key.id, 'expire')} className="text-[9px] bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 px-2 py-1 rounded font-black uppercase">{isLoading ? '...' : '⊘ Revoke'}</button>
                                                                        )}
                                                                        {(key.status === 'rejected' || key.status === 'expired' || key.status === 'inactive') && key.email && (
                                                                            <button disabled={isLoading} onClick={() => handleLicenseAction(key.id, 'approve')} className="text-[9px] bg-blue-600/30 hover:bg-blue-600/60 text-blue-400 px-2 py-1 rounded font-black uppercase">{isLoading ? '...' : '↺ Reactivate'}</button>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="bg-white/5 p-3 flex justify-between items-center text-[10px] font-bold text-white/20">
                                        <span>{serialKeys.length} TOTAL KEYS &nbsp;|&nbsp; {serialKeys.filter(k => k.status === 'approved').length} ACTIVE &nbsp;|&nbsp; {serialKeys.filter(k => k.status === 'pending').length} PENDING</span>
                                        <span>DB: nadtally_licenses @ Firebase</span>
                                    </div>
                                </div>
                            )}

                            {/* SUB-TAB: PENDING APPROVALS */}
                            {devSubTab === 'pending' && (
                                <div>
                                    {serialKeys.filter(k => k.status === 'pending').length === 0 ? (
                                        <div className="bg-black/30 border border-white/5 rounded-xl p-16 text-center">
                                            <div className="text-4xl mb-3">✅</div>
                                            <div className="text-white/20 italic font-bold">No pending activation requests.</div>
                                            <div className="text-white/10 text-[10px] mt-1">All licenses are up to date.</div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {serialKeys.filter(k => k.status === 'pending').map(key => {
                                                const waitHours = key.requestedAt ? Math.floor((Date.now() - new Date(key.requestedAt)) / 3600000) : null;
                                                const urgency = waitHours === null ? 'normal' : waitHours > 72 ? 'urgent' : waitHours > 24 ? 'warning' : 'normal';
                                                const urgencyBorder = urgency === 'urgent' ? 'border-red-500/40 bg-red-500/5' : urgency === 'warning' ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-yellow-500/20 bg-yellow-500/5';
                                                const customDays = approvalDaysMap[key.id] || 365;
                                                return (
                                                    <div key={key.id} className={`border rounded-2xl p-5 ${urgencyBorder}`}>
                                                        {/* Header row */}
                                                        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-400 font-black text-lg">
                                                                    {(key.userName || key.email || '?')[0].toUpperCase()}
                                                                </div>
                                                                <div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-mono font-black text-blue-400">{key.id}</span>
                                                                        <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-black uppercase">Pending</span>
                                                                        {urgency === 'urgent' && <span className="text-[9px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-black uppercase animate-pulse">Urgent</span>}
                                                                    </div>
                                                                    {waitHours !== null && <div className="text-[10px] text-white/30 mt-0.5">Waiting: {waitHours}h {waitHours > 24 ? `(${Math.floor(waitHours/24)}d)` : ''}</div>}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Details grid */}
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                                                            <div className="bg-black/30 rounded-lg p-3">
                                                                <div className="text-[9px] text-white/30 uppercase font-bold mb-0.5">Full Name</div>
                                                                <div className="text-[12px] text-white font-bold">{key.userName || <span className="text-white/20">Not provided</span>}</div>
                                                            </div>
                                                            <div className="bg-black/30 rounded-lg p-3">
                                                                <div className="text-[9px] text-white/30 uppercase font-bold mb-0.5">Email Address</div>
                                                                <div className="text-[11px] text-cyan-400 font-bold truncate">{key.email || <span className="text-white/20">—</span>}</div>
                                                            </div>
                                                            <div className="bg-black/30 rounded-lg p-3">
                                                                <div className="text-[9px] text-white/30 uppercase font-bold mb-0.5">Mobile Number</div>
                                                                <div className="text-[12px] text-green-400 font-bold">{key.mobile || <span className="text-white/20">Not provided</span>}</div>
                                                            </div>
                                                            <div className="bg-black/30 rounded-lg p-3">
                                                                <div className="text-[9px] text-white/30 uppercase font-bold mb-0.5">Request Date</div>
                                                                <div className="text-[11px] text-white/60">{key.requestedAt ? new Date(key.requestedAt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}</div>
                                                            </div>
                                                            <div className="bg-black/30 rounded-lg p-3">
                                                                <div className="text-[9px] text-white/30 uppercase font-bold mb-0.5">Device ID</div>
                                                                <div className="text-[10px] text-white/30 font-mono truncate">{key.deviceId ? key.deviceId.slice(0,16)+'...' : <span className="text-white/20">Unknown</span>}</div>
                                                            </div>
                                                            <div className="bg-black/30 rounded-lg p-3">
                                                                <div className="text-[9px] text-white/30 uppercase font-bold mb-0.5">App Version</div>
                                                                <div className="text-[11px] text-white/50">{key.version || '2.5.1'}</div>
                                                            </div>
                                                        </div>

                                                        {/* Approval control panel */}
                                                        <div className="bg-black/20 rounded-xl p-4 flex flex-col md:flex-row gap-4 items-start md:items-center">
                                                            <div className="flex-1">
                                                                <div className="text-[10px] text-white/30 uppercase font-bold mb-2">🗓️ Approval Duration</div>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {[30, 90, 180, 365, 730].map(d => (
                                                                        <button
                                                                            key={d}
                                                                            onClick={() => setApprovalDaysMap(prev => ({ ...prev, [key.id]: d }))}
                                                                            className={`px-3 py-1.5 text-[10px] font-black rounded-lg uppercase transition-all ${
                                                                                customDays === d
                                                                                    ? 'bg-green-600 text-white shadow-lg shadow-green-500/20'
                                                                                    : 'bg-white/5 hover:bg-white/10 text-white/50'
                                                                            }`}
                                                                        >
                                                                            {d === 30 ? '1 Month' : d === 90 ? '3 Months' : d === 180 ? '6 Months' : d === 365 ? '1 Year' : '2 Years'}
                                                                        </button>
                                                                    ))}
                                                                    <div className="flex items-center gap-1 bg-white/5 rounded-lg px-2">
                                                                        <input
                                                                            type="number"
                                                                            min="1" max="3650"
                                                                            value={customDays}
                                                                            onChange={e => setApprovalDaysMap(prev => ({ ...prev, [key.id]: parseInt(e.target.value) || 365 }))}
                                                                            className="w-14 bg-transparent text-[10px] font-black text-white text-center outline-none"
                                                                        />
                                                                        <span className="text-[9px] text-white/30">days</span>
                                                                    </div>
                                                                </div>
                                                                <div className="text-[9px] text-white/20 mt-1.5">
                                                                    Expires: {new Date(Date.now() + customDays * 86400000).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col gap-2">
                                                                <button
                                                                    disabled={approveLoadingId === key.id}
                                                                    onClick={() => handleLicenseAction(key.id, 'approve', customDays)}
                                                                    className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white text-[11px] font-black rounded-xl uppercase tracking-wider shadow-lg shadow-green-500/20 disabled:opacity-50"
                                                                >
                                                                    {approveLoadingId === key.id ? '⏳ Processing...' : `✓ Approve (${customDays}d)`}
                                                                </button>
                                                                <button
                                                                    disabled={approveLoadingId === key.id}
                                                                    onClick={() => handleLicenseAction(key.id, 'reject')}
                                                                    className="px-6 py-2.5 bg-red-900/40 hover:bg-red-800 text-red-300 text-[11px] font-black rounded-xl uppercase tracking-wider disabled:opacity-50"
                                                                >
                                                                    ✗ Reject Request
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* SUB-TAB: GENERATE SERIAL KEY */}
                            {devSubTab === 'generate' && (
                                <div className="max-w-lg">
                                    <div className="bg-black/40 border border-white/10 rounded-xl p-8">
                                        <h4 className="text-lg font-black mb-2">🔑 Generate New Serial Key</h4>
                                        <p className="text-xs text-white/30 mb-6">Creates a blank license slot in the database. Keys follow the format <span className="font-mono text-blue-400">NDTL111, NDTL112, NDTL113...</span> The next available number is auto-detected.</p>

                                        {genKey && genStatus === 'success' && (
                                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-5 mb-6 text-center">
                                                <div className="text-xs text-green-400/60 uppercase font-bold mb-1">New Serial Key Created:</div>
                                                <div className="font-mono text-3xl font-black text-green-400 tracking-widest mb-2">{genKey}</div>
                                                <div className="text-[10px] text-white/30">Status: INACTIVE · Waiting for activation request</div>
                                            </div>
                                        )}
                                        {genStatus && genStatus.startsWith('error') && (
                                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 text-red-400 text-xs">{genStatus}</div>
                                        )}

                                        <div className="bg-white/5 rounded-lg p-4 mb-6">
                                            <div className="text-[10px] text-white/30 uppercase font-bold mb-2">Next key to be generated:</div>
                                            {(() => {
                                                const ndtlKeys = serialKeys.map(k => k.id).filter(id => /^NDTL\d+$/.test(id)).map(id => parseInt(id.replace('NDTL', ''))).sort((a, b) => a - b);
                                                const nextNum = ndtlKeys.length > 0 ? ndtlKeys[ndtlKeys.length - 1] + 1 : 111;
                                                return <div className="font-mono text-2xl font-black text-blue-400">NDTL{nextNum}</div>;
                                            })()}
                                        </div>

                                        <button
                                            onClick={generateNextSerialKey}
                                            disabled={genLoading}
                                            className="w-full py-4 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-black text-sm rounded-xl uppercase tracking-wider transition-all disabled:opacity-50"
                                        >
                                            {genLoading ? <span className="flex items-center justify-center gap-2"><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>Generating...</span> : '🔑 Generate Next Serial Key'}
                                        </button>

                                        <div className="mt-6 border-t border-white/5 pt-5">
                                            <div className="text-[10px] text-white/20 uppercase font-bold mb-3">All NDTL Keys ({serialKeys.filter(k => /^NDTL/.test(k.id)).length})</div>
                                            <div className="flex flex-wrap gap-2">
                                                {serialKeys.filter(k => /^NDTL/.test(k.id)).sort((a, b) => a.id.localeCompare(b.id)).map(k => (
                                                    <span key={k.id} className={`text-[10px] font-mono font-black px-2 py-1 rounded ${
                                                        k.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                                                        k.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                                                        k.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                                                        'bg-white/10 text-white/30'
                                                    }`}>{k.id}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                </div >
            </div >
        </div >
    );
};



const ActionCard = ({ title, desc, onClick, color, disabled }) => {
    const colors = {
        blue: 'hover:border-blue-500/50 bg-blue-500/5 hover:bg-blue-500/10',
        green: 'hover:border-green-500/50 bg-green-500/5 hover:bg-green-500/10',
        purple: 'hover:border-purple-500/50 bg-purple-500/5 hover:bg-purple-500/10',
        orange: 'hover:border-orange-500/50 bg-orange-500/5 hover:bg-orange-500/10',
        teal: 'hover:border-teal-500/50 bg-teal-500/5 hover:bg-teal-500/10',
        red: 'hover:border-red-500/50 bg-red-500/5 hover:bg-red-500/10',
    };

    return (
        <div
            onClick={() => !disabled && onClick && onClick()}
            className={`p-5 rounded-xl border border-white/10 transition-all ${colors[color]} ${disabled ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:-translate-y-1'}`}
        >
            <h4 className="font-bold text-white/90 mb-1">{title}</h4>
            <p className="text-xs text-white/40 leading-relaxed">{desc}</p>
        </div>
    );
};

export default ManagementDashboard;
