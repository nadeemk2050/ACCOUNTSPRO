const createMockUser = (email) => {
    const isDeveloper = email === 'nadeemalsaham@gmail.com';
    const uid = isDeveloper ? 'nadeem_dev_uid' : 'offline-admin';
    const role = isDeveloper ? 'developer' : 'admin';
    const ownerId = isDeveloper ? 'offline-admin' : undefined;

    return {
        uid: uid,
        email: email,
        role: role,
        roles: [role],
        permissions: { [role]: true },
        getIdTokenResult: async () => ({
            claims: { [role]: true, role: role, ownerId: ownerId },
            token: 'mock-token'
        }),
        getIdToken: async () => 'mock-token',
        metadata: {
            creationTime: new Date().toISOString(),
            lastSignInTime: new Date().toISOString()
        }
    };
};

let currentMockUser = null;
try {
    const stored = localStorage.getItem('nadtally_mock_auth_email');
    if (stored) {
        currentMockUser = createMockUser(stored);
    }
} catch (e) { }

let authStateListeners = [];

export const getAuth = () => ({ currentUser: currentMockUser });

export const onAuthStateChanged = (auth, cb) => {
    authStateListeners.push(cb);
    cb(currentMockUser);
    return () => {
        authStateListeners = authStateListeners.filter(l => l !== cb);
    };
};

export const signInWithEmailAndPassword = async (auth, e, p) => {
    currentMockUser = createMockUser(e);
    localStorage.setItem('nadtally_mock_auth_email', e);

    // Turn off educational mode if they login normally
    localStorage.removeItem('nadtally_edu_v1');
    window.licenseMode = 'approved';

    authStateListeners.forEach(cb => cb(currentMockUser));
    return { user: currentMockUser };
};

export const createUserWithEmailAndPassword = async (auth, e, p) => {
    currentMockUser = createMockUser(e);
    localStorage.setItem('nadtally_mock_auth_email', e);
    authStateListeners.forEach(cb => cb(currentMockUser));
    return { user: currentMockUser };
};

export const signOut = async () => {
    currentMockUser = null;
    localStorage.removeItem('nadtally_mock_auth_email');
    authStateListeners.forEach(cb => cb(currentMockUser));
};

export const updatePassword = async () => { };
export const signInWithCustomToken = async () => {
    currentMockUser = createMockUser('offline@nadtally.local');
    localStorage.setItem('nadtally_mock_auth_email', 'offline@nadtally.local');
    authStateListeners.forEach(cb => cb(currentMockUser));
    return { user: currentMockUser };
};
export const signInAnonymously = async () => {
    currentMockUser = createMockUser('offline@nadtally.local');
    localStorage.setItem('nadtally_mock_auth_email', 'offline@nadtally.local');
    authStateListeners.forEach(cb => cb(currentMockUser));
    return { user: currentMockUser };
};
export const sendPasswordResetEmail = async () => { };
