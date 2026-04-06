import { db } from "./firebase"; // Make sure this path is correct for your project
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp 
} from "firebase/firestore";

const COLLECTION_NAME = "sheets"; // This is the folder name in Firebase

// 1. CREATE NEW / SAVE AS (Generates a new ID)
// Added userId so listing with where('userId','==',...) works
export const createSheetInDB = async (sheetName, gridData, userId) => {
  try {
    const docRef = await addDoc(collection(db, COLLECTION_NAME), {
      name: sheetName,
      data: JSON.stringify(gridData), // Store grid as text to save space/complexity
      userId: userId || null,
      createdAt: serverTimestamp(),
      lastModified: serverTimestamp()
    });
    console.log("Document written with ID: ", docRef.id);
    return docRef.id; // Return the new ID so the App knows which file is open
  } catch (e) {
    console.error("Error adding document: ", e);
    throw e;
  }
};

// 2. UPDATE EXISTING (Auto-Save / Save)
export const updateSheetInDB = async (sheetId, dataToUpdate) => {
  if (!sheetId) return; // Safety check

  try {
    const sheetRef = doc(db, COLLECTION_NAME, sheetId);
    
    // We prepare the object. If gridData is passed, we stringify it.
    const payload = {
      lastModified: serverTimestamp(),
      ...dataToUpdate
    };

    // If we are updating the grid data specifically, stringify it first
    if (dataToUpdate.data) {
      payload.data = JSON.stringify(dataToUpdate.data);
    }

    await updateDoc(sheetRef, payload);
    console.log("Sheet updated!");
  } catch (e) {
    console.error("Error updating document: ", e);
    throw e;
  }
};
