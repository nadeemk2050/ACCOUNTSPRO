/**
 * COMPLETE BACKEND CODE (Restores all deleted functions)
 */

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const crypto = require('crypto');

const admin = require('firebase-admin');
const cors = require('cors')({ origin: '*' });

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

// ==========================================
// 6. API KEY MANAGEMENT
// ==========================================

exports.generateApiKey = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    
    const { companyId } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Company ID is required.');

    const userId = request.auth.token.ownerId || request.auth.uid;
    const db = admin.firestore();

    const apiKey = crypto.randomBytes(24).toString('hex');
    
    // Store key with a composite ID to allow one key per company
    await db.collection('api_keys').doc(`${userId}_${companyId}`).set({
        apiKey,
        userId,
        companyId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { apiKey };
});

exports.getApiKey = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    
    const { companyId } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Company ID is required.');

    const userId = request.auth.token.ownerId || request.auth.uid;
    const doc = await admin.firestore().collection('api_keys').doc(`${userId}_${companyId}`).get();
    
    return doc.exists ? doc.data() : null;
});

// ==========================================
// 7A. API KEY USAGE DETAILS (for main app monitoring)
// ==========================================

exports.getApiUsageDetails = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { companyId } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Company ID is required.');

    const userId = request.auth.token.ownerId || request.auth.uid;
    const db = admin.firestore();
    const keyDocId = `${userId}_${companyId}`;

    try {
        // Get the API key document
        const keyDoc = await db.collection('api_keys').doc(keyDocId).get();
        if (!keyDoc.exists) {
            return { exists: false, message: 'No API key generated yet.' };
        }

        const keyData = keyDoc.data();

        // Get usage logs for this API key (with index fallback)
        let usageLogs = [];
        try {
            const logsSnap = await db.collection('api_usage_logs')
                .where('apiKey', '==', keyData.apiKey)
                .orderBy('timestamp', 'desc')
                .limit(100)
                .get();
            usageLogs = logsSnap.docs.map(d => ({
                id: d.id,
                deviceInfo: d.data().deviceInfo || 'Unknown',
                deviceName: d.data().deviceName || null,
                ipAddress: d.data().ipAddress || null,
                action: d.data().action || 'query',
                dataSent: d.data().dataSent || 0,
                dataReceived: d.data().dataReceived || 0,
                timestamp: d.data().timestamp?.toMillis?.() || d.data().timestamp || null,
                userAgent: d.data().userAgent || null
            }));
        } catch (indexErr) {
            console.error('Index query failed, trying fallback:', indexErr.message);
            // Fallback: query without ordering
            try {
                const fallbackSnap = await db.collection('api_usage_logs')
                    .where('apiKey', '==', keyData.apiKey)
                    .limit(20)
                    .get();
                usageLogs = fallbackSnap.docs.map(d => ({
                    id: d.id,
                    deviceInfo: d.data().deviceInfo || 'Unknown',
                    deviceName: d.data().deviceName || null,
                    ipAddress: d.data().ipAddress || null,
                    action: d.data().action || 'query',
                    dataSent: d.data().dataSent || 0,
                    dataReceived: d.data().dataReceived || 0,
                    timestamp: d.data().timestamp?.toMillis?.() || d.data().timestamp || null,
                    userAgent: d.data().userAgent || null
                }));
            } catch (fallbackErr) {
                console.error('Fallback query also failed:', fallbackErr.message);
            }
        }

        // Aggregate stats
        const totalRequests = usageLogs.length;
        const totalDataSent = usageLogs.reduce((sum, l) => sum + (l.dataSent || 0), 0);
        const totalDataReceived = usageLogs.reduce((sum, l) => sum + (l.dataReceived || 0), 0);

        // Unique devices
        const uniqueDevices = [...new Set(usageLogs.map(l => l.deviceInfo).filter(Boolean))];

        // First connection time
        const firstConnection = usageLogs.length > 0 ? usageLogs[usageLogs.length - 1].timestamp : null;

        // Latest activity
        const lastConnection = usageLogs.length > 0 ? usageLogs[0].timestamp : null;

        // Get team members for the user dropdown — scan all users (no ownerId field in docs)
        let teamMembers = [];
        try {
            const allUsersSnap = await db.collection('users').limit(50).get();
            allUsersSnap.forEach(d => {
                const data = d.data();
                const role = data.role || data.roleName || null;
                const userName = data.name || data.fullName || data.displayName || null;
                const userEmail = data.email || data.mail || null;
                if (role || userName) {
                    teamMembers.push({
                        id: d.id,
                        name: userName || 'Team Member',
                        email: userEmail || '',
                        role: role || 'member'
                    });
                }
            });
        } catch (e) { /* ignore */ }

        return {
            exists: true,
            apiKey: '*'.repeat(8) + keyData.apiKey.slice(-4), // Masked for display
            createdAt: keyData.createdAt?.toMillis?.() || null,
            usageLogs,
            stats: {
                totalRequests,
                totalDataSent,
                totalDataReceived,
                uniqueDevices: uniqueDevices.length,
                firstConnection,
                lastConnection
            },
            teamMembers,
            companyId
        };
    } catch (error) {
        console.error('getApiUsageDetails error:', error);
        throw new HttpsError('internal', error.message);
    }
});

// ==========================================
// 7. PUBLIC API FOR WIDGETS
// ==========================================

exports.accproApi = onRequest({ cors: true }, async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
        
        if (!apiKey) {
            return res.status(401).json({ error: 'API Key missing' });
        }

        try {
            const db = admin.firestore();
            
            // Find the user and company associated with this API Key
            const keySnap = await db.collection('api_keys').where('apiKey', '==', apiKey).limit(1).get();
            
            if (keySnap.empty) {
                return res.status(403).json({ error: 'Invalid API Key' });
            }

            const keyData = keySnap.docs[0].data();
            const userId = keyData.userId;
            const companyId = keyData.companyId;

            // Log this API request for usage tracking
            try {
                const originalBody = typeof req.body === 'object' ? JSON.stringify(req.body).length : 0;
                const responseHeadersSize = 0; // Will be calculated on response
                const logRef = db.collection('api_usage_logs').doc();
                const logData = {
                    apiKey: apiKey,
                    companyId: companyId,
                    userId: userId,
                    action: req.query.action || req.body?.action || 'query',
                    deviceInfo: req.headers['x-device-info'] || req.headers['user-agent'] || 'Unknown',
                    deviceName: req.headers['x-device-name'] || null,
                    ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null,
                    userAgent: req.headers['user-agent'] || null,
                    dataSent: originalBody,
                    dataReceived: 0, // Updated after response
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                };
                await logRef.set(logData);
                // Store ref so we can update response size later (best effort)
                req._apiLogRef = logRef;
                req._apiLogStart = Date.now();
            } catch (logErr) {
                console.error('Failed to log API usage:', logErr);
                // Non-blocking - don't fail the request
            }

            // Wrap res.json to track response size for usage logging
            const origJson = res.json.bind(res);
            res.json = function(body) {
                const bodyStr = JSON.stringify(body);
                if (req._apiLogRef) {
                    const duration = Date.now() - (req._apiLogStart || Date.now());
                    req._apiLogRef.update({
                        dataReceived: bodyStr.length,
                        responseTime: duration,
                        status: 'success'
                    }).catch(() => {});
                }
                return origJson(body);
            };

            // Fetch company name from the same path as records
            const companyDoc = await db.collection('companies_live').doc(companyId).get();
            const companyName = companyDoc.exists ? (companyDoc.data().name || 'AccountsPro Company') : 'AccountsPro Company';

            const logAuditActivity = async (actionType, docType, refNo, amount, voucherDate, docId, description, snapshotData) => {
                try {
                    const { subUserId, userName } = { ...req.query, ...req.body };
                    const logId = crypto.randomBytes(12).toString('hex');
                    const rawName = userName || 'QuickAccPro User';
                    const subName = rawName.includes('(QAP)') ? rawName : `${rawName} (QAP)`;
                    
                    const logData = {
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        ownerId: companyId,
                        userId: subUserId || userId,
                        userName: subName,
                        action: actionType, // 'CREATED', 'UPDATED', 'DELETED'
                        docType: docType,
                        refNo: refNo || 'N/A',
                        amount: Number(amount || 0),
                        voucherDate: voucherDate || new Date().toISOString().split('T')[0],
                        docId: docId,
                        description: description,
                        snapshotData: snapshotData ? (typeof snapshotData === 'string' ? snapshotData : JSON.stringify(snapshotData)) : ''
                    };

                    // Write to top-level audit_logs (so it's available via direct queries if needed)
                    await db.collection('audit_logs').doc(logId).set(logData);

                    // Write to nested records (so it syncs down to main AccountsPro desktop apps)
                    await db.collection('companies_live').doc(companyId).collection('records').doc(logId).set({
                        id: logId,
                        collectionName: 'audit_logs',
                        syncTimestamp: Date.now(),
                        timestamp: Date.now(),
                        data: logData
                    });
                } catch (logErr) {
                    console.error('Audit log error:', logErr.message);
                }
            };

            const action = req.query.action || 'summary';

            if (action === 'validate_key') {
                // Try to fetch license info for the company
                let licenseInfo = null;
                try {
                    // Find the owner user document to check for license key
                    const ownerDoc = await db.collection('users').doc(userId).get();
                    if (ownerDoc.exists) {
                        const ownerData = ownerDoc.data();
                        const serialKey = ownerData.serialKey || null;
                        if (serialKey) {
                            const licDoc = await db.collection('nadtally_licenses').doc(serialKey).get();
                            if (licDoc.exists) {
                                const l = licDoc.data();
                                licenseInfo = {
                                    serialKey: serialKey,
                                    userName: l.userName || ownerData.name || '',
                                    email: l.email || ownerData.email || '',
                                    status: l.status || 'active',
                                    expiresAt: l.expiresAt?.toMillis?.() || l.expiresAt || null
                                };
                            }
                        }
                    }
                    // Also try companies collection for serialKey
                    if (!licenseInfo) {
                        const coDoc = await db.collection('companies').doc(companyId).get();
                        if (coDoc.exists) {
                            const settings = coDoc.data().settings || {};
                            const serialKey = settings.licenseKey || null;
                            if (serialKey) {
                                const licDoc = await db.collection('nadtally_licenses').doc(serialKey).get();
                                if (licDoc.exists) {
                                    const l = licDoc.data();
                                    licenseInfo = {
                                        serialKey: serialKey,
                                        userName: l.userName || '',
                                        email: l.email || '',
                                        status: l.status || 'active',
                                        expiresAt: l.expiresAt?.toMillis?.() || l.expiresAt || null
                                    };
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('License lookup error:', e.message);
                }

                // Fetch team members count
                let teamCount = 0;
                try {
                    const teamSnap = await db.collection('users').where('ownerId', '==', userId).limit(100).get();
                    teamCount = teamSnap.size;
                } catch (e) { /* ignore */ }

                return res.json({ 
                    success: true, 
                    companyName,
                    companyId,
                    license: licenseInfo,
                    teamCount
                });
            }

            // Helper to query the company's live records
            const getRecords = (colName) => db.collection('companies_live').doc(companyId).collection('records').where('collectionName', '==', colName);

            if (action === 'summary') {
                // Get basic summary for widget from live records
                const [partySnap, accountSnap, paySnap, jvSnap, invoiceSnap] = await Promise.all([
                    getRecords('parties').get(),
                    getRecords('accounts').get(),
                    getRecords('payments').get(),
                    getRecords('journal_vouchers').get(),
                    getRecords('invoices').get()
                ]);

                // Pre-compute account balance adjustments from payments and JVs
                const payAdj = {};
                paySnap.forEach(doc => {
                    const item = doc.data();
                    const d = item.data || {};
                    const amt = Number(d.amount || 0);
                    const acctId = d.accountId;
                    const toAcctId = d.toAccountId;
                    const type = d.type || d.subType || '';
                    if (acctId) {
                        if (type === 'in' || type === 'receipt') payAdj[acctId] = (payAdj[acctId] || 0) + amt;
                        else if (type === 'out' || type === 'payment') payAdj[acctId] = (payAdj[acctId] || 0) - amt;
                        else if (type === 'contra') payAdj[acctId] = (payAdj[acctId] || 0) - amt;
                    }
                    if (type === 'contra' && toAcctId) payAdj[toAcctId] = (payAdj[toAcctId] || 0) + amt;
                });
                jvSnap.forEach(doc => {
                    const item = doc.data();
                    const d = item.data || {};
                    const amt = Number(d.amount || 0);
                    if (d.drType === 'account' && d.drId) payAdj[d.drId] = (payAdj[d.drId] || 0) + amt;
                    if (d.crType === 'account' && d.crId) payAdj[d.crId] = (payAdj[d.crId] || 0) - amt;
                });

                let totalReceivable = 0;
                let totalPayable = 0;
                partySnap.forEach(doc => {
                    const item = doc.data();
                    const bal = item.data?.balance || 0;
                    if (bal > 0) totalReceivable += bal;
                    else totalPayable += Math.abs(bal);
                });

                let cashBankBalance = 0;
                accountSnap.forEach(doc => {
                    const item = doc.data();
                    const accData = item.data || {};
                    const accId = item.id;
                    const openingBal = Number(accData.openingBalance || 0);
                    const adj = payAdj[accId] || 0;
                    cashBankBalance += (openingBal + adj);
                });

                const recentInvoices = invoiceSnap.docs.map(doc => {
                    const item = doc.data();
                    return { id: item.id, ...item.data };
                })
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, 5);

                return res.json({
                    companyId,
                    companyName,
                    totalReceivable,
                    totalPayable,
                    cashBankBalance,
                    recentInvoices
                });
            }

            if (action === 'list_accounts') {
                const snap = await getRecords('accounts').get();
                
                // Fetch transactions to compute dynamic balances, debits, and credits
                const [paySnap, jvSnap, invSnap] = await Promise.all([
                    getRecords('payments').get(),
                    getRecords('journal_vouchers').get(),
                    getRecords('invoices').get()
                ]);

                // Build balance adjustments from transactions
                const stats = {};
                const getStats = (id) => {
                    if (!stats[id]) {
                        stats[id] = { debit: 0, credit: 0 };
                    }
                    return stats[id];
                };

                // 1. Process Invoices (partyId, addlExpCreditId)
                invSnap.forEach(doc => {
                    const item = doc.data();
                    if (item.deleted === true) return;
                    const d = item.data || {};
                    if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                    const rate = Number(d.exchangeRate || 1);
                    const amt = Number(d.grandTotal || d.totalAmount || 0) * rate;

                    if (d.partyId) {
                        const pStats = getStats(d.partyId);
                        if (['sales', 'debit_note', 'purchase_return', 'sales_inv'].includes(d.type)) {
                            pStats.debit += amt;
                        } else if (['purchase', 'credit_note', 'sales_return', 'purchase_inv'].includes(d.type)) {
                            pStats.credit += amt;
                        }
                    }
                    if (d.addlExpCreditId && d.addlExpTotal) {
                        const expAmt = Number(d.addlExpTotal) * rate;
                        getStats(d.addlExpCreditId).credit += expAmt;
                    }
                });

                // 2. Process Payments (accountId, splits, targetId)
                paySnap.forEach(doc => {
                    const item = doc.data();
                    if (item.deleted === true) return;
                    const d = item.data || {};
                    if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                    const rate = Number(d.exchangeRate || 1);
                    const amtBase = Number(d.baseAmount || (d.amount * rate));

                    const srcId = d.accountId || d.sourceId;
                    if (srcId) {
                        const sStats = getStats(srcId);
                        if (d.type === 'in' || d.type === 'receipt') {
                            sStats.debit += amtBase;
                        } else {
                            sStats.credit += amtBase;
                        }
                    }

                    const applyTarget = (id, val, type) => {
                        if (!id) return;
                        const tStats = getStats(id);
                        if (type === 'in' || type === 'receipt') {
                            tStats.credit += val;
                        } else {
                            tStats.debit += val;
                        }
                    };

                    if (d.isMulti && d.splits) {
                        d.splits.forEach(s => {
                            applyTarget(s.targetId, Number(s.amount || 0) * rate, d.type);
                        });
                    } else {
                        let cat = d.transactionCategory;
                        let tid = null;
                        if (cat === 'party') tid = d.partyId;
                        else if (cat === 'expense') tid = d.expenseId;
                        else if (cat === 'account' || d.type === 'contra') { cat = 'account'; tid = d.toAccountId; }
                        else if (cat === 'capital') tid = d.capitalId;
                        else if (cat === 'asset') tid = d.assetId;
                        else if (cat === 'income') tid = d.incomeId;

                        if (tid) applyTarget(tid, amtBase, d.type);
                    }
                });

                // 3. Process Journal Vouchers (drId, crId, rows)
                jvSnap.forEach(doc => {
                    const item = doc.data();
                    if (item.deleted === true) return;
                    const d = item.data || {};
                    if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                    const amt = Number(d.amount || 0);

                    const applyJV = (id, val, mode) => {
                        if (!id) return;
                        const tStats = getStats(id);
                        if (mode === 'dr') {
                            tStats.debit += val;
                        } else {
                            tStats.credit += val;
                        }
                    };

                    if (d.isMulti && d.rows && Array.isArray(d.rows)) {
                        d.rows.forEach(r => {
                            applyJV(r.id, Number(r.amount || 0), r.type);
                        });
                    } else {
                        if (d.drId) applyJV(d.drId, amt, 'dr');
                        if (d.crId) applyJV(d.crId, amt, 'cr');
                    }
                });

                const accounts = snap.docs.map(doc => {
                    const item = doc.data();
                    const accData = item.data || {};
                    const accId = item.id;
                    
                    const openingBal = Number(accData.openingBalance || 0);
                    const s = stats[accId] || { debit: 0, credit: 0 };
                    const dynamicBalance = openingBal + s.debit - s.credit;
                    
                    return {
                        id: accId,
                        ...accData,
                        openingBalance: openingBal,
                        debit: s.debit,
                        credit: s.credit,
                        balance: dynamicBalance,
                        storedBalance: Number(accData.balance || 0)
                    };
                });
                return res.json({ 
                    companyName,
                    accounts 
                });
            }

            if (action === 'check_ref_no') {
                const checkRef = req.query.refNo || req.body?.refNo;
                if (!checkRef) return res.status(400).json({ error: 'refNo required' });
                
                try {
                    const refSnap = await db.collection('payments')
                        .where('userId', '==', companyId)
                        .where('refNo', '==', checkRef)
                        .limit(1)
                        .get();
                    return res.json({ exists: !refSnap.empty });
                } catch (e) {
                    return res.json({ exists: false });
                }
            }

            if (action === 'run_migration') {
                const results = {
                    nestedUpdated: 0,
                    topUpdated: 0,
                    errors: []
                };

                try {
                    // 1. Update nested records in companies_live/{companyId}/records
                    const recordsColl = db.collection('companies_live').doc(companyId).collection('records');
                    const recordsSnap = await recordsColl
                        .where('collectionName', '==', 'payments')
                        .where('data.userId', '==', userId)
                        .get();
                    
                    for (const dDoc of recordsSnap.docs) {
                        try {
                            const docRef = recordsColl.doc(dDoc.id);
                            await docRef.update({
                                'data.userId': companyId,
                                'timestamp': Date.now(),
                                'syncTimestamp': Date.now()
                            });
                            results.nestedUpdated++;
                        } catch (err) {
                            results.errors.push(`Nested doc ${dDoc.id} error: ${err.message}`);
                        }
                    }

                    // 2. Update top-level payments collection
                    const topColl = db.collection('payments');
                    const topSnap = await topColl
                        .where('userId', '==', userId)
                        .get();
                    
                    for (const dDoc of topSnap.docs) {
                        try {
                            const docRef = topColl.doc(dDoc.id);
                            const nestedDoc = await recordsColl.doc(dDoc.id).get();
                            if (nestedDoc.exists) {
                                await docRef.update({
                                    'userId': companyId,
                                    'timestamp': Date.now()
                                });
                                results.topUpdated++;
                            }
                        } catch (err) {
                            results.errors.push(`Top-level doc ${dDoc.id} error: ${err.message}`);
                        }
                    }

                    return res.json({ success: true, results });
                } catch (error) {
                    return res.status(500).json({ error: error.message });
                }
            }

            if (action === 'add_contra') {
                // Support both query and body for flexibility
                const { fromAccountId, toAccountId, amount, date, narration, refNo, subUserId } = { ...req.query, ...req.body };
                if (!fromAccountId || !toAccountId || !amount) {
                    return res.status(400).json({ error: 'Missing required fields: fromAccountId, toAccountId, amount' });
                }

                const db = admin.firestore();

                // Duplicate refNo check
                if (refNo) {
                    const dupSnap = await db.collection('payments')
                        .where('userId', '==', companyId)
                        .where('refNo', '==', refNo)
                        .limit(1)
                        .get();
                    if (!dupSnap.empty) {
                        return res.status(409).json({ error: `Reference number "${refNo}" already exists.` });
                    }
                }

                const amt = Number(amount);
                const recordsCol = db.collection('companies_live').doc(companyId).collection('records');

                try {
                    const [fromSnap, toSnap] = await Promise.all([
                        recordsCol.doc(fromAccountId).get(),
                        recordsCol.doc(toAccountId).get()
                    ]);

                    if (!fromSnap.exists || !toSnap.exists) {
                        throw new Error('One or both accounts not found');
                    }

                    // Find top-level account IDs
                    let topFromAccountId = null;
                    const fromAccDoc = await db.collection('accounts').doc(fromAccountId).get();
                    if (fromAccDoc.exists) {
                        topFromAccountId = fromAccountId;
                    } else {
                        const nestedFromAcc = fromSnap.data()?.data;
                        if (nestedFromAcc?.name) {
                            const q = await db.collection('accounts')
                                .where('userId', '==', companyId)
                                .where('name', '==', nestedFromAcc.name)
                                .limit(1)
                                .get();
                            if (!q.empty) topFromAccountId = q.docs[0].id;
                        }
                    }

                    let topToAccountId = null;
                    const toAccDoc = await db.collection('accounts').doc(toAccountId).get();
                    if (toAccDoc.exists) {
                        topToAccountId = toAccountId;
                    } else {
                        const nestedToAcc = toSnap.data()?.data;
                        if (nestedToAcc?.name) {
                            const q = await db.collection('accounts')
                                .where('userId', '==', companyId)
                                .where('name', '==', nestedToAcc.name)
                                .limit(1)
                                .get();
                            if (!q.empty) topToAccountId = q.docs[0].id;
                        }
                    }

                    await db.runTransaction(async (transaction) => {
                        // Update balances
                        transaction.update(recordsCol.doc(fromAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(-amt),
                            'syncTimestamp': Date.now(),
                            'timestamp': Date.now()
                        });
                        transaction.update(recordsCol.doc(toAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(amt),
                            'syncTimestamp': Date.now(),
                            'timestamp': Date.now()
                        });

                        if (topFromAccountId) {
                            transaction.update(db.collection('accounts').doc(topFromAccountId), {
                                'balance': admin.firestore.FieldValue.increment(-amt),
                                'timestamp': Date.now()
                            });
                        }
                        if (topToAccountId) {
                            transaction.update(db.collection('accounts').doc(topToAccountId), {
                                'balance': admin.firestore.FieldValue.increment(amt),
                                'timestamp': Date.now()
                            });
                        }

                        // Create the payment record
                        const newId = crypto.randomBytes(12).toString('hex');
                        const contraData = {
                            type: 'contra',
                            accountId: fromAccountId,
                            toAccountId: toAccountId,
                            amount: amt,
                            date: date || new Date().toISOString().split('T')[0],
                            description: narration || '',
                            refNo: refNo || '',
                            userId: companyId,
                            createdBy: subUserId || userId,
                            status: 'active',
                            version: 'v2'
                        };

                        transaction.set(recordsCol.doc(newId), {
                            id: newId,
                            collectionName: 'payments',
                            syncTimestamp: Date.now(),
                            timestamp: Date.now(),
                            data: contraData
                        });

                        transaction.set(db.collection('payments').doc(newId), {
                            ...contraData,
                            id: newId,
                            timestamp: Date.now()
                        });
                    });

                    // Create audit log for contra (best-effort)
                    const snapshot = {
                        date: date || new Date().toISOString().split('T')[0],
                        type: 'contra',
                        refNo: refNo || 'N/A',
                        amount: amt,
                        accountId: fromAccountId,
                        toAccountId: toAccountId,
                        narration: narration || ''
                    };
                    await logAuditActivity(
                        'CREATED',
                        'Contra Voucher',
                        refNo || 'N/A',
                        amt,
                        date,
                        newId,
                        `CREATED Contra Voucher: transfer of ${amt} via QuickAccPro`,
                        snapshot
                    );

                    return res.json({ success: true });
                } catch (error) {
                    return res.status(400).json({ error: error.message });
                }
            }

            if (action === 'list_ledgers') {
                const [partySnap, expSnap, assetSnap, paySnap, jvSnap, invSnap] = await Promise.all([
                    getRecords('parties').get(),
                    getRecords('expenses').get(),
                    getRecords('asset_accounts').get(),
                    getRecords('payments').get(),
                    getRecords('journal_vouchers').get(),
                    getRecords('invoices').get()
                ]);

                // Build balance adjustments from transactions
                const stats = {};
                const getStats = (id) => {
                    if (!stats[id]) {
                        stats[id] = { debit: 0, credit: 0 };
                    }
                    return stats[id];
                };

                // 1. Process Invoices (partyId, addlExpCreditId)
                invSnap.forEach(doc => {
                    const item = doc.data();
                    if (item.deleted === true) return;
                    const d = item.data || {};
                    if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                    const rate = Number(d.exchangeRate || 1);
                    const amt = Number(d.grandTotal || d.totalAmount || 0) * rate;

                    if (d.partyId) {
                        const pStats = getStats(d.partyId);
                        if (['sales', 'debit_note', 'purchase_return', 'sales_inv'].includes(d.type)) {
                            pStats.debit += amt;
                        } else if (['purchase', 'credit_note', 'sales_return', 'purchase_inv'].includes(d.type)) {
                            pStats.credit += amt;
                        }
                    }
                    if (d.addlExpCreditId && d.addlExpTotal) {
                        const expAmt = Number(d.addlExpTotal) * rate;
                        getStats(d.addlExpCreditId).credit += expAmt;
                    }
                });

                // 2. Process Payments (accountId, splits, targetId)
                paySnap.forEach(doc => {
                    const item = doc.data();
                    if (item.deleted === true) return;
                    const d = item.data || {};
                    if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                    const rate = Number(d.exchangeRate || 1);
                    const amtBase = Number(d.baseAmount || (d.amount * rate));

                    const srcId = d.accountId || d.sourceId;
                    if (srcId) {
                        const sStats = getStats(srcId);
                        if (d.type === 'in' || d.type === 'receipt') {
                            sStats.debit += amtBase;
                        } else {
                            sStats.credit += amtBase;
                        }
                    }

                    const applyTarget = (id, val, type) => {
                        if (!id) return;
                        const tStats = getStats(id);
                        if (type === 'in' || type === 'receipt') {
                            tStats.credit += val;
                        } else {
                            tStats.debit += val;
                        }
                    };

                    if (d.isMulti && d.splits) {
                        d.splits.forEach(s => {
                            applyTarget(s.targetId, Number(s.amount || 0) * rate, d.type);
                        });
                    } else {
                        let cat = d.transactionCategory;
                        let tid = null;
                        if (cat === 'party') tid = d.partyId;
                        else if (cat === 'expense') tid = d.expenseId;
                        else if (cat === 'account' || d.type === 'contra') { cat = 'account'; tid = d.toAccountId; }
                        else if (cat === 'capital') tid = d.capitalId;
                        else if (cat === 'asset') tid = d.assetId;
                        else if (cat === 'income') tid = d.incomeId;

                        if (tid) applyTarget(tid, amtBase, d.type);
                    }
                });

                // 3. Process Journal Vouchers (drId, crId, rows)
                jvSnap.forEach(doc => {
                    const item = doc.data();
                    if (item.deleted === true) return;
                    const d = item.data || {};
                    if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                    const amt = Number(d.amount || 0);

                    const applyJV = (id, val, mode) => {
                        if (!id) return;
                        const tStats = getStats(id);
                        if (mode === 'dr') {
                            tStats.debit += val;
                        } else {
                            tStats.credit += val;
                        }
                    };

                    if (d.isMulti && d.rows && Array.isArray(d.rows)) {
                        d.rows.forEach(r => {
                            applyJV(r.id, Number(r.amount || 0), r.type);
                        });
                    } else {
                        if (d.drId) applyJV(d.drId, amt, 'dr');
                        if (d.crId) applyJV(d.crId, amt, 'cr');
                    }
                });

                const ledgers = [];
                const addLedger = (doc, collectionName) => {
                    const item = doc.data();
                    const dData = item.data || {};
                    const id = item.id || doc.id;
                    const openingBal = Number(dData.openingBalance || 0);
                    const s = stats[id] || { debit: 0, credit: 0 };
                    const dynamicBalance = openingBal + s.debit - s.credit;

                    ledgers.push({
                        id: id,
                        collection: collectionName,
                        name: dData.name || 'Unknown',
                        openingBalance: openingBal,
                        debit: s.debit,
                        credit: s.credit,
                        balance: dynamicBalance,
                        storedBalance: Number(dData.balance || 0),
                        group: dData.group || 'Primary'
                    });
                };

                partySnap.forEach(d => addLedger(d, 'parties'));
                expSnap.forEach(d => addLedger(d, 'expenses'));
                assetSnap.forEach(d => addLedger(d, 'asset_accounts'));

                return res.json({ ledgers });
            }

            if (action === 'list_party_invoices') {
                const partyId = req.query.partyId || req.body.partyId;
                if (!partyId) return res.status(400).json({ error: 'Party ID required' });
                
                const invSnap = await getRecords('invoices')
                    .where('data.partyId', '==', partyId)
                    .get();
                
                const invoices = invSnap.docs.map(doc => {
                    const d = doc.data().data;
                    const total = d.totalAmount || 0;
                    const paid = d.paidAmount || 0;
                    return {
                        id: doc.id,
                        refNo: d.refNo || 'INV',
                        date: d.date,
                        totalAmount: total,
                        paidAmount: paid,
                        remainingAmount: total - paid,
                        type: d.type
                    };
                });
                
                return res.json({ invoices });
            }

            if (action === 'list_daybook') {
                // Fetch all transaction types from live records
                const limitParam = req.query.limit || req.body?.limit || '50';
                const limit = limitParam === 'all' ? 100000 : Math.min(parseInt(limitParam), 100000);
                const types = ['invoices', 'payments', 'journal_vouchers'];
                
                const allSnaps = await Promise.all(
                    types.map(col => getRecords(col).get())
                );

                const transactions = [];
                const nameMap = new Map();

                // Build name map from parties, accounts, expenses, asset_accounts, capital_accounts
                const [partySnap, accSnap, expSnap, assetSnap, capSnap] = await Promise.all([
                    getRecords('parties').get(),
                    getRecords('accounts').get(),
                    getRecords('expenses').get(),
                    getRecords('asset_accounts').get(),
                    getRecords('capital_accounts').get()
                ]);
                partySnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Party'));
                accSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Account'));
                expSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Expense'));
                assetSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Asset'));
                capSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Capital'));

                allSnaps.forEach((snap, idx) => {
                    snap.forEach(doc => {
                        const item = doc.data();
                        if (item.deleted === true) return;
                        const d = item.data || {};
                        if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                        let drName = nameMap.get(d.drAccountId || d.drId) || d.drName || '';
                        let crName = nameMap.get(d.crAccountId || d.crId) || d.crName || '';

                        if (types[idx] === 'payments') {
                            const bankName = nameMap.get(d.accountId) || d.accountName || '';
                            let otherName = 'Party';
                            
                            const toAccId = d.toAccountId || (d.splits && d.splits[0] && d.splits[0].targetId) || '';
                            
                            if (d.transactionCategory === 'expense') otherName = nameMap.get(d.expenseId) || 'Expense';
                            else if (d.transactionCategory === 'capital') otherName = 'Capital A/c';
                            else if (d.transactionCategory === 'asset') otherName = nameMap.get(d.assetId) || 'Asset';
                            else if (d.transactionCategory === 'income') otherName = nameMap.get(d.incomeId) || 'Income';
                            else if (d.partyId) otherName = nameMap.get(d.partyId) || 'Party';
                            else if (toAccId) otherName = nameMap.get(toAccId) || 'Bank';

                            if (d.isMulti && d.splits && d.splits.length > 0) {
                                const targetNames = d.splits.map(s => nameMap.get(s.targetId)).filter(Boolean);
                                if (targetNames.length > 0) {
                                    otherName = targetNames.join(', ');
                                }
                            }

                            if (d.type === 'in' || d.type === 'receipt') {
                                drName = bankName;
                                crName = otherName;
                            } else {
                                drName = otherName;
                                crName = bankName;
                            }
                        } else if (types[idx] === 'journal_vouchers' && d.isMulti && Array.isArray(d.rows)) {
                            const drNames = d.rows.filter(r => r.type === 'dr').map(r => nameMap.get(r.id)).filter(Boolean);
                            const crNames = d.rows.filter(r => r.type === 'cr').map(r => nameMap.get(r.id)).filter(Boolean);
                            drName = drNames.join(', ');
                            crName = crNames.join(', ');
                        }

                        let amount = 0;
                        const rate = Number(d.exchangeRate || 1);
                        if (types[idx] === 'invoices') {
                            amount = Number(d.grandTotal || d.totalAmount || 0) * rate;
                        } else if (types[idx] === 'payments') {
                            amount = Number(d.baseAmount || (d.amount * rate));
                        } else if (types[idx] === 'journal_vouchers') {
                            amount = Number(d.amount || 0);
                        }

                        let splits = null;
                        if (types[idx] === 'payments' && d.isMulti && d.splits) {
                            splits = d.splits.map(s => ({
                                targetId: s.targetId,
                                targetName: nameMap.get(s.targetId) || '',
                                amount: Number(s.amount || 0) * rate
                            }));
                        } else if (types[idx] === 'journal_vouchers' && d.isMulti && Array.isArray(d.rows)) {
                            splits = d.rows.map(r => ({
                                targetId: r.id,
                                targetName: nameMap.get(r.id) || '',
                                amount: Number(r.amount || 0),
                                type: r.type
                            }));
                        }

                        transactions.push({
                            id: item.id || doc.id,
                            type: types[idx],
                            date: d.date || '',
                            refNo: d.refNo || d.invoiceNo || '',
                            amount: amount,
                            description: d.description || d.narration || d.particulars || '',
                            accountName: nameMap.get(d.accountId || d.partyId) || d.accountName || '',
                            partyName: nameMap.get(d.partyId || d.ledgerId) || d.partyName || '',
                            drName,
                            crName,
                            subType: d.type || d.voucherType || '',
                            status: d.status || 'active',
                            syncTimestamp: item.syncTimestamp || 0,
                            isMulti: d.isMulti || false,
                            splits: splits,
                            createdBy: d.createdBy || ''
                        });
                    });
                });

                // Sort by date descending, then by syncTimestamp
                transactions.sort((a, b) => {
                    const dateCmp = (b.date || '').localeCompare(a.date || '');
                    if (dateCmp !== 0) return dateCmp;
                    return (b.syncTimestamp || 0) - (a.syncTimestamp || 0);
                });

                return res.json({
                    companyName,
                    transactions: transactions.slice(0, limit),
                    total: transactions.length
                });
            }

            if (action === 'list_team') {
                let team = [];
                const seen = new Set();
                
                // Strategy 1: Get users where ownerId matches userId or companyId
                const searchIds = [...new Set([userId, companyId].filter(Boolean))];
                for (const sid of searchIds) {
                    try {
                        const snap = await db.collection('users').where('ownerId', '==', sid).get();
                        snap.forEach(d => {
                            if (!seen.has(d.id)) {
                                seen.add(d.id);
                                team.push({ id: d.id, name: d.data().name, email: d.data().email, role: d.data().role });
                            }
                        });
                    } catch (e) { /* ignore */ }
                }

                // Strategy 2: Include the owner's own doc
                for (const sid of searchIds) {
                    try {
                        const ownerDoc = await db.collection('users').doc(sid).get();
                        if (ownerDoc.exists && !seen.has(sid)) {
                            const d = ownerDoc.data();
                            seen.add(sid);
                            team.unshift({ id: sid, name: d.name || 'Owner', email: d.email, role: 'owner' });
                        }
                    } catch (e) { /* ignore */ }
                }

                // Strategy 3: Get offline-created team members synced under companies_live/{companyId}/records
                if (companyId) {
                    try {
                        const localUsersSnap = await db.collection('companies_live')
                            .doc(companyId)
                            .collection('records')
                            .where('collectionName', '==', 'users')
                            .get();
                        
                        localUsersSnap.forEach(d => {
                            const docData = d.data();
                            const userData = docData.data || {};
                            const memberId = docData.id || d.id;
                            if (!seen.has(memberId)) {
                                seen.add(memberId);
                                team.push({
                                    id: memberId,
                                    name: userData.name,
                                    email: userData.email || userData.name,
                                    role: userData.role || 'member'
                                });
                            }
                        });
                    } catch (e) { /* ignore */ }
                }

                return res.json({ team, companyName });
            }

            if (action === 'verify_team_login') {
                const { username, password } = { ...req.query, ...req.body };
                if (!username || !password) return res.status(400).json({ error: 'Username and Password required' });

                const db = admin.firestore();
                const inputName = username.trim();
                
                // Strategy 1: Find user by name directly (no ownerId filter first)
                // Then validate they belong to this company
                let userSnap = await db.collection('users')
                    .where('name', '==', inputName)
                    .limit(5)
                    .get();
                
                if (userSnap.empty) {
                    // Try lowercase match (Firestore is case-sensitive)
                    userSnap = await db.collection('users')
                        .where('name', '==', inputName.toLowerCase())
                        .limit(5)
                        .get();
                }
                
                if (userSnap.empty) {
                    // Try email match
                    userSnap = await db.collection('users')
                        .where('email', '==', inputName)
                        .limit(5)
                        .get();
                }

                let foundUserData = null;
                let foundUserId = null;

                // Check each result — does it belong to this company?
                for (const doc of userSnap.docs) {
                    const data = doc.data();
                    // Belongs if: ownerId matches userId OR ownerId matches companyId OR doc id matches userId
                    if (data.ownerId === userId || data.ownerId === companyId || doc.id === userId || doc.id === companyId) {
                        foundUserData = data;
                        foundUserId = doc.id;
                        break;
                    }
                }

                // Strategy 3: Check in companies_live/{companyId}/records where collectionName == 'users'
                if (!foundUserData && companyId) {
                    try {
                        const localUsersSnap = await db.collection('companies_live')
                            .doc(companyId)
                            .collection('records')
                            .where('collectionName', '==', 'users')
                            .get();
                        
                        for (const doc of localUsersSnap.docs) {
                            const docData = doc.data();
                            const userData = docData.data || {};
                            const name = userData.name || '';
                            const email = userData.email || '';
                            if (name.toLowerCase() === inputName.toLowerCase() || email.toLowerCase() === inputName.toLowerCase()) {
                                foundUserData = userData;
                                foundUserId = docData.id || doc.id;
                                break;
                            }
                        }
                    } catch (e) { /* ignore */ }
                }

                // Strategy 2: Check if the user IS the owner (by userId or companyId direct doc lookup)
                if (!foundUserData) {
                    const potentialIds = [...new Set([userId, companyId].filter(Boolean))];
                    for (const pid of potentialIds) {
                        const ownerDoc = await db.collection('users').doc(pid).get();
                        if (ownerDoc.exists) {
                            const d = ownerDoc.data();
                            if (d.name === inputName || d.email === inputName || d.name?.toLowerCase() === inputName.toLowerCase()) {
                                const storedPassword = d.password || d.teamPassword || '';
                                if (password === storedPassword) {
                                    return res.json({ 
                                        success: true, 
                                        user: { id: pid, name: d.name || 'Owner', role: 'owner' } 
                                    });
                                } else {
                                    return res.status(401).json({ error: 'Invalid password' });
                                }
                            }
                        }
                    }
                    return res.status(401).json({ error: `User "${inputName}" not found. Check the name in Manage Team and ensure they belong to this company.` });
                }
                
                const storedPassword = foundUserData.password || foundUserData.teamPassword || '';
                
                if (password !== storedPassword) {
                    return res.status(401).json({ error: 'Invalid password' });
                }

                return res.json({ 
                    success: true, 
                    user: { id: foundUserId, name: foundUserData.name, role: foundUserData.role || 'member' } 
                });
            }

            if (action === 'add_payment') {
                let { accountId, payments, date, narration, refNo, subUserId, type, userName } = { ...req.query, ...req.body };
                // type: 'in' for receipt (bank +, ledgers -), 'out' for payment (bank -, ledgers +), default 'out'
                const vtype = (type || 'out').toLowerCase();
                
                if (typeof payments === 'string') {
                    try { payments = JSON.parse(payments); } catch (e) { }
                }

                if (!accountId || !payments || !Array.isArray(payments) || payments.length === 0) {
                    return res.status(400).json({ error: 'Missing required fields: accountId, payments (array)' });
                }

                const db = admin.firestore();

                // Duplicate refNo check
                if (refNo) {
                    const dupSnap = await db.collection('payments')
                        .where('userId', '==', companyId)
                        .where('refNo', '==', refNo)
                        .limit(1)
                        .get();
                    if (!dupSnap.empty) {
                        return res.status(409).json({ error: `Reference number "${refNo}" already exists.` });
                    }
                }

                const recordsCol = db.collection('companies_live').doc(companyId).collection('records');

                try {
                    // FETCH NESTED (Source of Truth)
                    const uniqueLedgerIds = [...new Set(payments.map(p => p.ledgerId))];
                    const uniqueAgainstIds = [...new Set(payments.filter(p => p.againstId).map(p => p.againstId))];

                    const [ledgerSnaps, againstSnaps, sourceAccSnap] = await Promise.all([
                        Promise.all(uniqueLedgerIds.map(id => recordsCol.doc(id).get())),
                        Promise.all(uniqueAgainstIds.map(id => recordsCol.doc(id).get())),
                        recordsCol.doc(accountId).get()
                    ]);

                    if (!sourceAccSnap.exists) throw new Error('Source account not found');
                    ledgerSnaps.forEach((snap, idx) => { if (!snap.exists) throw new Error(`Ledger ${uniqueLedgerIds[idx]} not found`); });

                    // FETCH TOP-LEVEL MIRRORS (Using queries for better matching)
                    const topInvoiceIds = {};
                    for (const p of payments) {
                        if (p.againstId && p.againstRef) {
                            const q = await db.collection('invoices')
                                .where('userId', '==', companyId)
                                .where('refNo', '==', p.againstRef)
                                .limit(1).get();
                            if (!q.empty) topInvoiceIds[p.againstId] = q.docs[0].id;
                        }
                    }

                    const topPartyIds = {};
                    for (const p of payments) {
                        if (p.ledgerId) {
                            // Try ID match first
                            const d = await db.collection('parties').doc(p.ledgerId).get();
                            if (d.exists) { topPartyIds[p.ledgerId] = p.ledgerId; }
                            else {
                                // Try Name match
                                const nestedData = ledgerSnaps.find(s => s.id === p.ledgerId)?.data()?.data;
                                if (nestedData?.name) {
                                    const q = await db.collection('parties').where('userId', '==', companyId).where('name', '==', nestedData.name).limit(1).get();
                                    if (!q.empty) topPartyIds[p.ledgerId] = q.docs[0].id;
                                }
                            }
                        }
                    }

                    // Source Account Mirror
                    let topAccountId = null;
                    const accDoc = await db.collection('accounts').doc(accountId).get();
                    if (accDoc.exists) { topAccountId = accountId; }
                    else {
                        const nestedAcc = sourceAccSnap.data()?.data;
                        if (nestedAcc?.name) {
                            const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', nestedAcc.name).limit(1).get();
                            if (!q.empty) topAccountId = q.docs[0].id;
                        }
                    }

                    let totalVoucherAmount = 0;
                    const createdIds = [];
                    await db.runTransaction(async (transaction) => {
                        // Determine balance direction based on voucher type
                        // 'out' (payment): bank -, ledgers +
                        // 'in' (receipt): bank +, ledgers -
                        const ledgerMultiplier = vtype === 'in' ? -1 : 1;
                        const bankMultiplier = vtype === 'in' ? 1 : -1;

                        for (const p of payments) {
                            const { ledgerId, ledgerCollection, amount, againstId, againstRef, category } = p;
                            const amt = Number(amount);
                            totalVoucherAmount += amt;

                            // 1. UPDATE NESTED RECORD (ledger balance)
                            transaction.update(recordsCol.doc(ledgerId), {
                                'data.balance': admin.firestore.FieldValue.increment(amt * ledgerMultiplier),
                                'syncTimestamp': Date.now(),
                                'timestamp': Date.now()
                            });

                            // 2. UPDATE TOP-LEVEL MIRROR
                            const topId = topPartyIds[ledgerId];
                            const topLedgerCol = ledgerCollection === 'parties' ? 'parties' : 
                                               ledgerCollection === 'expenses' ? 'expenses' : 
                                               ledgerCollection === 'asset_accounts' ? 'accounts' : null;
                            
                            if (topLedgerCol && topId) {
                                transaction.update(db.collection(topLedgerCol).doc(topId), {
                                    'balance': admin.firestore.FieldValue.increment(amt * ledgerMultiplier),
                                    'timestamp': Date.now()
                                });
                            }

                            if (againstId) {
                                // 3. UPDATE NESTED INVOICE
                                transaction.update(recordsCol.doc(againstId), {
                                    'data.paidAmount': admin.firestore.FieldValue.increment(amt),
                                    'data.remainingAmount': admin.firestore.FieldValue.increment(-amt),
                                    'syncTimestamp': Date.now(),
                                    'timestamp': Date.now()
                                });

                                // 4. UPDATE TOP-LEVEL INVOICE
                                const tInvId = topInvoiceIds[againstId];
                                if (tInvId) {
                                    transaction.update(db.collection('invoices').doc(tInvId), {
                                        'paidAmount': admin.firestore.FieldValue.increment(amt),
                                        'remainingAmount': admin.firestore.FieldValue.increment(-amt),
                                        'timestamp': Date.now()
                                    });
                                }
                            }

                            // Payment Record
                            const newId = crypto.randomBytes(12).toString('hex');
                            createdIds.push(newId);
                            const targetKey = ledgerCollection === 'parties' ? 'partyId' : ledgerCollection === 'expenses' ? 'expenseId' : 'assetId';
                            const targetCategory = ledgerCollection === 'parties' ? 'party' : ledgerCollection === 'expenses' ? 'expense' : 'asset';

                            const paymentData = {
                                type: vtype === 'in' ? 'in' : 'out', 
                                transactionCategory: targetCategory,
                                accountId: accountId,
                                [targetKey]: ledgerId,
                                amount: amt,
                                date: date || new Date().toISOString().split('T')[0],
                                description: narration || '',
                                refNo: refNo || '',
                                againstId: againstId || null,
                                againstRef: againstRef || null,
                                invoiceId: againstId || null,
                                invoiceRef: againstRef || null,
                                billId: againstId || null,
                                billRef: againstRef || null,
                                isAgainstRef: !!againstId,
                                paymentAgainst: againstId ? { id: againstId, ref: againstRef, amount: amt } : null,
                                paymentCategory: category || 'normal',
                                isMulti: payments.length > 1,
                                userId: companyId,
                                createdBy: subUserId || userId,
                                status: 'active',
                                version: 'v2',
                                apiSource: 'accpro-multi-pay'
                            };

                            transaction.set(recordsCol.doc(newId), {
                                id: newId, collectionName: 'payments', syncTimestamp: Date.now(), timestamp: Date.now(), data: paymentData
                            });

                            transaction.set(db.collection('payments').doc(newId), { ...paymentData, id: newId, timestamp: Date.now() });
                        }

                        // Update Bank (use bankMultiplier for direction)
                        transaction.update(recordsCol.doc(accountId), {
                            'data.balance': admin.firestore.FieldValue.increment(totalVoucherAmount * bankMultiplier),
                            'syncTimestamp': Date.now(), 'timestamp': Date.now()
                        });

                        if (topAccountId) {
                            transaction.update(db.collection('accounts').doc(topAccountId), {
                                'balance': admin.firestore.FieldValue.increment(totalVoucherAmount * bankMultiplier), 'timestamp': Date.now()
                            });
                        }
                    });

                    // Create audit log (best-effort, outside transaction)
                    try {
                        const firstPayment = payments[0] || {};
                        const snapshot = {
                            date: date || new Date().toISOString().split('T')[0],
                            type: vtype === 'in' ? 'receipt' : 'payment',
                            refNo: refNo || 'N/A',
                            amount: totalVoucherAmount,
                            accountId: accountId,
                            narration: narration || '',
                            splits: payments.map(p => ({
                                category: p.ledgerCollection === 'parties' ? 'party' : p.ledgerCollection === 'expenses' ? 'expense' : 'asset',
                                targetId: p.ledgerId,
                                amount: p.amount
                            }))
                        };
                        if (payments.length === 1) {
                            if (firstPayment.ledgerCollection === 'parties') {
                                snapshot.partyId = firstPayment.ledgerId;
                            } else if (firstPayment.ledgerCollection === 'expenses') {
                                snapshot.expenseId = firstPayment.ledgerId;
                            }
                        }

                        await logAuditActivity(
                            'CREATED',
                            vtype === 'in' ? 'Receipt Voucher' : 'Payment Voucher',
                            refNo || 'N/A',
                            totalVoucherAmount,
                            date,
                            createdIds[0] || `quickaccpro-${refNo || Date.now()}`,
                            `CREATED ${vtype === 'in' ? 'Receipt' : 'Payment'} Voucher: total of ${totalVoucherAmount} via QuickAccPro`,
                            snapshot
                        );
                    } catch (logErr) {
                        console.error('Audit log error:', logErr.message);
                    }

                    return res.json({ success: true });
                } catch (error) {
                    return res.status(400).json({ error: error.message });
                }
            }

            if (action === 'get_voucher') {
                const voucherId = req.query.voucherId || req.body?.voucherId;
                if (!voucherId) return res.status(400).json({ error: 'Voucher ID is required' });

                const recordsCol = db.collection('companies_live').doc(companyId).collection('records');
                const doc = await recordsCol.doc(voucherId).get();
                if (!doc.exists) {
                    return res.status(404).json({ error: 'Voucher not found' });
                }

                const docData = doc.data();
                const recordData = docData.data || {};

                if (docData.collectionName === 'payments' && recordData.type !== 'contra' && recordData.refNo) {
                    // Group sibling payment rows sharing same refNo and accountId
                    const siblingSnap = await recordsCol
                        .where('collectionName', '==', 'payments')
                        .where('data.refNo', '==', recordData.refNo)
                        .where('data.accountId', '==', recordData.accountId)
                        .get();
                    
                    const siblings = [];
                    siblingSnap.forEach(sDoc => {
                        const sData = sDoc.data().data || {};
                        if (sData.type === recordData.type) {
                            siblings.push({
                                docId: sDoc.id,
                                ...sData
                            });
                        }
                    });

                    return res.json({ 
                        success: true, 
                        isMulti: siblings.length > 1,
                        voucher: {
                            id: voucherId,
                            type: recordData.type === 'in' ? 'receipt' : 'payment',
                            accountId: recordData.accountId,
                            date: recordData.date,
                            refNo: recordData.refNo,
                            narration: recordData.description,
                            createdBy: recordData.createdBy,
                            payments: siblings.map(s => {
                                let ledgerCollection = 'parties';
                                let ledgerId = s.partyId;
                                if (s.expenseId) {
                                    ledgerCollection = 'expenses';
                                    ledgerId = s.expenseId;
                                } else if (s.assetId) {
                                    ledgerCollection = 'asset_accounts';
                                    ledgerId = s.assetId;
                                }
                                return {
                                    docId: s.docId,
                                    ledgerId,
                                    ledgerCollection,
                                    amount: s.amount,
                                    narration: s.description || '',
                                    againstId: s.againstId || null,
                                    againstRef: s.againstRef || null
                                };
                            })
                        }
                    });
                } else {
                    return res.json({
                        success: true,
                        isMulti: false,
                        voucher: {
                            id: voucherId,
                            type: recordData.type,
                            accountId: recordData.accountId,
                            toAccountId: recordData.toAccountId,
                            amount: recordData.amount,
                            date: recordData.date,
                            refNo: recordData.refNo,
                            narration: recordData.description,
                            createdBy: recordData.createdBy
                        }
                    });
                }
            }

            if (action === 'delete_voucher') {
                const { voucherId, password, subUserId, userName } = { ...req.query, ...req.body };
                if (!voucherId || !password) {
                    return res.status(400).json({ error: 'Missing required fields: voucherId, password' });
                }

                if (password !== 'abcd') {
                    return res.status(403).json({ error: 'Incorrect password.' });
                }

                const db = admin.firestore();
                const recordsCol = db.collection('companies_live').doc(companyId).collection('records');

                try {
                    const primaryDoc = await recordsCol.doc(voucherId).get();
                    if (!primaryDoc.exists) {
                        return res.status(404).json({ error: 'Voucher not found.' });
                    }

                    const primaryData = primaryDoc.data();
                    const voucherData = primaryData.data || {};

                    const oldVouchers = [];
                    if (primaryData.collectionName === 'payments' && voucherData.type !== 'contra' && voucherData.refNo) {
                        const siblingSnap = await recordsCol
                            .where('collectionName', '==', 'payments')
                            .where('data.refNo', '==', voucherData.refNo)
                            .where('data.accountId', '==', voucherData.accountId)
                            .get();
                        
                        siblingSnap.forEach(sDoc => {
                            const sData = sDoc.data().data || {};
                            if (sData.type === voucherData.type) {
                                oldVouchers.push({
                                    id: sDoc.id,
                                    data: sData
                                });
                            }
                        });
                    } else {
                        oldVouchers.push({
                            id: voucherId,
                            data: voucherData
                        });
                    }

                    await db.runTransaction(async (transaction) => {
                        for (const oldVch of oldVouchers) {
                            const oId = oldVch.id;
                            const oData = oldVch.data;
                            const amt = Number(oData.amount || 0);

                            if (oData.type === 'contra') {
                                transaction.update(recordsCol.doc(oData.accountId), {
                                    'data.balance': admin.firestore.FieldValue.increment(amt),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });
                                transaction.update(recordsCol.doc(oData.toAccountId), {
                                    'data.balance': admin.firestore.FieldValue.increment(-amt),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });

                                const fromAccDoc = await db.collection('accounts').doc(oData.accountId).get();
                                let topFromAccountId = fromAccDoc.exists ? oData.accountId : null;
                                if (!topFromAccountId) {
                                    const nestedFrom = await recordsCol.doc(oData.accountId).get();
                                    const name = nestedFrom.data()?.data?.name;
                                    if (name) {
                                        const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                        if (!q.empty) topFromAccountId = q.docs[0].id;
                                    }
                                }

                                const toAccDoc = await db.collection('accounts').doc(oData.toAccountId).get();
                                let topToAccountId = toAccDoc.exists ? oData.toAccountId : null;
                                if (!topToAccountId) {
                                    const nestedTo = await recordsCol.doc(oData.toAccountId).get();
                                    const name = nestedTo.data()?.data?.name;
                                    if (name) {
                                        const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                        if (!q.empty) topToAccountId = q.docs[0].id;
                                    }
                                }

                                if (topFromAccountId) {
                                    transaction.update(db.collection('accounts').doc(topFromAccountId), {
                                        'balance': admin.firestore.FieldValue.increment(amt), 'timestamp': Date.now()
                                    });
                                }
                                if (topToAccountId) {
                                    transaction.update(db.collection('accounts').doc(topToAccountId), {
                                        'balance': admin.firestore.FieldValue.increment(-amt), 'timestamp': Date.now()
                                    });
                                }
                            } else {
                                const vtype = oData.type;
                                const ledgerMultiplier = vtype === 'in' ? -1 : 1;
                                const bankMultiplier = vtype === 'in' ? 1 : -1;

                                let ledgerCollection = 'parties';
                                let ledgerId = oData.partyId;
                                if (oData.expenseId) {
                                    ledgerCollection = 'expenses';
                                    ledgerId = oData.expenseId;
                                } else if (oData.assetId) {
                                    ledgerCollection = 'asset_accounts';
                                    ledgerId = oData.assetId;
                                }

                                transaction.update(recordsCol.doc(ledgerId), {
                                    'data.balance': admin.firestore.FieldValue.increment(-amt * ledgerMultiplier),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });

                                const topLedgerCol = ledgerCollection === 'parties' ? 'parties' : 
                                                   ledgerCollection === 'expenses' ? 'expenses' : 
                                                   ledgerCollection === 'asset_accounts' ? 'accounts' : null;
                                
                                if (topLedgerCol) {
                                    let topLedgerId = null;
                                    const ledDoc = await db.collection(topLedgerCol).doc(ledgerId).get();
                                    if (ledDoc.exists) { topLedgerId = ledgerId; }
                                    else {
                                        const nestedLedger = await recordsCol.doc(ledgerId).get();
                                        const name = nestedLedger.data()?.data?.name;
                                        if (name) {
                                            const q = await db.collection(topLedgerCol).where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                            if (!q.empty) topLedgerId = q.docs[0].id;
                                        }
                                    }

                                    if (topLedgerId) {
                                        transaction.update(db.collection(topLedgerCol).doc(topLedgerId), {
                                            'balance': admin.firestore.FieldValue.increment(-amt * ledgerMultiplier),
                                            'timestamp': Date.now()
                                        });
                                    }
                                }

                                if (oData.againstId) {
                                    transaction.update(recordsCol.doc(oData.againstId), {
                                        'data.paidAmount': admin.firestore.FieldValue.increment(-amt),
                                        'data.remainingAmount': admin.firestore.FieldValue.increment(amt),
                                        'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                    });

                                    let topInvoiceId = null;
                                    const invDoc = await db.collection('invoices').doc(oData.againstId).get();
                                    if (invDoc.exists) { topInvoiceId = oData.againstId; }
                                    else if (oData.againstRef) {
                                        const q = await db.collection('invoices')
                                            .where('userId', '==', companyId)
                                            .where('refNo', '==', oData.againstRef)
                                            .limit(1).get();
                                        if (!q.empty) topInvoiceId = q.docs[0].id;
                                    }

                                    if (topInvoiceId) {
                                        transaction.update(db.collection('invoices').doc(topInvoiceId), {
                                            'paidAmount': admin.firestore.FieldValue.increment(-amt),
                                            'remainingAmount': admin.firestore.FieldValue.increment(amt),
                                            'timestamp': Date.now()
                                        });
                                    }
                                }

                                transaction.update(recordsCol.doc(oData.accountId), {
                                    'data.balance': admin.firestore.FieldValue.increment(-amt * bankMultiplier),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });

                                let topAccountId = null;
                                const accDoc = await db.collection('accounts').doc(oData.accountId).get();
                                if (accDoc.exists) { topAccountId = oData.accountId; }
                                else {
                                    const nestedAcc = await recordsCol.doc(oData.accountId).get();
                                    const name = nestedAcc.data()?.data?.name;
                                    if (name) {
                                        const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                        if (!q.empty) topAccountId = q.docs[0].id;
                                    }
                                }

                                if (topAccountId) {
                                    transaction.update(db.collection('accounts').doc(topAccountId), {
                                        'balance': admin.firestore.FieldValue.increment(-amt * bankMultiplier), 'timestamp': Date.now()
                                    });
                                }
                            }

                            transaction.set(recordsCol.doc(oId), {
                                id: oId,
                                deleted: true,
                                syncTimestamp: Date.now()
                            });
                            transaction.delete(db.collection('payments').doc(oId));
                        }
                    });

                    await logAuditActivity(
                        'DELETED',
                        voucherData.type === 'contra' ? 'Contra Voucher' : (voucherData.type === 'in' ? 'Receipt Voucher' : 'Payment Voucher'),
                        voucherData.refNo || 'N/A',
                        voucherData.amount || 0,
                        voucherData.date,
                        voucherId,
                        `DELETED ${voucherData.type === 'contra' ? 'Contra' : (voucherData.type === 'in' ? 'Receipt' : 'Payment')} Voucher: ref ${voucherData.refNo || 'N/A'}, amount ${voucherData.amount} via QuickAccPro`,
                        voucherData
                    );

                    return res.json({ success: true });
                } catch (error) {
                    return res.status(400).json({ error: error.message });
                }
            }

            if (action === 'edit_voucher') {
                let { voucherId, accountId, payments, date, narration, refNo, subUserId, type, userName, toAccountId, amount } = { ...req.query, ...req.body };
                if (!voucherId) {
                    return res.status(400).json({ error: 'Missing required field: voucherId' });
                }

                if (typeof payments === 'string') {
                    try { payments = JSON.parse(payments); } catch (e) { }
                }

                const db = admin.firestore();
                const recordsCol = db.collection('companies_live').doc(companyId).collection('records');

                try {
                    const primaryDoc = await recordsCol.doc(voucherId).get();
                    if (!primaryDoc.exists) {
                        return res.status(404).json({ error: 'Voucher not found.' });
                    }

                    const primaryData = primaryDoc.data();
                    const oldVoucherData = primaryData.data || {};

                    if (oldVoucherData.createdBy !== subUserId && oldVoucherData.createdBy !== userId) {
                        return res.status(403).json({ error: 'You are only authorized to edit your own created vouchers.' });
                    }

                    const oldVouchers = [];
                    if (primaryData.collectionName === 'payments' && oldVoucherData.type !== 'contra' && oldVoucherData.refNo) {
                        const siblingSnap = await recordsCol
                            .where('collectionName', '==', 'payments')
                            .where('data.refNo', '==', oldVoucherData.refNo)
                            .where('data.accountId', '==', oldVoucherData.accountId)
                            .get();
                        
                        siblingSnap.forEach(sDoc => {
                            const sData = sDoc.data().data || {};
                            if (sData.type === oldVoucherData.type) {
                                oldVouchers.push({
                                    id: sDoc.id,
                                    data: sData
                                });
                            }
                        });
                    } else {
                        oldVouchers.push({
                            id: voucherId,
                            data: oldVoucherData
                        });
                    }

                    const topInvoiceIds = {};
                    if (type !== 'contra' && payments) {
                        for (const p of payments) {
                            if (p.againstId && p.againstRef) {
                                const q = await db.collection('invoices')
                                    .where('userId', '==', companyId)
                                    .where('refNo', '==', p.againstRef)
                                    .limit(1).get();
                                if (!q.empty) topInvoiceIds[p.againstId] = q.docs[0].id;
                            }
                        }
                    }

                    const topPartyIds = {};
                    if (type !== 'contra' && payments) {
                        for (const p of payments) {
                            if (p.ledgerId) {
                                const d = await db.collection('parties').doc(p.ledgerId).get();
                                if (d.exists) { topPartyIds[p.ledgerId] = p.ledgerId; }
                                else {
                                    const nestedLedger = await recordsCol.doc(p.ledgerId).get();
                                    const name = nestedLedger.data()?.data?.name;
                                    if (name) {
                                        const q = await db.collection('parties').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                        if (!q.empty) topPartyIds[p.ledgerId] = q.docs[0].id;
                                    }
                                }
                            }
                        }
                    }

                    let topAccountId = null;
                    const accDoc = await db.collection('accounts').doc(accountId).get();
                    if (accDoc.exists) { topAccountId = accountId; }
                    else {
                        const nestedAcc = await recordsCol.doc(accountId).get();
                        const name = nestedAcc.data()?.data?.name;
                        if (name) {
                            const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                            if (!q.empty) topAccountId = q.docs[0].id;
                        }
                    }

                    let topToAccountId = null;
                    if (type === 'contra' && toAccountId) {
                        const toAccDoc = await db.collection('accounts').doc(toAccountId).get();
                        if (toAccDoc.exists) { topToAccountId = toAccountId; }
                        else {
                            const nestedAcc = await recordsCol.doc(toAccountId).get();
                            const name = nestedAcc.data()?.data?.name;
                            if (name) {
                                const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                if (!q.empty) topToAccountId = q.docs[0].id;
                            }
                        }
                    }

                    const createdIds = [];
                    let totalVoucherAmount = 0;

                    await db.runTransaction(async (transaction) => {
                        for (const oldVch of oldVouchers) {
                            const oId = oldVch.id;
                            const oData = oldVch.data;
                            const oAmt = Number(oData.amount || 0);

                            if (oData.type === 'contra') {
                                transaction.update(recordsCol.doc(oData.accountId), {
                                    'data.balance': admin.firestore.FieldValue.increment(oAmt),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });
                                transaction.update(recordsCol.doc(oData.toAccountId), {
                                    'data.balance': admin.firestore.FieldValue.increment(-oAmt),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });

                                const fromAccDoc = await db.collection('accounts').doc(oData.accountId).get();
                                let oldTopFrom = fromAccDoc.exists ? oData.accountId : null;
                                if (!oldTopFrom) {
                                    const nestedFrom = await recordsCol.doc(oData.accountId).get();
                                    const name = nestedFrom.data()?.data?.name;
                                    if (name) {
                                        const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                        if (!q.empty) oldTopFrom = q.docs[0].id;
                                    }
                                }

                                const toAccDoc = await db.collection('accounts').doc(oData.toAccountId).get();
                                let oldTopTo = toAccDoc.exists ? oData.toAccountId : null;
                                if (!oldTopTo) {
                                    const nestedTo = await recordsCol.doc(oData.toAccountId).get();
                                    const name = nestedTo.data()?.data?.name;
                                    if (name) {
                                        const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                        if (!q.empty) oldTopTo = q.docs[0].id;
                                    }
                                }

                                if (oldTopFrom) {
                                    transaction.update(db.collection('accounts').doc(oldTopFrom), {
                                        'balance': admin.firestore.FieldValue.increment(oAmt), 'timestamp': Date.now()
                                    });
                                }
                                if (oldTopTo) {
                                    transaction.update(db.collection('accounts').doc(oldTopTo), {
                                        'balance': admin.firestore.FieldValue.increment(-oAmt), 'timestamp': Date.now()
                                    });
                                }
                            } else {
                                const oMultiplier = oData.type === 'in' ? -1 : 1;
                                const oBankMultiplier = oData.type === 'in' ? 1 : -1;

                                let oldLedgerCol = 'parties';
                                let oldLedgerId = oData.partyId;
                                if (oData.expenseId) {
                                    oldLedgerCol = 'expenses';
                                    oldLedgerId = oData.expenseId;
                                } else if (oData.assetId) {
                                    oldLedgerCol = 'asset_accounts';
                                    oldLedgerId = oData.assetId;
                                }

                                transaction.update(recordsCol.doc(oldLedgerId), {
                                    'data.balance': admin.firestore.FieldValue.increment(-oAmt * oMultiplier),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });

                                const topCol = oldLedgerCol === 'parties' ? 'parties' : 
                                               oldLedgerCol === 'expenses' ? 'expenses' : 
                                               oldLedgerCol === 'asset_accounts' ? 'accounts' : null;
                                
                                if (topCol) {
                                    let oldTopLedgerId = null;
                                    const ledDoc = await db.collection(topCol).doc(oldLedgerId).get();
                                    if (ledDoc.exists) { oldTopLedgerId = oldLedgerId; }
                                    else {
                                        const nestedLedger = await recordsCol.doc(oldLedgerId).get();
                                        const name = nestedLedger.data()?.data?.name;
                                        if (name) {
                                            const q = await db.collection(topCol).where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                            if (!q.empty) oldTopLedgerId = q.docs[0].id;
                                        }
                                    }

                                    if (oldTopLedgerId) {
                                        transaction.update(db.collection(topCol).doc(oldTopLedgerId), {
                                            'balance': admin.firestore.FieldValue.increment(-oAmt * oMultiplier),
                                            'timestamp': Date.now()
                                        });
                                    }
                                }

                                if (oData.againstId) {
                                    transaction.update(recordsCol.doc(oData.againstId), {
                                        'data.paidAmount': admin.firestore.FieldValue.increment(-oAmt),
                                        'data.remainingAmount': admin.firestore.FieldValue.increment(oAmt),
                                        'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                    });

                                    let oldTopInvId = null;
                                    const invDoc = await db.collection('invoices').doc(oData.againstId).get();
                                    if (invDoc.exists) { oldTopInvId = oData.againstId; }
                                    else if (oData.againstRef) {
                                        const q = await db.collection('invoices')
                                            .where('userId', '==', companyId)
                                            .where('refNo', '==', oData.againstRef)
                                            .limit(1).get();
                                        if (!q.empty) oldTopInvId = q.docs[0].id;
                                    }

                                    if (oldTopInvId) {
                                        transaction.update(db.collection('invoices').doc(oldTopInvId), {
                                            'paidAmount': admin.firestore.FieldValue.increment(-oAmt),
                                            'remainingAmount': admin.firestore.FieldValue.increment(oAmt),
                                            'timestamp': Date.now()
                                        });
                                    }
                                }

                                transaction.update(recordsCol.doc(oData.accountId), {
                                    'data.balance': admin.firestore.FieldValue.increment(-oAmt * oBankMultiplier),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });

                                let oldTopAccountId = null;
                                const accDoc = await db.collection('accounts').doc(oData.accountId).get();
                                if (accDoc.exists) { oldTopAccountId = oData.accountId; }
                                else {
                                    const nestedAcc = await recordsCol.doc(oData.accountId).get();
                                    const name = nestedAcc.data()?.data?.name;
                                    if (name) {
                                        const q = await db.collection('accounts').where('userId', '==', companyId).where('name', '==', name).limit(1).get();
                                        if (!q.empty) oldTopAccountId = q.docs[0].id;
                                    }
                                }

                                if (oldTopAccountId) {
                                    transaction.update(db.collection('accounts').doc(oldTopAccountId), {
                                        'balance': admin.firestore.FieldValue.increment(-oAmt * oBankMultiplier), 'timestamp': Date.now()
                                    });
                                }
                            }

                            transaction.set(recordsCol.doc(oId), {
                                id: oId,
                                deleted: true,
                                syncTimestamp: Date.now()
                            });
                            transaction.delete(db.collection('payments').doc(oId));
                        }

                        if (type === 'contra') {
                            const amt = Number(amount);
                            totalVoucherAmount = amt;

                            transaction.update(recordsCol.doc(accountId), {
                                'data.balance': admin.firestore.FieldValue.increment(-amt),
                                'syncTimestamp': Date.now(), 'timestamp': Date.now()
                            });
                            transaction.update(recordsCol.doc(toAccountId), {
                                'data.balance': admin.firestore.FieldValue.increment(amt),
                                'syncTimestamp': Date.now(), 'timestamp': Date.now()
                            });

                            if (topAccountId) {
                                transaction.update(db.collection('accounts').doc(topAccountId), {
                                    'balance': admin.firestore.FieldValue.increment(-amt), 'timestamp': Date.now()
                                });
                            }
                            if (topToAccountId) {
                                transaction.update(db.collection('accounts').doc(topToAccountId), {
                                    'balance': admin.firestore.FieldValue.increment(amt), 'timestamp': Date.now()
                                });
                            }

                            const newId = voucherId;
                            createdIds.push(newId);
                            const contraData = {
                                type: 'contra',
                                accountId: accountId,
                                toAccountId: toAccountId,
                                amount: amt,
                                date: date || new Date().toISOString().split('T')[0],
                                description: narration || '',
                                refNo: refNo || '',
                                userId: companyId,
                                createdBy: subUserId || userId,
                                status: 'active',
                                version: 'v2'
                            };

                            transaction.set(recordsCol.doc(newId), {
                                id: newId, collectionName: 'payments', syncTimestamp: Date.now(), timestamp: Date.now(), data: contraData
                            });
                            transaction.set(db.collection('payments').doc(newId), {
                                ...contraData, id: newId, timestamp: Date.now()
                            });
                        } else {
                            const vtype = type === 'receipt' ? 'in' : 'out';
                            const ledgerMultiplier = vtype === 'in' ? -1 : 1;
                            const bankMultiplier = vtype === 'in' ? 1 : -1;

                            let isFirst = true;
                            for (const p of payments) {
                                const { ledgerId, ledgerCollection, amount: pAmt, againstId, againstRef, category } = p;
                                const amt = Number(pAmt);
                                totalVoucherAmount += amt;

                                transaction.update(recordsCol.doc(ledgerId), {
                                    'data.balance': admin.firestore.FieldValue.increment(amt * ledgerMultiplier),
                                    'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                });

                                const topId = topPartyIds[ledgerId];
                                const topLedgerCol = ledgerCollection === 'parties' ? 'parties' : 
                                                   ledgerCollection === 'expenses' ? 'expenses' : 
                                                   ledgerCollection === 'asset_accounts' ? 'accounts' : null;
                                
                                if (topLedgerCol && topId) {
                                    transaction.update(db.collection(topLedgerCol).doc(topId), {
                                        'balance': admin.firestore.FieldValue.increment(amt * ledgerMultiplier),
                                        'timestamp': Date.now()
                                    });
                                }

                                if (againstId) {
                                    transaction.update(recordsCol.doc(againstId), {
                                        'data.paidAmount': admin.firestore.FieldValue.increment(amt),
                                        'data.remainingAmount': admin.firestore.FieldValue.increment(-amt),
                                        'syncTimestamp': Date.now(), 'timestamp': Date.now()
                                    });

                                    const tInvId = topInvoiceIds[againstId];
                                    if (tInvId) {
                                        transaction.update(db.collection('invoices').doc(tInvId), {
                                            'paidAmount': admin.firestore.FieldValue.increment(amt),
                                            'remainingAmount': admin.firestore.FieldValue.increment(-amt),
                                            'timestamp': Date.now()
                                        });
                                    }
                                }

                                const newId = isFirst ? voucherId : crypto.randomBytes(12).toString('hex');
                                createdIds.push(newId);
                                isFirst = false;

                                const targetKey = ledgerCollection === 'parties' ? 'partyId' : ledgerCollection === 'expenses' ? 'expenseId' : 'assetId';
                                const targetCategory = ledgerCollection === 'parties' ? 'party' : ledgerCollection === 'expenses' ? 'expense' : 'asset';

                                const paymentData = {
                                    type: vtype === 'in' ? 'in' : 'out', 
                                    transactionCategory: targetCategory,
                                    accountId: accountId,
                                    [targetKey]: ledgerId,
                                    amount: amt,
                                    date: date || new Date().toISOString().split('T')[0],
                                    description: narration || '',
                                    refNo: refNo || '',
                                    againstId: againstId || null,
                                    againstRef: againstRef || null,
                                    invoiceId: againstId || null,
                                    invoiceRef: againstRef || null,
                                    billId: againstId || null,
                                    billRef: againstRef || null,
                                    isAgainstRef: !!againstId,
                                    paymentAgainst: againstId ? { id: againstId, ref: againstRef, amount: amt } : null,
                                    paymentCategory: category || 'normal',
                                    isMulti: payments.length > 1,
                                    userId: companyId,
                                    createdBy: subUserId || userId,
                                    status: 'active',
                                    version: 'v2',
                                    apiSource: 'accpro-multi-pay'
                                };

                                transaction.set(recordsCol.doc(newId), {
                                    id: newId, collectionName: 'payments', syncTimestamp: Date.now(), timestamp: Date.now(), data: paymentData
                                });
                                transaction.set(db.collection('payments').doc(newId), {
                                    ...paymentData, id: newId, timestamp: Date.now()
                                });
                            }

                            transaction.update(recordsCol.doc(accountId), {
                                'data.balance': admin.firestore.FieldValue.increment(totalVoucherAmount * bankMultiplier),
                                'syncTimestamp': Date.now(), 'timestamp': Date.now()
                            });

                            if (topAccountId) {
                                transaction.update(db.collection('accounts').doc(topAccountId), {
                                    'balance': admin.firestore.FieldValue.increment(totalVoucherAmount * bankMultiplier), 'timestamp': Date.now()
                                });
                            }
                        }
                    });

                    await logAuditActivity(
                        'UPDATED',
                        type === 'contra' ? 'Contra Voucher' : (type === 'receipt' ? 'Receipt Voucher' : 'Payment Voucher'),
                        refNo || 'N/A',
                        totalVoucherAmount,
                        date,
                        voucherId,
                        `UPDATED ${type === 'contra' ? 'Contra' : (type === 'receipt' ? 'Receipt' : 'Payment')} Voucher: total of ${totalVoucherAmount} via QuickAccPro`,
                        {
                            date: date || new Date().toISOString().split('T')[0],
                            type: type,
                            refNo: refNo || 'N/A',
                            amount: totalVoucherAmount,
                            accountId: accountId,
                            narration: narration || ''
                        }
                    );

                    return res.json({ success: true });

                } catch (error) {
                    return res.status(400).json({ error: error.message });
                }
            }

            return res.status(400).json({ error: 'Unknown action' });

    } catch (error) {
        console.error("API Error:", error);
        try {
            if (req._apiLogRef) {
                const duration = Date.now() - (req._apiLogStart || Date.now());
                req._apiLogRef.update({
                    dataReceived: JSON.stringify({ error: error.message }).length,
                    responseTime: duration,
                    status: 'error'
                }).catch(() => {});
            }
        } catch (_) {}
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ==========================================
// TELLER APP API (Kotlin Cashier App)
// ==========================================
exports.tellerApi = onRequest({ cors: true }, async (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    let token = authHeader.replace('Bearer ', '').trim();

    // Also support x-api-key header
    const apiKey = req.headers['x-api-key'] || req.query.apiKey || req.body?.apiKey || '';

    try {
        const db = admin.firestore();

        // Step 1: Identify user + company from token or API key
        let userId = null;
        let companyId = null;
        let companyName = 'AccountsPro';

        if (token) {
            const sessionSnap = await db.collection('api_sessions')
                .where('token', '==', token)
                .where('expiresAt', '>', Date.now())
                .limit(1)
                .get();

            if (!sessionSnap.empty) {
                const session = sessionSnap.docs[0].data();
                userId = session.userId;
                companyId = session.companyId;
            } else {
                const userDoc = await db.collection('users').doc(token).get();
                if (userDoc.exists) {
                    userId = userDoc.id;
                }
            }
        }

        // Fallback: if we have API key and no token
        if (!userId && apiKey) {
            const keySnap = await db.collection('api_keys')
                .where('apiKey', '==', apiKey).limit(1).get();
            if (!keySnap.empty) {
                const keyData = keySnap.docs[0].data();
                userId = keyData.userId;
                companyId = keyData.companyId;
            }
        }

        const getRecords = (colName) => db.collection('companies_live').doc(companyId).collection('records').where('collectionName', '==', colName);
        const action = req.query.action || req.body?.action || '';

        // Validate API key and show company info (used by Teller app setup screen)
        if (action === 'validate_key') {
            if (!apiKey) {
                return res.status(401).json({ success: false, message: 'API key is required.' });
            }

            const keySnap = await db.collection('api_keys').where('apiKey', '==', apiKey).limit(1).get();
            if (keySnap.empty) {
                return res.status(403).json({ success: false, message: 'Invalid API key.' });
            }

            const keyData = keySnap.docs[0].data();
            const ownerUserId = keyData.userId;
            const vCompanyId = keyData.companyId;

            // Fetch company name from multiple possible locations
            let vCompanyName = 'AccountsPro';
            if (vCompanyId) {
                // Try nadtally_live_registry first (main source of live company names)
                const regDoc = await db.collection('nadtally_live_registry').doc(vCompanyId).get();
                if (regDoc.exists && regDoc.data().name) {
                    vCompanyName = regDoc.data().name;
                } else {
                    // Fallback to companies collection (profile data)
                    const coDoc = await db.collection('companies').doc(vCompanyId).get();
                    if (coDoc.exists && coDoc.data().name) {
                        vCompanyName = coDoc.data().name;
                    } else {
                        // Last resort: companies_live doc itself
                        const clDoc = await db.collection('companies_live').doc(vCompanyId).get();
                        vCompanyName = clDoc.exists && clDoc.data().name ? clDoc.data().name : 'AccountsPro';
                    }
                }
            }

            // Fetch team members — try companyId first, then Auth UID
            let team = [];
            
            // Try 1: Query by companyId
            try {
                const teamSnap = await db.collection('users')
                    .where('ownerId', '==', vCompanyId)
                    .get();
                team = teamSnap.docs.map(d => ({
                    id: d.id,
                    name: d.data().name || 'Unknown',
                    email: d.data().email || '',
                    role: d.data().role || 'member'
                }));
            } catch (e) { /* ignore */ }

            // Try 2: Query by Auth UID if no results
            if (team.length === 0 && ownerUserId) {
                try {
                    const teamSnap2 = await db.collection('users')
                        .where('ownerId', '==', ownerUserId)
                        .get();
                    team = teamSnap2.docs.map(d => ({
                        id: d.id,
                        name: d.data().name || 'Unknown',
                        email: d.data().email || '',
                        role: d.data().role || 'member'
                    }));
                } catch (e) { /* ignore */ }
            }

            // Try 3: Scan all users — team members are stored locally but some may be in Firestore
            if (team.length === 0) {
                try {
                    const allUsersSnap = await db.collection('users').limit(50).get();
                    allUsersSnap.forEach(d => {
                        const data = d.data();
                        // Accept any user with a role field or a name field (they belong to this company via API key association)
                        const role = data.role || data.roleName || null;
                        const userName = data.name || data.fullName || data.displayName || null;
                        const userEmail = data.email || data.mail || null;
                        if (role || userName) {
                            // Check if user might belong to this company (same email domain as owner, or just include all)
                            if (!team.find(m => m.id === d.id)) {
                                team.push({
                                    id: d.id,
                                    name: userName || 'Team Member',
                                    email: userEmail || '',
                                    role: role || 'member'
                                });
                            }
                        }
                    });
                } catch (e) {
                    console.error(`TELLER_DEBUG scan error:`, e.message);
                }
            }

            return res.json({
                success: true,
                companyName: vCompanyName,
                companyId: vCompanyId,
                team: team,
                teamCount: team.length
            });
        }

        // Register device connection (called by teller app after successful validation)
        if (action === 'register_device') {
            if (!apiKey) {
                return res.status(401).json({ success: false, message: 'API key is required.' });
            }

            const keySnap = await db.collection('api_keys').where('apiKey', '==', apiKey).limit(1).get();
            if (keySnap.empty) {
                return res.status(403).json({ success: false, message: 'Invalid API key.' });
            }

            const keyData = keySnap.docs[0].data();
            const deviceName = req.body?.deviceName || req.headers['x-device-name'] || 'Android Teller App';
            const deviceInfo = req.body?.deviceInfo || req.headers['x-device-info'] || req.headers['user-agent'] || 'TellerApp';
            const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;

            // Log to api_usage_logs with a special "device_registered" action
            try {
                await db.collection('api_usage_logs').add({
                    apiKey: apiKey,
                    companyId: keyData.companyId,
                    userId: keyData.userId,
                    action: 'device_registered',
                    deviceInfo: deviceInfo,
                    deviceName: deviceName,
                    ipAddress: ipAddress,
                    userAgent: req.headers['user-agent'] || null,
                    dataSent: JSON.stringify(req.body || {}).length,
                    dataReceived: 200,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'connected'
                });
            } catch (logErr) {
                console.error('Failed to log device registration:', logErr);
            }

            return res.json({
                success: true,
                message: 'Device registered successfully',
                deviceName: deviceName,
                deviceInfo: deviceInfo,
                companyId: keyData.companyId
            });
        }

        // For login action, we proceed even without userId - we'll use the API key from body
        if (action === 'login') {
            if (!apiKey) {
                return res.status(401).json({ success: false, message: 'API key is required in body or x-api-key header.' });
            }

            // Find user from API key
            const keySnap = await db.collection('api_keys').where('apiKey', '==', apiKey).limit(1).get();
            if (keySnap.empty) {
                return res.status(403).json({ success: false, message: 'Invalid API key.' });
            }

            const keyData = keySnap.docs[0].data();
            const ownerUserId = keyData.userId;
            companyId = keyData.companyId;

            // Fetch company name
            if (companyId) {
                const coDoc = await db.collection('companies_live').doc(companyId).get();
                companyName = coDoc.exists ? (coDoc.data().name || 'AccountsPro') : 'AccountsPro';
            }

            const { username, password } = req.body || {};
            if (!username || !password) {
                return res.status(400).json({ success: false, message: 'Username and password required.' });
            }

            // Find team member by email (allow ANY role: accountant, cashier, banker, etc.)
            let userSnap = await db.collection('users')
                .where('ownerId', '==', ownerUserId)
                .where('email', '==', username)
                .limit(1)
                .get();

            let userData = null;
            let teamUserId = null;
            let isOwnerLogin = false;

            if (!userSnap.empty) {
                // Team member found
                userData = userSnap.docs[0].data();
                teamUserId = userSnap.docs[0].id;
                const storedPassword = userData.teamPassword || '123456';
                if (password !== storedPassword) {
                    return res.status(401).json({ success: false, message: 'Invalid password.' });
                }
            } else {
                // Check if it's the owner/admin themselves logging in
                const ownerDoc = await db.collection('users').doc(ownerUserId).get();
                if (ownerDoc.exists && ownerDoc.data().email === username) {
                    const ownerData = ownerDoc.data();
                    // Owner password stored in 'password' field, or fallback
                    const ownerPassword = ownerData.password || ownerData.teamPassword || '';
                    if (password !== ownerPassword) {
                        return res.status(401).json({ success: false, message: 'Invalid password.' });
                    }
                    userData = ownerData;
                    teamUserId = ownerUserId;
                    isOwnerLogin = true;
                } else {
                    return res.status(401).json({ success: false, message: 'User not found. Check email or contact admin.' });
                }
            }

            // Create session token
            const sessionToken = crypto.randomBytes(24).toString('hex');

            await db.collection('api_sessions').add({
                token: sessionToken,
                userId: teamUserId,
                ownerId: ownerUserId,
                companyId: companyId,
                isOwnerLogin: isOwnerLogin,
                createdAt: Date.now(),
                expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
            });

            return res.json({
                success: true,
                message: 'Login successful',
                token: sessionToken,
                userId: teamUserId,
                userName: userData.name || 'Team Member',
                companyId: companyId,
                companyName: companyName
            });
        }

        // All subsequent actions require authentication
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication failed. Provide valid token or API key.' });
        }

        // Fetch company
        if (companyId) {
            const coDoc = await db.collection('companies_live').doc(companyId).get();
            companyName = coDoc.exists ? (coDoc.data().name || 'AccountsPro') : 'AccountsPro';
        }

        // --- TELLER CREATE VOUCHER ---
        if (action === 'create_voucher') {
            const { type, date, amount, drAccountId, crAccountId, drName, crName, narration, refNo } = req.body || {};

            if (!type || !amount || !drAccountId || !crAccountId) {
                return res.status(400).json({ success: false, message: 'Missing required fields: type, amount, drAccountId, crAccountId.' });
            }

            const amt = Number(amount);
            if (!amt || amt <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid amount.' });
            }

            const recordsCol = db.collection('companies_live').doc(companyId).collection('records');
            const voucherDate = date || new Date().toISOString().split('T')[0];
            const voucherRefNo = refNo || `TLR-${Date.now().toString(36).toUpperCase()}`;
            const voucherNarration = narration || `${type.charAt(0).toUpperCase() + type.slice(1)} via Teller App`;

            // Resolve DR name from accounts if not provided
            let resolvedDrName = drName || '';
            let resolvedCrName = crName || '';

            try {
                await db.runTransaction(async (transaction) => {
                    // Fetch accounts to get names & validate
                    const drSnap = await transaction.get(recordsCol.doc(drAccountId));
                    const crSnap = await transaction.get(recordsCol.doc(crAccountId));

                    if (!drSnap.exists) throw new Error(`DR account ${drAccountId} not found`);
                    if (!crSnap.exists) throw new Error(`CR account ${crAccountId} not found`);

                    const drData = drSnap.data()?.data || {};
                    const crData = crSnap.data()?.data || {};

                    if (!resolvedDrName) resolvedDrName = drData.name || 'Debit';
                    if (!resolvedCrName) resolvedCrName = crData.name || 'Credit';

                    // Update balances based on voucher type
                    if (type === 'payment') {
                        // Payment: DR = expense/party (increase), CR = cash/bank (decrease)
                        transaction.update(recordsCol.doc(drAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(amt),
                            'syncTimestamp': Date.now()
                        });
                        transaction.update(recordsCol.doc(crAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(-amt),
                            'syncTimestamp': Date.now()
                        });
                    } else if (type === 'receipt') {
                        // Receipt: DR = cash/bank (increase), CR = party/income (increase)
                        transaction.update(recordsCol.doc(drAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(amt),
                            'syncTimestamp': Date.now()
                        });
                        transaction.update(recordsCol.doc(crAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(amt),
                            'syncTimestamp': Date.now()
                        });
                    } else if (type === 'contra') {
                        // Contra: DR = cash/bank (increase), CR = cash/bank (decrease)
                        transaction.update(recordsCol.doc(drAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(amt),
                            'syncTimestamp': Date.now()
                        });
                        transaction.update(recordsCol.doc(crAccountId), {
                            'data.balance': admin.firestore.FieldValue.increment(-amt),
                            'syncTimestamp': Date.now()
                        });
                    }

                    // Create journal voucher record
                    const newId = crypto.randomBytes(12).toString('hex');
                    transaction.set(recordsCol.doc(newId), {
                        id: newId,
                        collectionName: 'journal_vouchers',
                        syncTimestamp: Date.now(),
                        timestamp: Date.now(),
                        data: {
                            type: 'journal',
                            voucherType: type,
                            date: voucherDate,
                            amount: amt,
                            drAccountId: drAccountId,
                            crAccountId: crAccountId,
                            drName: resolvedDrName,
                            crName: resolvedCrName,
                            narration: voucherNarration,
                            refNo: voucherRefNo,
                            userId: userId,
                            status: 'active',
                            version: 'v2',
                            tellerUserId: req.body.userId || null,
                            tellerUserName: req.body.userName || null
                        }
                    });

                    // Also create a payment record for tracking
                    const payId = crypto.randomBytes(12).toString('hex');
                    const paymentType = type === 'receipt' ? 'in' : 'out';
                    transaction.set(recordsCol.doc(payId), {
                        id: payId,
                        collectionName: 'payments',
                        syncTimestamp: Date.now(),
                        timestamp: Date.now(),
                        data: {
                            type: paymentType,
                            date: voucherDate,
                            amount: amt,
                            accountId: type === 'receipt' ? drAccountId : crAccountId,
                            partyId: type === 'payment' ? drAccountId : (type === 'receipt' ? crAccountId : null),
                            description: voucherNarration,
                            refNo: voucherRefNo,
                            userId: userId,
                            status: 'active',
                            version: 'v2',
                            tellerVoucher: true,
                            linkedJournalId: newId
                        }
                    });
                });

                return res.json({
                    success: true,
                    message: `${type.charAt(0).toUpperCase() + type.slice(1)} voucher created successfully`,
                    voucherId: null,
                    refNo: voucherRefNo
                });
            } catch (error) {
                return res.status(400).json({ success: false, message: error.message });
            }
        }

        // --- TELLER BALANCES ---
        if (action === 'balances') {
            const snap = await getRecords('accounts').get();
            const balances = snap.docs.map(doc => {
                const item = doc.data().data || {};
                return {
                    accountId: doc.id,
                    accountName: item.name || 'Unknown',
                    accountType: (item.type || 'bank').toLowerCase().includes('cash') ? 'cash' : 'bank',
                    balance: Number(item.balance || 0)
                };
            });

            return res.json({
                success: true,
                message: null,
                balances: balances
            });
        }

        // --- TELLER ACCOUNTS ---
        if (action === 'accounts') {
            const snap = await getRecords('accounts').get();
            const accounts = snap.docs.map(doc => {
                const item = doc.data().data || {};
                return {
                    id: doc.id,
                    name: item.name || 'Unknown',
                    type: (item.type || 'bank').toLowerCase()
                };
            });

            return res.json({
                success: true,
                message: null,
                accounts: accounts
            });
        }

        return res.status(400).json({ success: false, message: `Unknown action: ${action}` });

    } catch (error) {
        console.error('Teller API Error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

