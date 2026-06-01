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

            // Fetch company name from the same path as records
            const companyDoc = await db.collection('companies_live').doc(companyId).get();
            const companyName = companyDoc.exists ? (companyDoc.data().name || 'AccountsPro Company') : 'AccountsPro Company';

            const action = req.query.action || 'summary';

            if (action === 'validate_key') {
                return res.json({ success: true, companyName });
            }

            // Helper to query the company's live records
            const getRecords = (colName) => db.collection('companies_live').doc(companyId).collection('records').where('collectionName', '==', colName);

            if (action === 'summary') {
                // Get basic summary for widget from live records
                const [partySnap, accountSnap, invoiceSnap] = await Promise.all([
                    getRecords('parties').get(),
                    getRecords('accounts').get(),
                    getRecords('invoices').get()
                ]);

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
                    cashBankBalance += (item.data?.balance || 0);
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
                const accounts = snap.docs.map(doc => {
                    const item = doc.data();
                    return {
                        id: item.id,
                        ...item.data
                    };
                });
                return res.json({ 
                    companyName,
                    accounts 
                });
            }

            if (action === 'add_contra') {
                // Support both query and body for flexibility
                const { fromAccountId, toAccountId, amount, date, narration, refNo } = { ...req.query, ...req.body };
                if (!fromAccountId || !toAccountId || !amount) {
                    return res.status(400).json({ error: 'Missing required fields: fromAccountId, toAccountId, amount' });
                }

                const amt = Number(amount);
                const recordsCol = db.collection('companies_live').doc(companyId).collection('records');

                try {
                    await db.runTransaction(async (transaction) => {
                        const fromSnap = await transaction.get(recordsCol.doc(fromAccountId));
                        const toSnap = await transaction.get(recordsCol.doc(toAccountId));

                        if (!fromSnap.exists || !toSnap.exists) {
                            throw new Error('One or both accounts not found');
                        }

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

                        // Create the payment record
                        const newId = crypto.randomBytes(12).toString('hex');
                        transaction.set(recordsCol.doc(newId), {
                            id: newId,
                            collectionName: 'payments',
                            syncTimestamp: Date.now(),
                            timestamp: Date.now(),
                            data: {
                                type: 'contra',
                                accountId: fromAccountId,
                                toAccountId: toAccountId,
                                amount: amt,
                                date: date || new Date().toISOString().split('T')[0],
                                description: narration || '', // Main app uses description for payments
                                refNo: refNo || '',
                                userId: userId,
                                status: 'active',
                                version: 'v2'
                            }
                        });
                    });
                    return res.json({ success: true });
                } catch (error) {
                    return res.status(400).json({ error: error.message });
                }
            }

            if (action === 'list_ledgers') {
                const [partySnap, expSnap, assetSnap] = await Promise.all([
                    getRecords('parties').get(),
                    getRecords('expenses').get(),
                    getRecords('asset_accounts').get()
                ]);
                
                const ledgers = [];
                partySnap.forEach(d => ledgers.push({ id: d.id, collection: 'parties', name: d.data().data?.name || 'Unknown Party' }));
                expSnap.forEach(d => ledgers.push({ id: d.id, collection: 'expenses', name: d.data().data?.name || 'Unknown Expense' }));
                assetSnap.forEach(d => ledgers.push({ id: d.id, collection: 'asset_accounts', name: d.data().data?.name || 'Unknown Asset' }));
                
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

            if (action === 'list_team') {
                const teamSnap = await db.collection('users').where('ownerId', '==', userId).get();
                const team = teamSnap.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name,
                    email: doc.data().email,
                    role: doc.data().role
                }));
                return res.json({ team, companyName });
            }

            if (action === 'verify_team_login') {
                const { username, password } = { ...req.query, ...req.body };
                if (!username || !password) return res.status(400).json({ error: 'Username and Password required' });

                const db = admin.firestore();
                
                // 1. Try finding as a Team Member (ownerId matches)
                let userSnap = await db.collection('users')
                    .where('email', '==', username)
                    .where('ownerId', '==', userId)
                    .limit(1)
                    .get();

                // 2. If not found, try finding as the Owner themselves (ID matches)
                if (userSnap.empty) {
                    const ownerDoc = await db.collection('users').doc(userId).get();
                    if (ownerDoc.exists && ownerDoc.data().email === username) {
                        const userData = ownerDoc.data();
                        const storedPassword = userData.teamPassword || '123456';
                        if (password !== storedPassword) return res.status(401).json({ error: 'Invalid password' });
                        
                        return res.json({ 
                            success: true, 
                            user: { id: userId, name: userData.name, role: 'owner' } 
                        });
                    }
                    return res.status(401).json({ error: 'User not found in this company' });
                }
                
                const userData = userSnap.docs[0].data();
                const storedPassword = userData.teamPassword || '123456';
                
                if (password !== storedPassword) {
                    return res.status(401).json({ error: 'Invalid password' });
                }

                return res.json({ 
                    success: true, 
                    user: { id: userSnap.docs[0].id, name: userData.name, role: userData.role } 
                });
            }

            if (action === 'add_payment') {
                let { accountId, payments, date, narration, refNo, subUserId } = { ...req.query, ...req.body };
                
                if (typeof payments === 'string') {
                    try { payments = JSON.parse(payments); } catch (e) { }
                }

                if (!accountId || !payments || !Array.isArray(payments) || payments.length === 0) {
                    return res.status(400).json({ error: 'Missing required fields: accountId, payments (array)' });
                }

                const db = admin.firestore();
                const recordsCol = db.collection('companies_live').doc(companyId).collection('records');

                try {
                    await db.runTransaction(async (transaction) => {
                        const accSnap = await transaction.get(recordsCol.doc(accountId));
                        if (!accSnap.exists) throw new Error('Source account not found');

                        const uniqueLedgerIds = [...new Set(payments.map(p => p.ledgerId))];
                        const uniqueAgainstIds = [...new Set(payments.filter(p => p.againstId).map(p => p.againstId))];
                        
                        // FETCH NESTED (Source of Truth)
                        const [ledgerSnaps, againstSnaps, sourceAccSnap] = await Promise.all([
                            Promise.all(uniqueLedgerIds.map(id => transaction.get(recordsCol.doc(id)))),
                            Promise.all(uniqueAgainstIds.map(id => transaction.get(recordsCol.doc(id)))),
                            transaction.get(recordsCol.doc(accountId))
                        ]);

                        if (!sourceAccSnap.exists) throw new Error('Source account not found');
                        ledgerSnaps.forEach((snap, idx) => { if (!snap.exists) throw new Error(`Ledger ${uniqueLedgerIds[idx]} not found`); });

                        // FETCH TOP-LEVEL MIRRORS (Using queries for better matching)
                        const topInvoiceIds = {};
                        for (const p of payments) {
                            if (p.againstId && p.againstRef) {
                                const q = await db.collection('invoices')
                                    .where('userId', '==', userId)
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
                                        const q = await db.collection('parties').where('userId', '==', userId).where('name', '==', nestedData.name).limit(1).get();
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
                                const q = await db.collection('accounts').where('userId', '==', userId).where('name', '==', nestedAcc.name).limit(1).get();
                                if (!q.empty) topAccountId = q.docs[0].id;
                            }
                        }

                        let totalVoucherAmount = 0;

                        for (const p of payments) {
                            const { ledgerId, ledgerCollection, amount, againstId, againstRef, category } = p;
                            const amt = Number(amount);
                            totalVoucherAmount += amt;

                            // 1. UPDATE NESTED RECORD
                            transaction.update(recordsCol.doc(ledgerId), {
                                'data.balance': admin.firestore.FieldValue.increment(amt),
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
                                    'balance': admin.firestore.FieldValue.increment(amt),
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
                            const targetKey = ledgerCollection === 'parties' ? 'partyId' : ledgerCollection === 'expenses' ? 'expenseId' : 'assetId';
                            const targetCategory = ledgerCollection === 'parties' ? 'party' : ledgerCollection === 'expenses' ? 'expense' : 'asset';

                            const paymentData = {
                                type: 'out', 
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
                                userId: subUserId || userId,
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

                        // Update Bank
                        transaction.update(recordsCol.doc(accountId), {
                            'data.balance': admin.firestore.FieldValue.increment(-totalVoucherAmount),
                            'syncTimestamp': Date.now(), 'timestamp': Date.now()
                        });

                        if (topAccountId) {
                            transaction.update(db.collection('accounts').doc(topAccountId), {
                                'balance': admin.firestore.FieldValue.increment(-totalVoucherAmount), 'timestamp': Date.now()
                            });
                        }
                    });
                    return res.json({ success: true });
                } catch (error) {
                    return res.status(400).json({ error: error.message });
                }
            }

            return res.status(400).json({ error: 'Unknown action' });

    } catch (error) {
        console.error("API Error:", error);
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

            // Fetch team members — ownerId on user docs stores the COMPANY ID, not Auth UID
            const teamSnap = await db.collection('users')
                .where('ownerId', '==', vCompanyId)
                .get();

            const team = teamSnap.docs.map(d => ({
                id: d.id,
                name: d.data().name || 'Unknown',
                email: d.data().email || '',
                role: d.data().role || 'member'
            }));

            return res.json({
                success: true,
                companyName: vCompanyName,
                companyId: vCompanyId,
                team: team,
                teamCount: team.length
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

