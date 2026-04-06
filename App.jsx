import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth, onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { getFirestore, collection, addDoc, query, where, getDocs, onSnapshot, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, orderBy } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, auth, storage, functions } from './src/firebase';  // Adjusted path
import { httpsCallable } from 'firebase/functions';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import {ArrowLeft, ChevronsUpDown, File, FilePlus, FileText, FileUp, Folder, GripVertical, HardDrive, Home, LogOut, MoreVertical, Plus, Save, Settings, Trash, Trash2, Upload, User, X, Zap, ZoomIn, ZoomOut, FileSpreadsheet, LayoutGrid, AlertCircle, HelpCircle, BookOpen, Clock, Users, Database, Server, Star, Copy, RefreshCw} from 'lucide-react';
import jspreadsheet from 'jspreadsheet-ce';
import DOMPurify from 'dompurify';


// ... (rest of the imports)

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);


// --- UTILITY COMPONENTS ---

const Modal = ({ isOpen, onClose, onBack, title, children, maxWidth = "max-w-2xl", zIndex = 50 }) => {
    if (!isOpen) return null;

    return (
        <div className={`fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-[${zIndex}]`} onClick={onClose}>
            <div className={`bg-white rounded-lg shadow-2xl w-full ${maxWidth} flex flex-col max-h-[90vh]`} onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b">
                    <div className="flex items-center">
                         {onBack && <button onClick={onBack} className="mr-3 text-gray-500 hover:text-gray-800"><ArrowLeft size={20}/></button>}
                         <h2 className="text-lg font-bold text-gray-800">{title}</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><X size={24}/></button>
                </div>
                <div className="p-6 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

const LoadingSpinner = () => (
    <div className="flex flex-col justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-sm text-gray-500">Loading...</p>
    </div>
);

const UserProfile = ({ user, onLogout }) => {
    return (
        <div className="absolute top-4 right-4 bg-white p-4 rounded-lg shadow-lg border">
            <p className="text-sm font-medium">Signed in as</p>
            <p className="text-sm text-gray-600 mb-4">{user.email}</p>
            <button
                onClick={onLogout}
                className="w-full bg-red-500 text-white text-sm py-2 px-4 rounded hover:bg-red-600"
            >
                Sign Out
            </button>
        </div>
    );
};


// --- DATABASE HELPER FUNCTIONS ---

const createSheetInDB = async (name, data) => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    const sheetRef = await addDoc(collection(db, "sheets"), {
        userId: user.uid,
        name: name,
        data: data, // Ensure data is serializable
        createdAt: serverTimestamp(),
        lastModified: serverTimestamp(),
    });
    return sheetRef.id;
};

const updateSheetInDB = async (sheetId, updates) => {
    const sheetRef = doc(db, "sheets", sheetId);
    await updateDoc(sheetRef, {
        ...updates,
        lastModified: serverTimestamp(),
    });
};


// --- SPREADSHEET GRID COMPONENT ---

const SpreadsheetGrid = React.memo(({ initialData, onStatsUpdate, onCellSelect, onGridReady, topScrollRef, versionKey }) => {
    const spreadsheetRef = useRef(null);
    const jssInstance = useRef(null);

    useEffect(() => {
        // Load CSS dynamically if not already present
        if (!document.querySelector('link[href*="jexcel.css"]')) {
            const link1 = document.createElement('link');
            link1.rel = 'stylesheet';
            link1.href = 'https://bossanova.uk/jspreadsheet/v4/jexcel.css';
            document.head.appendChild(link1);
        }
        if (!document.querySelector('link[href*="jsuites.css"]')) {
            const link2 = document.createElement('link');
            link2.rel = 'stylesheet';
            link2.href = 'https://jsuites.net/v4/jsuites.css';
            document.head.appendChild(link2);
        }
    }, []);

    useEffect(() => {
        if (spreadsheetRef.current) {
            // Destroy previous instance if it exists to prevent memory leaks
            if (jssInstance.current) {
                jssInstance.current.destroy();
                spreadsheetRef.current.innerHTML = ''; // Clear the container
            }

            const sanitizedData = initialData.map(row => 
                Array.isArray(row) ? row.map(cell => (cell === null || cell === undefined) ? '' : cell) : []
            );

            jssInstance.current = jspreadsheet(spreadsheetRef.current, {
                data: sanitizedData,
                minDimensions: [20, 50],
                tableWidth: '100%',
                tableHeight: '100%',
                columnResize: true,
                rowResize: true,
                allowInsertColumn: true,
                allowInsertRow: true,
                allowDeleteColumn: true,
                allowDeleteRow: true,
                allowRenameColumn: true,
                wordWrap: true,
                license: 'YOUR_LICENSE_KEY',
                onselection: (instance, x1, y1, x2, y2, origin) => {
                    const selectedData = [];
                    let sum = 0;
                    let count = 0;
                    for (let j = y1; j <= y2; j++) {
                        for (let i = x1; i <= x2; i++) {
                            const val = parseFloat(instance.getValueFromCoords(i, j));
                            if (!isNaN(val)) {
                                sum += val;
                                count++;
                            }
                        }
                    }
                    onStatsUpdate({ sum: sum.toFixed(2), avg: (sum / count || 0).toFixed(2), count });

                    if (onCellSelect) {
                        const cellName = instance.options.columns[x1].name + (y1 + 1);
                        const rawValue = instance.getValueFromCoords(x1, y1);
                        onCellSelect(cellName, rawValue);
                    }
                },
                 onchange: (instance, cell, x, y, value) => {
                     if (onCellSelect) {
                        const cellName = instance.options.columns[x].name + (y + 1);
                        onCellSelect(cellName, value);
                    }
                },
            });

            if (onGridReady) {
                onGridReady(jssInstance.current);
            }
        }
        
        return () => {
             // Cleanup on unmount
            if (jssInstance.current && typeof jssInstance.current.destroy === 'function') {
                try {
                   // jssInstance.current.destroy();
                   // jssInstance.current = null;
                } catch(e) { console.warn("Error destroying spreadsheet: ", e)}
            }
        };

    }, [versionKey]); // Depend on versionKey to re-initialize

    return <div ref={spreadsheetRef} className="w-full h-full spreadsheet-container"></div>;
});

// --- 2. MAIN WORKING SHEET MODAL (Fixed) ---
const WorkingSheetModal = ({ isOpen, onClose, onBack, user, dataOwnerId, isSidebarOpen, setIsSidebarOpen }) => {
    // App State
    const [savedSheets, setSavedSheets] = useState([]);
    const [searchTerm, setSearchTerm] = useState(""); 
    const [currentSheetId, setCurrentSheetId] = useState(null);
    const [sheetName, setSheetName] = useState("Untitled Sheet");
    const [loading, setLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [gridVersion, setGridVersion] = useState(0); 
    const [showActions, setShowActions] = useState(false);
    const [gridData, setGridData] = useState(() => Array.from({ length: 50 }, () => Array(20).fill("")));
    
    // UI State (Footer & Formula Bar)
    const [selectionStats, setSelectionStats] = useState({ sum: 0, avg: 0, count: 0 });
    const [activeCell, setActiveCell] = useState(""); 
    const [activeValue, setActiveValue] = useState(""); 
    const [formulaFocused, setFormulaFocused] = useState(false);

    const jSheetRef = useRef(null);
    const topScrollRef = useRef(null); 

    // 1. Force Load CSS
    useEffect(() => {
        if (!isOpen) return;
        const link1 = document.createElement("link");
        link1.rel = "stylesheet";
        link1.href = "https://bossanova.uk/jspreadsheet/v4/jexcel.css";
        document.head.appendChild(link1);
        const link2 = document.createElement("link");
        link2.rel = "stylesheet";
        link2.href = "https://jsuites.net/v4/jsuites.css";
        document.head.appendChild(link2);
    }, [isOpen]);

    // 2. Load Sheets List (Fixed Query)
    useEffect(() => {
        if (!isOpen || !user) return;
        const targetUid = dataOwnerId || user.uid;
        
        // Simple query first to ensure permissions work
        const q = query(collection(db, 'sheets'), where('userId', '==', targetUid));
        
        const unsub = onSnapshot(q, (snap) => {
            const sheets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort client-side to avoid index errors
            sheets.sort((a,b) => (b.lastModified?.seconds || 0) - (a.lastModified?.seconds || 0));
            setSavedSheets(sheets);
        }, (err) => {
            console.error("Error loading sheets:", err);
        });
        return () => unsub();
    }, [isOpen, user, dataOwnerId]);

    // 3. Stable Handlers (UseCallback is Critical here)
    const handleCellSelect = React.useCallback((cellName, rawValue) => {
        setActiveCell(cellName);
        setActiveValue(rawValue === null || rawValue === undefined ? "" : rawValue);
    }, []);

    const handleGridReady = React.useCallback((instance) => {
        jSheetRef.current = instance;
    }, []);

    // 4. Formula Logic
    const handleFormulaChange = (e) => {
        const newValue = e.target.value;
        setActiveValue(newValue);
        if (jSheetRef.current && activeCell) {
            try {
                if (typeof jSheetRef.current.setValue === 'function') {
                    jSheetRef.current.setValue(activeCell, newValue);
                } else {
                    const match = activeCell.match(/^([A-Z]+)(\d+)$/i);
                    if (match && typeof jSheetRef.current.setValueFromCoords === 'function') {
                         // A1 -> coords logic
                        const letters = match[1].toUpperCase();
                        let col = 0;
                        for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 65 + 1);
                        col = col - 1;
                        const row = parseInt(match[2], 10) - 1;
                        jSheetRef.current.setValueFromCoords(col, row, newValue);
                    }
                }
            } catch (err) { console.warn(err); }
        }
    };

    // Auto-save
    useEffect(() => {
        if (!currentSheetId) return;
        const timer = setTimeout(() => {
            const currentGridData = jSheetRef.current ? jSheetRef.current.getData() : gridData;
            // Only update data, not metadata, to prevent stutter
            updateSheetInDB(currentSheetId, { data: currentGridData }); 
        }, 3000);
        return () => clearTimeout(timer);
    }, [gridData, currentSheetId]);

    // File Operations
    const openSheet = (sheet) => {
        if (currentSheetId && currentSheetId !== sheet.id && !confirm("Unsaved changes?")) return;
        setLoading(true);
        setCurrentSheetId(sheet.id);
        setSheetName(sheet.name || "Untitled");
        let parsed = Array.from({ length: 50 }, () => Array(20).fill(""));
        try { 
            parsed = typeof sheet.data === 'string' ? JSON.parse(sheet.data) : sheet.data;
        } catch (e) { console.error(e); }
        
        // Sanitize data
        const clean = parsed.map(row => Array.isArray(row) ? row.map(c => (c === null ? "" : c)) : []);
        setGridData(clean);
        setGridVersion(v => v + 1); 
        setLoading(false);
        // Don't auto-close sidebar on desktop, maybe on mobile?
        if(window.innerWidth < 768) setIsSidebarOpen(false); 
    };

    const handleCreateNew = () => {
        if (confirm("Create new sheet?")) {
            setGridData(Array.from({ length: 50 }, () => Array(20).fill("")));
            setSheetName("Untitled Sheet");
            setCurrentSheetId(null);
            setGridVersion(v => v + 1);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        const currentGridData = jSheetRef.current ? jSheetRef.current.getData() : gridData;
        try {
            if (currentSheetId) {
                await updateSheetInDB(currentSheetId, { name: sheetName, data: currentGridData });
                alert("Updated!");
            } else {
                const newName = prompt("Filename:", sheetName);
                if (!newName) { setIsSaving(false); return; }
                const newId = await createSheetInDB(newName, currentGridData);
                setSheetName(newName);
                setCurrentSheetId(newId);
                alert("Saved!");
            }
        } catch (e) { alert(e.message); } finally { setIsSaving(false); }
    };

    // Render Helpers
    const filteredSheets = savedSheets.filter(s => (s.name || "").toLowerCase().includes(searchTerm.toLowerCase()));

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} onBack={onBack} title="Working Sheets" maxWidth="max-w-[95vw]" zIndex={60}>
            <div className="flex h-[85vh] border rounded-lg overflow-hidden bg-white relative">
                
                {/* 1. SIDEBAR (Absolute on mobile, relative on desktop) */}
                {isSidebarOpen && (
                    <div className="absolute md:relative z-20 w-64 h-full bg-slate-50 border-r border-slate-200 flex flex-col shadow-xl md:shadow-none">
                        <div className="p-3 border-b space-y-2">
                            <button onClick={handleCreateNew} className="w-full bg-blue-600 text-white py-2 rounded text-xs font-bold flex gap-2 justify-center items-center"><Plus size={14}/> New Sheet</button>
                            <input type="text" placeholder="Search files..." className="w-full p-1.5 text-xs border rounded" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {filteredSheets.length === 0 && <div className="text-xs text-gray-400 text-center p-4">No saved sheets found.</div>}
                            {filteredSheets.map(sheet => (
                                <div key={sheet.id} onClick={() => openSheet(sheet)} className={`p-2 rounded cursor-pointer text-xs flex justify-between items-center ${currentSheetId === sheet.id ? 'bg-blue-100 text-blue-700 font-bold' : 'hover:bg-slate-200'}`}>
                                    <div className="flex items-center gap-2 truncate">
                                        <FileSpreadsheet size={14} className="text-green-600 shrink-0"/>
                                        <span className="truncate">{sheet.name}</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); if(confirm("Delete?")) deleteDoc(doc(db, 'sheets', sheet.id)); }} className="text-slate-400 hover:text-red-500"><Trash2 size={12}/></button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 2. MAIN SPREADSHEET AREA */}
                <div className="flex-1 flex flex-col bg-white overflow-hidden relative z-10">
                    
                    {/* Toolbar */}
                    <div className="flex justify-between items-center p-2 border-b bg-slate-50">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-1.5 rounded ${isSidebarOpen ? 'bg-slate-200' : 'hover:bg-slate-200'}`}><LayoutGrid size={18}/></button>
                            <input type="text" className="bg-transparent font-bold text-slate-700 text-sm border-b border-transparent focus:border-blue-500 outline-none w-40" value={sheetName} onChange={e => setSheetName(e.target.value)} />
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center bg-white border rounded px-1">
                                <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="p-1"><ZoomOut size={14}/></button>
                                <span className="text-[10px] w-8 text-center">{Math.round(zoomLevel * 100)}%</span>
                                <button onClick={() => setZoomLevel(z => Math.min(1.5, z + 0.1))} className="p-1"><ZoomIn size={14}/></button>
                            </div>
                            <button onClick={handleSave} className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold flex gap-1 items-center">{isSaving ? '...' : <><Save size={14}/> Save</>}</button>
                        </div>
                    </div>

                    {/* Formula Bar */}
                    <div className="flex items-center gap-0 border-b p-1 bg-slate-100">
                        <div className="w-10 h-6 bg-white border flex items-center justify-center text-[10px] font-bold text-slate-500">{activeCell}</div>
                        <div className="flex-1 h-6 relative">
                            <span className="absolute left-1 top-1 text-slate-400 text-[10px] font-serif italic">fx</span>
                            <input type="text" className="w-full h-full pl-5 pr-2 border text-xs outline-none" value={activeValue} onChange={handleFormulaChange} onFocus={() => setFormulaFocused(true)} onBlur={() => setFormulaFocused(false)}/>
                        </div>
                    </div>

                    {/* Grid Wrapper */}
                    <div className="flex-1 overflow-hidden relative bg-slate-200">
                        {loading && <div className="absolute inset-0 z-50 bg-white/80 flex items-center justify-center"><LoadingSpinner/></div>}
                        
                        <div className="w-full h-full overflow-hidden p-1">
                             <div style={{ zoom: zoomLevel, width: '100%', height: '100%' }}>
                                <SpreadsheetGrid 
                                    initialData={gridData} 
                                    onStatsUpdate={setSelectionStats} 
                                    onCellSelect={handleCellSelect}
                                    onGridReady={handleGridReady}
                                    topScrollRef={topScrollRef} 
                                    versionKey={`${currentSheetId || 'new'}_${gridVersion}`}
                                />
                             </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="bg-slate-800 text-white text-[10px] p-1 flex justify-end gap-4 px-3">
                        <span>Count: <b>{selectionStats.count}</b></span>
                        <span>Sum: <b className="text-green-300">{selectionStats.sum}</b></span>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

// --- 3. SYSTEM LOG MODAL ---
const SystemLogModal = ({ isOpen, onClose, onBack }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        const q = query(collection(db, "system_logs"), orderBy("timestamp", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const logData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLogs(logData);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching system logs:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [isOpen]);

    const formatTimestamp = (ts) => {
        if (!ts) return "No date";
        return new Date(ts.seconds * 1000).toLocaleString();
    };
    
    const getLogIcon = (type) => {
        switch (type) {
            case 'login': return <User size={14} className="text-green-500"/>;
            case 'logout': return <LogOut size={14} className="text-red-500"/>;
            case 'file_create': return <FilePlus size={14} className="text-blue-500"/>;
            case 'file_delete': return <Trash2 size={14} className="text-orange-500"/>;
            case 'file_update': return <Save size={14} className="text-purple-500"/>;
            case 'error': return <AlertCircle size={14} className="text-yellow-500"/>;
            default: return <Info size={14} className="text-gray-400"/>;
        }
    }


    return (
        <Modal isOpen={isOpen} onClose={onClose} onBack={onBack} title="System Activity Log" maxWidth="max-w-4xl">
             {loading ? <LoadingSpinner /> : (
                <div className="space-y-3">
                    {logs.map(log => (
                        <div key={log.id} className="p-3 bg-slate-50 rounded-lg text-xs flex items-start gap-3">
                            <div className="pt-1">{getLogIcon(log.type)}</div>
                            <div className="flex-1">
                                <p className="font-mono text-slate-800">{log.message}</p>
                                <p className="text-slate-500 text-[10px] mt-1">
                                    <span className="font-medium">{log.userEmail || "System"}</span> at {formatTimestamp(log.timestamp)}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Modal>
    );
};


// --- 4. USER MANUAL MODAL ---
const UserManualModal = ({ isOpen, onClose, onBack }) => {
    const [manualContent, setManualContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            const docRef = doc(db, 'system_docs', 'user_manual');
            getDoc(docRef)
                .then(docSnap => {
                    if (docSnap.exists()) {
                        // Sanitize the HTML content before setting it
                        const cleanHtml = DOMPurify.sanitize(docSnap.data().content);
                        setManualContent(cleanHtml);
                    } else {
                        setManualContent('<p>User manual not found.</p>');
                    }
                    setIsLoading(false);
                })
                .catch(error => {
                    console.error("Error fetching user manual:", error);
                    setManualContent('<p>Error loading content.</p>');
                    setIsLoading(false);
                });
        }
    }, [isOpen]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} onBack={onBack} title="User Manual" maxWidth="max-w-4xl">
            {isLoading ? <LoadingSpinner /> : (
                <div 
                    className="prose prose-sm max-w-none" 
                    dangerouslySetInnerHTML={{ __html: manualContent }} 
                />
            )}
        </Modal>
    );
};


// --- 5. MAIN APP COMPONENT ---

function App() {
    // Authentication State
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showProfile, setShowProfile] = useState(false);

    // Modal State
    const [activeModal, setActiveModal] = useState(null);
    const [modalHistory, setModalHistory] = useState([]);
     const [isSidebarOpen, setIsSidebarOpen] = useState(true);


    // --- Authentication Logic ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleSignOut = async () => {
        try {
            await firebaseSignOut(auth);
            setUser(null);
            setShowProfile(false); // Hide profile dropdown on logout
        } catch (error) {
            console.error("Sign out error:", error);
        }
    };

    // --- Modal Navigation ---
    const openModal = (modalName) => {
        setModalHistory([...modalHistory, activeModal]);
        setActiveModal(modalName);
    };

    const closeModal = () => {
        setActiveModal(null);
        setModalHistory([]); // Reset history on close
    };

    const goBack = () => {
        const lastModal = modalHistory[modalHistory.length - 1];
        setActiveModal(lastModal);
        setModalHistory(modalHistory.slice(0, -1));
    };


    // --- Main Render ---
    if (loading) {
        return <LoadingSpinner />;
    }

    if (!user) {
        // Simple Sign-in UI
        const handleSignIn = async (e) => {
            e.preventDefault();
            const email = e.target.email.value;
            const password = e.target.password.value;
            try {
                const { getAuth, signInWithEmailAndPassword } = await import("firebase/auth");
                const auth = getAuth();
                await signInWithEmailAndPassword(auth, email, password);
            } catch (error) {
                alert(error.message);
            }
        };

        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
                    <h2 className="text-2xl font-bold text-center text-gray-900">Sign In</h2>
                    <form onSubmit={handleSignIn} className="space-y-6">
                        <div>
                            <label className="text-sm font-medium text-gray-700">Email</label>
                            <input name="email" type="email" required className="w-full px-3 py-2 mt-1 border rounded-md" />
                        </div>
                        <div>
                             <label className="text-sm font-medium text-gray-700">Password</label>
                            <input name="password" type="password" required className="w-full px-3 py-2 mt-1 border rounded-md" />
                        </div>
                        <button type="submit" className="w-full py-2 text-sm font-semibold text-white bg-blue-600 rounded-md">Sign In</button>
                    </form>
                </div>
            </div>
        );
    }
    
    // --- Main Application Dashboard ---
    return (
        <DndProvider backend={HTML5Backend}>
            <div className="flex h-screen bg-slate-100 font-sans">
                
                {/* === Left Sidebar: Main Navigation === */}
                 <aside className="w-64 bg-slate-800 text-slate-300 flex flex-col">
                    <div className="p-4 border-b border-slate-700">
                        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Zap size={24} className="text-blue-400"/> Accrad</h1>
                    </div>

                    <nav className="flex-1 p-4 space-y-2">
                        <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium bg-slate-900 text-white"><Home size={16}/> Dashboard</a>
                        <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-slate-700"><Users size={16}/> Team Members</a>
                        <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-slate-700"><Database size={16}/> Data Sources</a>
                        <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-slate-700"><Server size={16}/> Integrations</a>
                    </nav>

                    <div className="p-4 border-t border-slate-700">
                         <div 
                            className="flex items-center gap-3 cursor-pointer"
                            onClick={() => setShowProfile(!showProfile)}
                        >
                            <img src={user.photoURL || `https://i.pravatar.cc/40?u=${user.uid}`} alt="User" className="w-8 h-8 rounded-full" />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-white">{user.displayName || "User"}</p>
                                <p className="text-xs text-slate-400">{user.email}</p>
                            </div>
                        </div>
                        {showProfile && <UserProfile user={user} onLogout={handleSignOut} />}
                    </div>
                </aside>


                {/* === Main Content Area === */}
                <main className="flex-1 p-8 overflow-y-auto">
                    <header className="mb-8">
                        <h2 className="text-3xl font-bold text-slate-800">Dashboard</h2>
                        <p className="text-slate-500">Welcome back, {user.displayName || user.email}. Here's your workspace.</p>
                    </header>
                    
                    {/* Quick Actions Grid */}
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div onClick={() => openModal('workingSheet')} className="bg-white p-6 rounded-lg shadow-sm hover:shadow-lg transition-shadow cursor-pointer flex items-center gap-4">
                            <FileSpreadsheet size={32} className="text-blue-500"/>
                            <div>
                                <h3 className="font-bold text-slate-800">Working Sheet</h3>
                                <p className="text-sm text-slate-500">Open the main spreadsheet.</p>
                            </div>
                        </div>
                         <div onClick={() => openModal('systemLog')} className="bg-white p-6 rounded-lg shadow-sm hover:shadow-lg transition-shadow cursor-pointer flex items-center gap-4">
                            <Clock size={32} className="text-green-500"/>
                            <div>
                                <h3 className="font-bold text-slate-800">System Log</h3>
                                <p className="text-sm text-slate-500">View activity logs.</p>
                            </div>
                        </div>
                        <div onClick={() => openModal('userManual')} className="bg-white p-6 rounded-lg shadow-sm hover:shadow-lg transition-shadow cursor-pointer flex items-center gap-4">
                            <BookOpen size={32} className="text-purple-500"/>
                            <div>
                                <h3 className="font-bold text-slate-800">User Manual</h3>
                                <p className="text-sm text-slate-500">Read the documentation.</p>
                            </div>
                        </div>
                        <div className="bg-white p-6 rounded-lg shadow-sm hover:shadow-lg transition-shadow cursor-pointer flex items-center gap-4">
                            <Settings size={32} className="text-slate-500"/>
                            <div>
                                <h3 className="font-bold text-slate-800">Settings</h3>
                                <p className="text-sm text-slate-500">Configure your application.</p>
                            </div>
                        </div>
                    </div>
                </main>

                {/* === Modals === */}
                <WorkingSheetModal 
                    isOpen={activeModal === 'workingSheet'}
                    onClose={closeModal}
                    onBack={goBack}
                    user={user}
                    isSidebarOpen={isSidebarOpen}
                    setIsSidebarOpen={setIsSidebarOpen}
                />
                
                <SystemLogModal 
                    isOpen={activeModal === 'systemLog'}
                    onClose={closeModal}
                    onBack={goBack}
                />

                <UserManualModal
                    isOpen={activeModal === 'userManual'}
                    onClose={closeModal}
                    onBack={goBack}
                />

            </div>
        </DndProvider>
    );
}

export default App;
