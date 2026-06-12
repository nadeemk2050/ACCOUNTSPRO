import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, doc, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDaKgWXJiz_NTYo4NBCXhVZ7qIo9SwkooY",
  authDomain: "cashshams.firebaseapp.com",
  projectId: "cashshams",
  storageBucket: "cashshams.firebasestorage.app",
  messagingSenderId: "565173718396",
  appId: "1:565173718396:web:c23d370ab7c629f86c28f9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
    await signInAnonymously(auth);
    console.log('Authenticated!');

    // Query recent audit logs with user ownerId
    const qLogs = query(
        collection(db, 'audit_logs'),
        where('ownerId', '==', '3k0LsI2mf5ewuTLHrIuwYsL5XmY2')
    );

    const logsSnap = await getDocs(qLogs);
    console.log(`Found ${logsSnap.size} logs to inspect.`);

    for (const logDoc of logsSnap.docs) {
        const logData = logDoc.data();
        const logId = logDoc.id;

        // Try to identify target company using snapData or other fields
        let snapshotObj = null;
        try {
            if (logData.snapshotData) {
                snapshotObj = JSON.parse(logData.snapshotData);
            }
        } catch (e) {}

        const targetIdToCheck = snapshotObj?.accountId || snapshotObj?.partyId || snapshotObj?.expenseId;
        if (!targetIdToCheck) {
            console.log(`Log ${logId} has no target entity to trace company. Skipping.`);
            continue;
        }

        // Trace which company has this entity in records
        let targetCompanyId = null;
        for (const cid of ['8u57h', 'bul7x']) {
            const entDoc = await getDoc(doc(db, `companies_live/${cid}/records`, targetIdToCheck));
            if (entDoc.exists()) {
                targetCompanyId = cid;
                break;
            }
        }

        if (!targetCompanyId) {
            console.log(`Could not trace target company for log ${logId} (entity ${targetIdToCheck}). Skipping.`);
            continue;
        }

        console.log(`Found target company ${targetCompanyId} for log ${logId} (${logData.refNo}).`);

        // 1. Update ownerId in top-level audit_logs
        await updateDoc(doc(db, 'audit_logs', logId), {
            ownerId: targetCompanyId
        });
        console.log(`  Updated top-level log ${logId} ownerId to ${targetCompanyId}.`);

        // 2. Set/Overwrite nested record so desktop syncs it down
        const updatedLogData = {
            ...logData,
            ownerId: targetCompanyId
        };
        // Convert dates from timestamp representation if needed
        if (updatedLogData.date && updatedLogData.date.toDate) {
            updatedLogData.date = updatedLogData.date.toDate();
        }

        await setDoc(doc(db, `companies_live/${targetCompanyId}/records`, logId), {
            id: logId,
            collectionName: 'audit_logs',
            syncTimestamp: Date.now(),
            timestamp: Date.now(),
            data: updatedLogData
        });
        console.log(`  Wrote log ${logId} to nested company records collection.`);
    }

    console.log('Migration completed successfully.');
    process.exit(0);
}

run().catch(console.error);
