/**
 * COMPLETE BACKEND CODE (Restores all deleted functions)
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require('firebase-admin');

// 1. Initialize Admin App
if (admin.apps.length === 0) {
    admin.initializeApp();
}

// ==========================================
// 1. GUEST VIEW FUNCTION (The New Feature)
// ==========================================
// ==========================================
// 1. UNIVERSAL GUEST STATEMENT (Party & Account)
// ==========================================
exports.getPartyStatement = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Access Denied.');

    const { ownerId, targetId, type = 'party' } = request.data;
    const finalId = targetId || request.data.partyId;

    if (!ownerId || !finalId) throw new HttpsError('invalid-argument', 'Missing details.');

    try {
        const db = admin.firestore();

        // 1. FETCH ALL NAMES
        const [accSnap, partySnap, expSnap] = await Promise.all([
            db.collection('accounts').where('userId', '==', ownerId).get(),
            db.collection('parties').where('userId', '==', ownerId).get(),
            db.collection('expenses').where('userId', '==', ownerId).get()
        ]);

        const nameMap = {};
        accSnap.forEach(d => nameMap[d.id] = d.data().name);
        partySnap.forEach(d => nameMap[d.id] = d.data().name);
        expSnap.forEach(d => nameMap[d.id] = d.data().name);

        // 2. GET TARGET ENTITY DETAILS (With Opening Balance)
        let entityData = {};

        if (type === 'account') {
            const doc = await db.collection('accounts').doc(finalId).get();
            if (!doc.exists) throw new HttpsError('not-found', 'Account not found.');
            const d = doc.data();
            entityData = {
                name: d.name,
                mobile: 'Cash/Bank Ledger',
                email: '-',
                address: '-',
                // ✅ SEND OPENING BALANCE
                openingBalance: Number(d.openingBalance || 0)
            };
        } else {
            const doc = await db.collection('parties').doc(finalId).get();
            if (!doc.exists) throw new HttpsError('not-found', 'Customer not found.');
            const d = doc.data();
            entityData = {
                name: d.name,
                mobile: d.mobile,
                email: d.email,
                address: d.address,
                // ✅ SEND OPENING BALANCE
                openingBalance: Number(d.openingBalance || 0)
            };
        }

        // 3. FETCH TRANSACTIONS (Same as before)
        let transactions = [];

        // A. Invoices
        if (type === 'party') {
            const invS = await db.collection('invoices').where('userId', '==', ownerId).where('partyId', '==', finalId).get();
            invS.forEach(doc => {
                const d = doc.data();
                const amt = Number(d.totalAmount || 0);
                transactions.push({
                    id: doc.id, date: d.date, ref: d.refNo || 'INV',
                    type: d.type === 'sales' ? 'SALES INV' : 'PURCHASE INV',
                    drName: d.type === 'sales' ? entityData.name : 'Purchase A/c',
                    crName: d.type === 'sales' ? 'Sales A/c' : entityData.name,
                    debit: d.type === 'sales' ? amt : 0,
                    credit: d.type === 'purchase' ? amt : 0,
                    description: d.narration || '',
                    items: d.items ? d.items.map(i => ({ name: 'Item', qty: i.quantity, rate: i.rate, total: i.total })) : []
                });
            });
        }

        // B. Payments
        let payQueries = [];
        if (type === 'account') {
            payQueries.push(db.collection('payments').where('userId', '==', ownerId).where('accountId', '==', finalId).get());
            payQueries.push(db.collection('payments').where('userId', '==', ownerId).where('toAccountId', '==', finalId).where('type', '==', 'contra').get());
        } else {
            payQueries.push(db.collection('payments').where('userId', '==', ownerId).where('partyId', '==', finalId).get());
        }

        const paySnaps = await Promise.all(payQueries);

        paySnaps.forEach(snap => {
            snap.forEach(doc => {
                const d = doc.data();
                const amt = Number(d.amount || 0);
                let dr = 0, cr = 0, drName = '-', crName = '-';

                let otherName = 'Unknown';
                if (d.type === 'contra') otherName = nameMap[d.toAccountId] || 'Bank';
                else if (d.transactionCategory === 'expense') otherName = nameMap[d.expenseId] || 'Expense';
                else if (d.transactionCategory === 'capital') otherName = 'Capital A/c';
                else if (d.partyId) otherName = nameMap[d.partyId] || 'Party';

                const bankName = nameMap[d.accountId] || 'Cash/Bank';

                if (type === 'party') {
                    if (d.type === 'in') { cr = amt; drName = bankName; crName = entityData.name; }
                    else { dr = amt; drName = entityData.name; crName = bankName; }
                }
                else if (type === 'account') {
                    if (d.accountId === finalId) {
                        if (d.type === 'in') { dr = amt; drName = entityData.name; crName = otherName; }
                        else { cr = amt; drName = otherName; crName = entityData.name; }
                    } else if (d.type === 'contra' && d.toAccountId === finalId) {
                        const fromBank = nameMap[d.accountId] || 'Source Bank';
                        dr = amt; drName = entityData.name; crName = fromBank;
                    }
                }

                transactions.push({
                    id: doc.id, date: d.date, ref: d.refNo || 'PAY',
                    type: d.type === 'in' ? 'RECEIPT' : (d.type === 'contra' ? 'CONTRA' : 'PAYMENT'),
                    drName, crName, debit: dr, credit: cr,
                    description: d.description || '', items: []
                });
            });
        });

        // C. JVs
        const jvDrS = await db.collection('journal_vouchers').where('userId', '==', ownerId).where('drType', '==', type).where('drId', '==', finalId).get();
        const jvCrS = await db.collection('journal_vouchers').where('userId', '==', ownerId).where('crType', '==', type).where('crId', '==', finalId).get();

        jvDrS.forEach(doc => {
            const d = doc.data();
            transactions.push({
                id: doc.id, date: d.date, ref: d.refNo || 'JV', type: 'JOURNAL',
                drName: entityData.name, crName: 'Adjustment',
                debit: Number(d.amount), credit: 0,
                description: d.description, items: []
            });
        });
        jvCrS.forEach(doc => {
            const d = doc.data();
            transactions.push({
                id: doc.id, date: d.date, ref: d.refNo || 'JV', type: 'JOURNAL',
                drName: 'Adjustment', crName: entityData.name,
                debit: 0, credit: Number(d.amount),
                description: d.description, items: []
            });
        });

        transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

        return { party: entityData, transactions };

    } catch (error) {
        console.error("Backend Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

// ==========================================
// 2. USER MANAGEMENT (Restored)
// ==========================================

exports.createSubUser = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { email, password, name, role, mobile } = request.data;
    const callerUid = request.auth.uid;

    try {
        const db = admin.firestore();

        // 1. Verify caller is an Owner (or has no role yet if they are the first user)
        const callerDoc = await db.collection('users').doc(callerUid).get();
        if (callerDoc.exists && callerDoc.data().role && callerDoc.data().role !== 'owner') {
            throw new HttpsError('permission-denied', 'Only Owners can create sub-users.');
        }

        // 2. Create Auth User
        let userRecord;
        try {
            userRecord = await admin.auth().createUser({
                email,
                password,
                displayName: name
            });
        } catch (authError) {
            if (authError.code === 'auth/email-already-exists') {
                throw new HttpsError('already-exists', `⛔ RESTRICTED: The email '${email}' is already registered.\n\nUsage of duplicate email addresses is strictly prohibited.`);
            }
            throw authError;
        }

        // 3. Set Custom Claims (Role + Owner Link)
        // For a sub-user, ownerId is the caller's uid (or the caller's own ownerId if they are an admin?)
        // In this app, the 'owner' is the top person.
        const ownerId = request.auth.token.ownerId || callerUid;
        await admin.auth().setCustomUserClaims(userRecord.uid, { ownerId, role });

        // 4. Create Firestore Profile
        await db.collection('users').doc(userRecord.uid).set({
            name, email, role, ownerId, mobile: mobile || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, uid: userRecord.uid };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', error.message);
    }
});

exports.updateSubUser = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { targetUid, name, role, password, mobile } = request.data;
    const callerUid = request.auth.uid;
    const db = admin.firestore();

    try {
        const targetDoc = await db.collection('users').doc(targetUid).get();
        if (!targetDoc.exists) throw new HttpsError('not-found', 'User record not found.');
        const targetData = targetDoc.data();

        // Security: Caller must be the Owner of the target OR the target themselves
        const isSelf = callerUid === targetUid;
        const isOwner = targetData.ownerId === callerUid || (request.auth.token.ownerId === targetData.ownerId && request.auth.token.role === 'owner');

        if (!isSelf && !isOwner) {
            throw new HttpsError('permission-denied', 'You do not have permission to update this user.');
        }

        // Auth Update
        const authUpdate = {};
        if (name) authUpdate.displayName = name;
        if (password && password.trim().length > 0) authUpdate.password = password;

        if (Object.keys(authUpdate).length > 0) {
            await admin.auth().updateUser(targetUid, authUpdate);
        }

        // Role Update (Only Owners can change roles)
        if (role && isOwner && role !== targetData.role) {
            const user = await admin.auth().getUser(targetUid);
            const currentClaims = user.customClaims || {};
            await admin.auth().setCustomUserClaims(targetUid, { ...currentClaims, role });
        }

        // Firestore Update
        const firestoreUpdate = {};
        if (name) firestoreUpdate.name = name;
        if (mobile !== undefined) firestoreUpdate.mobile = mobile;
        if (role && isOwner) firestoreUpdate.role = role;
        firestoreUpdate.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('users').doc(targetUid).update(firestoreUpdate);

        return { success: true };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', error.message);
    }
});

exports.deleteSubUser = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { targetUid } = request.data;
    const callerUid = request.auth.uid;
    const db = admin.firestore();

    try {
        const targetDoc = await db.collection('users').doc(targetUid).get();
        if (!targetDoc.exists) {
            // Handle ghost users already partially deleted
            try { await admin.auth().deleteUser(targetUid); } catch (e) { }
            return { success: true, message: 'Cleaned up orphan Auth record' };
        }

        const targetData = targetDoc.data();

        // Security: Only the Owner can delete sub-users.
        // Rule: targetData.ownerId must be callerUid
        if (targetData.ownerId !== callerUid) {
            throw new HttpsError('permission-denied', 'Only the Owner of this team can delete users.');
        }

        if (targetUid === callerUid) {
            throw new HttpsError('failed-precondition', 'You cannot delete yourself. Please contact support to close your account.');
        }

        // 1. Delete from Authentication
        try {
            await admin.auth().deleteUser(targetUid);
        } catch (authError) {
            if (authError.code !== 'auth/user-not-found') {
                console.error("Auth Delete Error:", authError);
            }
        }

        // 2. Delete from Firestore
        await db.collection('users').doc(targetUid).delete();

        return { success: true };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', error.message);
    }
});

// ==========================================
// 3. TRANSACTION MANAGEMENT (Restored)
// ==========================================

exports.deleteTransaction = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { id, type } = request.data;
    const db = admin.firestore();

    try {
        // 1. DETERMINE COLLECTION
        let col = 'invoices';
        if (['payment', 'in', 'out', 'contra'].includes(type)) col = 'payments';
        if (type === 'journal') col = 'journal_vouchers';
        if (type === 'manufacturing' || type === 'stock_journal') col = 'stock_journals'; // ✅ MFG SUPPORT

        const docRef = db.collection(col).doc(id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) return { success: true, message: "Already deleted" };

        const data = docSnap.data();
        const batch = db.batch();

        // 2. REVERSE FINANCIAL BALANCES (not applicable to stock journals)
        if (col === 'payments') {
            const amt = Number(data.amount || 0);
            const sourceRef = db.collection('accounts').doc(data.accountId);
            const sourceChange = data.type === 'in' ? -amt : amt;
            batch.update(sourceRef, { balance: admin.firestore.FieldValue.increment(sourceChange) });

            if (!data.isMulti) {
                let targetCol = 'parties';
                let targetId = data.partyId;
                if (data.type === 'contra') { targetCol = 'accounts'; targetId = data.toAccountId; }
                else if (data.transactionCategory === 'expense') { targetCol = 'expenses'; targetId = data.expenseId; }
                else if (data.transactionCategory === 'capital') { targetCol = 'capital_accounts'; targetId = data.capitalId; }
                else if (data.transactionCategory === 'asset') { targetCol = 'asset_accounts'; targetId = data.assetId; }

                if (targetId) {
                    const targetRef = db.collection(targetCol).doc(targetId);
                    let targetChange = data.type === 'in' ? amt : -amt;
                    if (data.transactionCategory === 'expense') targetChange = -amt; // expense is always debit
                    batch.update(targetRef, { balance: admin.firestore.FieldValue.increment(targetChange) });
                }
            }
        }

        if (col === 'invoices') {
            const amt = Number(data.totalAmount || 0);
            const partyRef = db.collection('parties').doc(data.partyId);

            // Reversal logic:
            // Sales (+) -> Deletion (-amt)
            // Purchase (-) -> Deletion (+amt)
            // Credit Note (-) -> Deletion (+amt)
            // Orders (0) -> Deletion (0)

            let change = 0;
            if (data.type === 'sales') change = -amt;
            else if (data.type === 'purchase') change = amt;
            // credit_note is now non-impacting

            if (change !== 0) {
                batch.update(partyRef, { balance: admin.firestore.FieldValue.increment(change) });
            }
        }

        if (col === 'journal_vouchers') {
            const amt = Number(data.amount || 0);
            const getCol = (t) => t === 'party' ? 'parties' : t === 'account' ? 'accounts' : t === 'capital' ? 'capital_accounts' : 'expenses';
            if (data.drId) {
                const ref = db.collection(getCol(data.drType)).doc(data.drId);
                batch.update(ref, { balance: admin.firestore.FieldValue.increment(-amt) });
            }
            if (data.crId) {
                const ref = db.collection(getCol(data.crType)).doc(data.crId);
                batch.update(ref, { balance: admin.firestore.FieldValue.increment(amt) });
            }
        }

        // 3. STOCK/BAG REVERSAL for manufacturing journals
        if (col === 'stock_journals') {
            const ownerId = request.auth.token.ownerId || request.auth.uid;
            const bagDocIds = new Set();

            const bagByIdSnap = await db.collection('jumbo_bags')
                .where('userId', '==', ownerId)
                .where('stockJournalId', '==', id)
                .get();
            bagByIdSnap.forEach((d) => bagDocIds.add(d.id));

            // Backward compatibility for older records that stored stockJournalId as refNo
            if (data.refNo) {
                const bagByRefSnap = await db.collection('jumbo_bags')
                    .where('userId', '==', ownerId)
                    .where('stockJournalId', '==', data.refNo)
                    .get();
                bagByRefSnap.forEach((d) => bagDocIds.add(d.id));
            }

            bagDocIds.forEach((bagId) => {
                batch.delete(db.collection('jumbo_bags').doc(bagId));
            });
        }

        // 4. DELETE DOCUMENT
        batch.delete(docRef);

        await batch.commit();
        return { success: true };

    } catch (error) {
        console.error("Delete Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

// ==========================================
// 4. STOCK RECALCULATION (Restored)
// ==========================================

exports.recalculateStock = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const db = admin.firestore();
    const userId = request.auth.token.ownerId || request.auth.uid;

    try {
        // 1. Reset all products to Opening Stock
        const prodSnap = await db.collection('products').where('userId', '==', userId).get();
        const batch = db.batch();
        const products = {};

        prodSnap.forEach(doc => {
            const d = doc.data();
            products[doc.id] = {
                current: Number(d.openingStock || 0),
                ref: doc.ref
            };
        });

        // 2. Process Invoices (Purchase +, Sales -)
        const invSnap = await db.collection('invoices').where('userId', '==', userId).get();
        invSnap.forEach(doc => {
            const d = doc.data();
            if (d.items && ['purchase', 'sales'].includes(d.type)) {
                d.items.forEach(item => {
                    if (products[item.productId]) {
                        const qty = Number(item.quantity || 0);
                        if (d.type === 'purchase') products[item.productId].current += qty;
                        else if (d.type === 'sales') products[item.productId].current -= qty;
                    }
                });
            }
        });

        // 3. Process Stock Journals (Mfg)
        const sjSnap = await db.collection('stock_journals').where('userId', '==', userId).get();
        sjSnap.forEach(doc => {
            const d = doc.data();
            // Produced (+)
            if (d.produced) d.produced.forEach(item => {
                if (products[item.productId]) products[item.productId].current += Number(item.quantity);
            });
            // Consumed (-)
            if (d.consumed) d.consumed.forEach(item => {
                if (products[item.productId]) products[item.productId].current -= Number(item.quantity);
            });
        });

        // 4. Commit Updates
        let opCount = 0;
        let batchCommit = db.batch();

        for (const [pid, data] of Object.entries(products)) {
            batchCommit.update(data.ref, { currentStock: data.current });
            opCount++;
            if (opCount >= 450) { // Batch limit safety
                await batchCommit.commit();
                batchCommit = db.batch();
                opCount = 0;
            }
        }
        if (opCount > 0) await batchCommit.commit();

        return { success: true };

    } catch (error) {
        throw new HttpsError('internal', error.message);
    }
});

// ==========================================
// 4B. BAG INVENTORY RECALCULATION
// ==========================================

exports.recalculateBagInventory = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const db = admin.firestore();
    const userId = request.auth.token.ownerId || request.auth.uid;

    try {
        const [stockSnap, invSnap, bagSnap] = await Promise.all([
            db.collection('stock_journals').where('userId', '==', userId).get(),
            db.collection('invoices').where('userId', '==', userId).get(),
            db.collection('jumbo_bags').where('userId', '==', userId).get()
        ]);

        const validStockIds = new Set();
        const validStockRefs = new Set();
        stockSnap.forEach((d) => {
            validStockIds.add(d.id);
            const refNo = d.data().refNo;
            if (refNo) validStockRefs.add(refNo);
        });

        const validInvoiceIds = new Set();
        const validInvoiceRefs = new Set();
        invSnap.forEach((d) => {
            validInvoiceIds.add(d.id);
            const refNo = d.data().refNo;
            if (refNo) validInvoiceRefs.add(refNo);
        });

        const deletes = [];
        const updates = [];

        bagSnap.forEach((bagDoc) => {
            const bag = bagDoc.data();

            const hasStockSource = !!bag.stockJournalId;
            const hasPurchaseSource = !!bag.purchaseId;

            if (hasStockSource) {
                const stockKey = bag.stockJournalId;
                const exists = validStockIds.has(stockKey) || validStockRefs.has(stockKey);
                if (!exists) {
                    deletes.push(bagDoc.ref);
                    return;
                }
            }

            if (hasPurchaseSource) {
                const purchaseKey = bag.purchaseId;
                const exists = validInvoiceIds.has(purchaseKey) || validInvoiceRefs.has(purchaseKey);
                if (!exists) {
                    deletes.push(bagDoc.ref);
                    return;
                }
            }

            const salesKey = bag.salesId;
            const hasValidSale = !!salesKey && (validInvoiceIds.has(salesKey) || validInvoiceRefs.has(salesKey));
            const shouldBeSold = hasValidSale;
            const currentStatus = bag.status || 'in_stock';

            if (shouldBeSold) {
                if (currentStatus !== 'sold') {
                    updates.push({ ref: bagDoc.ref, data: { status: 'sold' } });
                }
            } else {
                const updateData = {};
                let needsUpdate = false;

                if (currentStatus !== 'in_stock') {
                    updateData.status = 'in_stock';
                    needsUpdate = true;
                }
                if (bag.salesId) {
                    updateData.salesId = admin.firestore.FieldValue.delete();
                    needsUpdate = true;
                }
                if (bag.soldDate) {
                    updateData.soldDate = admin.firestore.FieldValue.delete();
                    needsUpdate = true;
                }
                if (bag.weightVariance !== undefined) {
                    updateData.weightVariance = admin.firestore.FieldValue.delete();
                    needsUpdate = true;
                }
                if (bag.varianceNote) {
                    updateData.varianceNote = admin.firestore.FieldValue.delete();
                    needsUpdate = true;
                }

                if (needsUpdate) {
                    updates.push({ ref: bagDoc.ref, data: updateData });
                }
            }
        });

        let batch = db.batch();
        let opCount = 0;

        const flush = async () => {
            if (opCount > 0) {
                await batch.commit();
                batch = db.batch();
                opCount = 0;
            }
        };

        for (const ref of deletes) {
            batch.delete(ref);
            opCount++;
            if (opCount >= 450) await flush();
        }

        for (const upd of updates) {
            batch.update(upd.ref, upd.data);
            opCount++;
            if (opCount >= 450) await flush();
        }

        await flush();

        return {
            success: true,
            scanned: bagSnap.size,
            deleted: deletes.length,
            updated: updates.length
        };
    } catch (error) {
        console.error('Bag recalc error:', error);
        throw new HttpsError('internal', error.message);
    }
});

// ==========================================
// 5. COMPANY PROFILE MANAGEMENT
// ==========================================

exports.updateCompanyProfile = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { targetId, data } = request.data;
    await admin.firestore().collection('companies').doc(targetId).set(data, { merge: true });
    return { success: true };
});

exports.getCompanyProfile = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { targetId } = request.data;
    const doc = await admin.firestore().collection('companies').doc(targetId).get();
    return doc.exists ? doc.data() : null;
});

exports.getTeamList = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { ownerId } = request.data;
    if (!ownerId) throw new HttpsError('invalid-argument', 'Owner ID is required.');

    try {
        const db = admin.firestore();
        const snap = await db.collection('users').where('ownerId', '==', ownerId).get();
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Also fetch the owner's own document if it doesn't have ownerId field set
        const ownerDoc = await db.collection('users').doc(ownerId).get();
        if (ownerDoc.exists) {
            const ownerData = { id: ownerDoc.id, ...ownerDoc.data() };
            // Avoid duplicate if owner doc already had ownerId set
            if (!users.find(u => u.id === ownerId)) {
                users.push(ownerData);
            }
        }

        return users;
    } catch (error) {
        throw new HttpsError('internal', error.message);
    }
});
