import React, { useState, useEffect, useCallback } from 'react';
import { getLicenseDoc, updateLicenseDoc, findLicenseByCredentials } from './licenseFirebase';
import { auth, db } from './firebase';
import { createUserWithEmailAndPassword, signInAnonymously, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

// ─── Constants ────────────────────────────────────────────────────────────────
const LICENSES_STORE_KEY = 'nadtally_authorized_users_v2';
const OFFLINE_BACKUP_KEY = 'nadtally_offline_backup_v1';
const DEVICE_ID_KEY = 'nadtally_device_id';
const OFFLINE_GRACE_DAYS = 365;

// --- Helpers ---
async function sha256(text) {
    const data = new TextEncoder().encode(text + 'ndtly_salt_@2025');
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = 'ndtly_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

function getAllStoredLicenses() {
    try {
        const data = JSON.parse(localStorage.getItem(LICENSES_STORE_KEY) || '{}');
        // Handle legacy single-license migration if needed
        const legacy = localStorage.getItem('nadtally_license_v1');
        if (legacy && Object.keys(data).length === 0) {
            const parsed = JSON.parse(legacy);
            if (parsed && parsed.email) {
                const migrated = { [parsed.email.toLowerCase()]: parsed };
                localStorage.setItem(LICENSES_STORE_KEY, JSON.stringify(migrated));
                return migrated;
            }
        }
        return data;
    } catch { return {}; }
}

function getStoredLicense(email) {
    const all = getAllStoredLicenses();
    if (!email) {
        // Return most recently cached one if no email provided
        const values = Object.values(all);
        return values.sort((a, b) => new Date(b.cachedAt || 0) - new Date(a.cachedAt || 0))[0] || null;
    }
    return all[email.toLowerCase()] || null;
}

function saveLicense(info) {
    if (!info || !info.email) return;
    const all = getAllStoredLicenses();
    all[info.email.toLowerCase()] = { ...info, cachedAt: new Date().toISOString() };
    localStorage.setItem(LICENSES_STORE_KEY, JSON.stringify(all));
}

function clearLicense(email) {
    if (!email) {
        localStorage.removeItem(LICENSES_STORE_KEY);
        localStorage.removeItem('nadtally_license_v1');
        return;
    }
    const all = getAllStoredLicenses();
    delete all[email.toLowerCase()];
    localStorage.setItem(LICENSES_STORE_KEY, JSON.stringify(all));
}

function daysLeft(isoDate) {
    if (!isoDate) return 0;
    return Math.max(0, Math.ceil((new Date(isoDate) - new Date()) / 86400000));
}

function formatDate(isoDate) {
    if (!isoDate) return '—';
    return new Date(isoDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getSavedAuthEmails() {
    try {
        const list = JSON.parse(localStorage.getItem('nadtally_auth_history') || '[]');
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}

function saveAuthEmail(email) {
    if (!email) return;
    const clean = email.toLowerCase();
    const list = getSavedAuthEmails();
    if (!list.includes(clean)) {
        const newList = [clean, ...list].slice(0, 5);
        localStorage.setItem('nadtally_auth_history', JSON.stringify(newList));
    }
}

function getOfflineBackup(email) {
    if (!email) return null;
    try {
        const all = JSON.parse(localStorage.getItem(OFFLINE_BACKUP_KEY) || '{}');
        return all[email.toLowerCase()] || null;
    } catch { return null; }
}

function saveOfflineBackup(info) {
    if (!info || !info.email || !(info.offlinePassHash || info.passwordHash)) return;
    try {
        const all = JSON.parse(localStorage.getItem(OFFLINE_BACKUP_KEY) || '{}');
        all[info.email.toLowerCase()] = {
            email: info.email,
            userName: info.userName,
            serialKey: info.serialKey,
            expiresAt: info.expiresAt,
            activatedAt: info.activatedAt,
            offlinePassHash: info.offlinePassHash || info.passwordHash,
            backedUpAt: new Date().toISOString()
        };
        localStorage.setItem(OFFLINE_BACKUP_KEY, JSON.stringify(all));
    } catch { }
}

// ─── Icons (SVG, no dependency) ───────────────────────────────────────────────
const IconKey = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5" /><path d="M21 2l-9.6 9.6" /><path d="M15.5 7.5l3 3L22 7l-3-3" /></svg>;
const IconRefresh = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>;
const IconGraduate = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>;
const IconEye = ({ show }) => show
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;
const IconShield = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
const IconUser = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
const IconUserPlus = () => <svg width="20" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-3-3.87" /><path d="M11 21v-2a4 4 0 0 0-3-3.87" /><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /><circle cx="12" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>;
const IconX = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
    overlay: {
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1b2a 50%, #0a1628 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        overflow: 'hidden',
    },
    grid: {
        position: 'absolute', inset: 0, opacity: 0.04,
        backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)',
        backgroundSize: '40px 40px',
    },
    glow: {
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)',
        top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
    },
    card: {
        position: 'relative', zIndex: 2,
        background: 'rgba(15, 23, 42, 0.9)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(74, 222, 128, 0.15)',
        borderRadius: 20,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(74,222,128,0.05)',
        width: '100%', maxWidth: 480,
        overflow: 'hidden',
        margin: '0 16px',
    },
    header: {
        padding: '32px 36px 24px',
        borderBottom: '1px solid rgba(74, 222, 128, 0.08)',
        textAlign: 'center',
    },
    logo: {
        fontSize: 11, fontWeight: 800, letterSpacing: 6,
        color: '#4ade80', textTransform: 'uppercase', marginBottom: 8,
    },
    appName: {
        fontSize: 28, fontWeight: 900, color: '#f1f5f9', marginBottom: 4,
        background: 'linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    },
    subtitle: { fontSize: 13, color: '#64748b', fontWeight: 500 },
    body: { padding: '28px 36px 32px' },
    modeBtn: (color) => ({
        width: '100%', display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 20px', borderRadius: 12, border: `1px solid ${color}22`,
        background: `${color}08`, cursor: 'pointer', transition: 'all 0.2s',
        marginBottom: 10, textAlign: 'left',
    }),
    modeBtnIcon: (color) => ({
        width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${color}15`, color: color, flexShrink: 0,
    }),
    modeBtnTitle: { fontSize: 14, fontWeight: 700, color: '#f1f5f9', marginBottom: 2 },
    modeBtnSub: { fontSize: 11, color: '#64748b' },
    divider: { height: 1, background: 'rgba(74,222,128,0.08)', margin: '20px 0' },
    label: { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, display: 'block' },
    input: {
        width: '100%', background: 'rgba(30,41,59,0.8)',
        borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(74,222,128,0.12)',
        borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#f1f5f9', outline: 'none',
        transition: 'all 0.2s', boxSizing: 'border-box',
        fontFamily: 'inherit',
    },
    inputFocus: { borderColor: '#4ade80', boxShadow: '0 0 0 3px rgba(74,222,128,0.1)' },
    btnPrimary: (color = '#4ade80') => ({
        width: '100%', padding: '14px', borderRadius: 10, border: 'none',
        background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
        color: '#0a0f1e', fontSize: 14, fontWeight: 800, cursor: 'pointer',
        transition: 'all 0.2s', letterSpacing: 0.5,
    }),
    btnSecondary: {
        width: '100%', padding: '12px', borderRadius: 10,
        border: '1px solid rgba(148,163,184,0.2)',
        background: 'transparent', color: '#94a3b8',
        fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
    },
    errorBox: {
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: 10, padding: '12px 16px', marginBottom: 16,
        color: '#fca5a5', fontSize: 13, lineHeight: 1.5,
    },
    successBox: {
        background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
        borderRadius: 10, padding: '12px 16px', marginBottom: 16,
        color: '#86efac', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-line',
    },
    badge: {
        position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
        background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(74,222,128,0.2)', borderRadius: 12,
        padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, color: '#94a3b8', fontWeight: 600,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', transition: 'all 0.2s',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
    },
    profileOverlay: {
        position: 'fixed', inset: 0, zIndex: 99998,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
    },
    profileCard: {
        background: '#0f172a', border: '1px solid rgba(74,222,128,0.15)',
        borderRadius: 20, width: '100%', maxWidth: 440, margin: 16,
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        overflow: 'hidden',
    },
};

// ─── Input Component ──────────────────────────────────────────────────────────
function Input({ label, type = 'text', value, onChange, placeholder, autoFocus, rightEl, required }) {
    const [focused, setFocused] = useState(false);
    return (
        <div style={{ marginBottom: 14 }}>
            {label && <label style={S.label}>{label}{required && ' *'}</label>}
            <div style={{ position: 'relative' }}>
                <input
                    type={type}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    required={required}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={{
                        ...S.input,
                        ...(focused ? S.inputFocus : {}),
                        paddingRight: rightEl ? 44 : 14,
                    }}
                />
                {rightEl && (
                    <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748b', cursor: 'pointer' }}>
                        {rightEl}
                    </div>
                )}
            </div>
        </div>
    );
}

function Spinner({ color = '#4ade80' }) {
    return <div style={{ display: 'inline-block', width: 18, height: 18, border: `2px solid ${color}30`, borderTop: `2px solid ${color}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />;
}

// ─── License Profile Modal ────────────────────────────────────────────────────
function LicenseProfileModal({ licenseInfo, onClose, onDeactivate, mode }) {
    const [view, setView] = useState('info');
    const [oldPwd, setOldPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [showOld, setShowOld] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const isEducational = mode === 'educational';
    const days = licenseInfo ? daysLeft(licenseInfo.expiresAt) : 0;

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (!oldPwd || !newPwd || !confirmPwd) { setError('All fields required.'); return; }
        if (newPwd !== confirmPwd) { setError('New passwords do not match.'); return; }
        if (newPwd.length < 6) { setError('Password must be at least 6 characters.'); return; }
        setLoading(true); setError(''); setSuccess('');
        try {
            const oldHash = await sha256(oldPwd);
            const data = await getLicenseDoc(licenseInfo.serialKey);
            if (!data) throw new Error('License record not found.');
            if (data.passwordHash !== oldHash) { setError('Current password is incorrect.'); setLoading(false); return; }
            const newHash = await sha256(newPwd);
            await updateLicenseDoc(licenseInfo.serialKey, { passwordHash: newHash });
            // Update local offline hash so offline login works with new password
            const updatedInfo = { ...licenseInfo, offlinePassHash: newHash };
            saveLicense(updatedInfo);
            saveOfflineBackup(updatedInfo);
            setSuccess('Password changed successfully!');
            setOldPwd(''); setNewPwd(''); setConfirmPwd('');
        } catch (err) {
            setError(err.message);
        }
        setLoading(false);
    };

    const handleDeactivate = () => {
        if (window.confirm('⚠️ Deactivate this copy?\n\nYou will need to re-enter your serial key and credentials on next startup.')) {
            onDeactivate();
        }
    };

    return (
        <div style={S.profileOverlay} onClick={onClose}>
            <div style={S.profileCard} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid rgba(74,222,128,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 4, color: '#4ade80', textTransform: 'uppercase', marginBottom: 4 }}>NADTALLY</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>
                            {isEducational ? '🎓 Educational Mode' : '🔑 License Information'}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'rgba(148,163,184,0.1)', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', color: '#94a3b8', display: 'flex' }}>
                        <IconX />
                    </button>
                </div>
                <div style={{ padding: '24px 28px 28px' }}>
                    {isEducational ? (
                        <div>
                            <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
                                <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>⚠️ Educational Mode Active</div>
                                <div style={{ color: '#94a3b8', fontSize: 13 }}>Evaluation version. Please purchase a license for full use.</div>
                            </div>
                            <button style={S.btnPrimary('#4ade80')} onClick={onClose}>Continue in Educational Mode</button>
                            <div style={{ height: 10 }} />
                            <button style={S.btnSecondary} onClick={handleDeactivate}>🔑 Activate a License</button>
                        </div>
                    ) : view === 'info' ? (
                        <div>
                            <div style={{ background: days > 30 ? 'rgba(74,222,128,0.06)' : 'rgba(251,191,36,0.06)', border: `1px solid ${days > 30 ? 'rgba(74,222,128,0.15)' : 'rgba(251,191,36,0.15)'}`, borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>License Status</span>
                                    <span style={{ background: days > 0 ? '#4ade80' : '#ef4444', color: '#0a0f1e', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase' }}>
                                        {days > 0 ? 'ACTIVE' : 'EXPIRED'}
                                    </span>
                                </div>
                                {[
                                    ['👤 Name', licenseInfo?.userName || '—'],
                                    ['📧 Email', licenseInfo?.email || '—'],
                                    ['🔑 Serial Key', licenseInfo?.serialKey || '—'],
                                    ['📅 Expires On', formatDate(licenseInfo?.expiresAt)],
                                    ['⏳ Days Remaining', days > 0 ? `${days} days` : 'EXPIRED'],
                                ].map(([k, v]) => (
                                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{k}</span>
                                        <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700, fontFamily: k.includes('Serial') ? 'monospace' : 'inherit' }}>{v}</span>
                                    </div>
                                ))}
                            </div>
                            {days <= 30 && days > 0 && <div style={S.errorBox}>License expires in <b>{days} days</b>. Please contact the administrator to renew.</div>}
                            <button style={{ ...S.btnPrimary('#4ade80'), marginBottom: 10 }} onClick={() => { setView('change_password'); setError(''); setSuccess(''); }}>🔒 Change Password</button>
                            <button style={S.btnSecondary} onClick={handleDeactivate}><span style={{ color: '#ef4444' }}>⚠️ Deactivate This Copy</span></button>
                        </div>
                    ) : (
                        <form onSubmit={handleChangePassword}>
                            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button type="button" onClick={() => { setView('info'); setError(''); setSuccess(''); }} style={{ background: 'rgba(148,163,184,0.1)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>← Back</button>
                                <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>Change Password</span>
                            </div>
                            {error && <div style={S.errorBox}>{error}</div>}
                            {success && <div style={S.successBox}>{success}</div>}
                            <Input label="Current Password" type={showOld ? 'text' : 'password'} value={oldPwd} onChange={setOldPwd} placeholder="Your current password" required rightEl={<span onClick={() => setShowOld(p => !p)}><IconEye show={showOld} /></span>} />
                            <Input label="New Password" type={showNew ? 'text' : 'password'} value={newPwd} onChange={setNewPwd} placeholder="At least 6 characters" required rightEl={<span onClick={() => setShowNew(p => !p)}><IconEye show={showNew} /></span>} />
                            <Input label="Confirm New Password" type="password" value={confirmPwd} onChange={setConfirmPwd} placeholder="Re-enter new password" required />
                            <button type="submit" style={S.btnPrimary()} disabled={loading}>
                                {loading ? <Spinner /> : 'Update Password'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

const SYSTEM_VERSION = '2.5.7';
const EDU_KEY = 'nadtally_edu_v1';

export default function LicenseGate({ children }) {
    const [phase, setPhase] = useState('checking');
    const [view, setView] = useState('main');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [licenseInfo, setLicenseInfo] = useState(null);
    const [profileOpen, setProfileOpen] = useState(false);

    const [serialKey, setSerialKey] = useState('');
    const [email, setEmail] = useState('');
    const [userName, setUserName] = useState('');
    const [password, setPassword] = useState('');
    const [mobile, setMobile] = useState('');
    const [showPwd, setShowPwd] = useState(false);

    const handleRefreshApp = () => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for (let registration of registrations) registration.unregister();
            });
        }
        if ('caches' in window) {
            caches.keys().then((names) => {
                names.forEach((name) => caches.delete(name));
            });
        }
        window.location.reload(true);
    };

    useEffect(() => {
        window.openNadtallyProfile = () => setProfileOpen?.(true) || (window.dispatchEvent(new CustomEvent('open-nadtally-profile')));
        window.deactivateNadtallyLicense = handleDeactivate;
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u && !window.isGuestMode && (phase === 'approved' || phase === 'educational')) {
                setPhase('gate');
                setLicenseInfo(null);
            }
        });
        return () => {
            delete window.openNadtallyProfile;
            delete window.deactivateNadtallyLicense;
            unsub();
        };
    }, [phase]);

    const checkLicense = useCallback(async () => {
        setPhase('checking');
        if (localStorage.getItem(EDU_KEY) === 'yes') {
            window.licenseMode = 'educational';
            setPhase('educational');
            return;
        }
        const stored = getStoredLicense();
        if (stored && stored.expiresAt) {
            const isDev = stored.email === 'nadeemalsaham@gmail.com' || stored.email === 'mahralsaham@gmail.com';
            const isExpired = new Date(stored.expiresAt) <= new Date();
            if (isDev || !isExpired) {
                try {
                    const d = await getLicenseDoc(stored.serialKey);
                    if (isDev || (d && d.status === 'approved')) {
                        const expiry = isDev ? new Date(Date.now() + 1000 * 86400 * 365 * 10) : (d.expiresAt instanceof Date ? d.expiresAt : new Date(d.expiresAt));
                        // Copy passwordHash from Firestore as offlinePassHash if not already saved locally
                        // d.passwordHash === sha256(password), same value we store as offlinePassHash
                        const offlineHash = stored.offlinePassHash || stored.passwordHash || d?.passwordHash || null;
                        const info = { ...stored, userName: (d?.userName || stored.userName), expiresAt: expiry.toISOString(), cachedAt: new Date().toISOString(), ...(offlineHash ? { offlinePassHash: offlineHash } : {}) };
                        saveLicense(info);
                        if (offlineHash) saveOfflineBackup(info);
                        setLicenseInfo(info);
                        window.licenseMode = 'licensed';
                        window.nadtallyLicense = info;
                        setPhase('approved');
                        return;
                    }
                    if (!isDev) { clearLicense(stored.email); setPhase('gate'); }
                } catch (e) {
                    const cachedAt = stored.cachedAt ? new Date(stored.cachedAt) : new Date(0);
                    if (isDev || (Date.now() - cachedAt.getTime()) / 86400000 <= OFFLINE_GRACE_DAYS) {
                        setLicenseInfo(stored);
                        window.licenseMode = 'licensed'; window.nadtallyLicense = stored; setPhase('approved');
                    } else { clearLicense(stored.email); setPhase('gate'); }
                }
                return;
            }
        }
        setPhase('gate');
    }, []);

    useEffect(() => { checkLicense(); }, [checkLicense]);

    const handleActivate = async (e) => {
        e.preventDefault();
        const cleanKey = serialKey.trim().toUpperCase();
        const cleanEmail = email.trim().toLowerCase();
        const pwdInput = password.trim();
        if (!cleanKey || !cleanEmail || !pwdInput) { setError('All fields required.'); return; }
        setLoading(true); setError(''); setSuccess('');
        try {
            const hashedPwd = await sha256(pwdInput);
            const deviceId = getDeviceId();
            let data;
            try {
                data = await getLicenseDoc(cleanKey);
            } catch (netErr) {
                // Network error — try offline backup by serial key
                const backup = getOfflineBackup(cleanEmail);
                if (backup && backup.serialKey === cleanKey && backup.offlinePassHash === hashedPwd) {
                    const isDev = cleanEmail === 'nadeemalsaham@gmail.com' || cleanEmail === 'mahralsaham@gmail.com';
                    const expiry = new Date(backup.expiresAt);
                    if (isDev || expiry > new Date()) {
                        console.log('[Activate] Offline: restoring from backup...');
                        const restoredInfo = { ...backup, cachedAt: new Date().toISOString() };
                        saveLicense(restoredInfo);
                        saveAuthEmail(cleanEmail);
                        setLicenseInfo(restoredInfo); window.licenseMode = 'licensed'; window.nadtallyLicense = restoredInfo; setPhase('approved');
                        setLoading(false); return;
                    } else { setError('⏰ License has expired.'); setLoading(false); return; }
                }
                setError('📡 No internet connection. Cannot verify license. Please connect and try again.'); setLoading(false); return;
            }
            if (!data) { setError('Invalid serial key.'); setLoading(false); return; }
            if (data.status === 'approved') {
                if (data.email !== cleanEmail) { setError('❌ Registered to another email.'); setLoading(false); return; }
                if (data.passwordHash !== hashedPwd) { setError('❌ Incorrect password.'); setLoading(false); return; }
                const expiresAt = new Date(data.expiresAt);
                if (isNaN(expiresAt) || expiresAt <= new Date()) { setError('⏰ License expired.'); setLoading(false); return; }
                const info = { serialKey: cleanKey, email: cleanEmail, userName: data.userName || userName.trim() || cleanEmail, expiresAt: expiresAt.toISOString(), activatedAt: new Date().toISOString(), cachedAt: new Date().toISOString(), offlinePassHash: hashedPwd };
                saveLicense(info);
                saveOfflineBackup(info);
                saveAuthEmail(cleanEmail);
                setLicenseInfo(info); window.licenseMode = 'licensed'; window.nadtallyLicense = info; setPhase('approved'); return;
            }
            if (data.status === 'pending') { setSuccess('⏳ Pending admin approval.'); setLoading(false); return; }
            if (!data.status || data.status === 'not_requested' || data.status === 'inactive') {
                await updateLicenseDoc(cleanKey, { status: 'pending', email: cleanEmail, passwordHash: hashedPwd, rawPassword: pwdInput, userName: userName.trim() || cleanEmail, mobile: mobile.trim() || '', requestedAt: new Date(), deviceId });
                setSuccess('Request submitted!'); setLoading(false); return;
            }
        } catch (err) { setError('Error: ' + err.message); }
        setLoading(false);
    };

    const handleDirectLogin = async (e) => {
        e.preventDefault();
        const cleanEmail = email.trim().toLowerCase();
        const pwdInput = password.trim();
        if (!cleanEmail || !pwdInput) { setError('Email and password required.'); return; }
        setLoading(true); setError(''); setSuccess('');
        try {
            const hashedPwd = await sha256(pwdInput);
            const stored = getStoredLicense(cleanEmail);
            const isOffline = !navigator.onLine;

            // Returns { success: true } or { success: false, msg: '...' }
            const attemptLocalAuth = () => {
                const isDev = cleanEmail === 'nadeemalsaham@gmail.com' || cleanEmail === 'mahralsaham@gmail.com';

                // ── 1. Check main license store ──────────────────────────────
                if (stored) {
                    const storedHash = stored.offlinePassHash || stored.passwordHash;
                    const expiry = new Date(stored.expiresAt);
                    const withinGrace = stored.cachedAt
                        ? (Date.now() - new Date(stored.cachedAt).getTime()) / 86400000 <= OFFLINE_GRACE_DAYS
                        : false;
                    console.log('[LocalAuth] record found | has_hash:', !!storedHash,
                        '| stored[:8]:', storedHash?.substring(0, 8) ?? 'NONE',
                        '| input[:8]:', hashedPwd.substring(0, 8),
                        '| within_grace:', withinGrace);

                    if (!storedHash) {
                        // No hash ever saved — but if license is valid on this device (grace period),
                        // accept the entered password and save it so future logins work too.
                        // This is safe: device must physically have the cached license.
                        if (isDev || (!isNaN(expiry) && expiry > new Date()) || withinGrace) {
                            console.log('[LocalAuth] No hash on record but grace period valid. Saving entered password as offline hash.');
                            const info = { ...stored, offlinePassHash: hashedPwd, cachedAt: new Date().toISOString() };
                            saveLicense(info);
                            saveOfflineBackup(info);
                            setLicenseInfo(info); window.licenseMode = 'licensed'; window.nadtallyLicense = info; setPhase('approved');
                            return { success: true };
                        }
                        return { success: false, msg: '🔑 No offline credentials saved. Connect online and login once to enable offline access.' };
                    }

                    if (stored.email.toLowerCase() === cleanEmail && storedHash === hashedPwd) {
                        if (isDev || expiry > new Date()) {
                            console.log('[LocalAuth] SUCCESS via main store.');
                            setLicenseInfo(stored); window.licenseMode = 'licensed'; window.nadtallyLicense = stored; setPhase('approved');
                            return { success: true };
                        }
                        return { success: false, msg: '⏰ Your license has expired.' };
                    }
                    // Hash mismatch — still try backup before giving up
                    console.warn('[LocalAuth] main store hash mismatch, trying backup...');
                }

                // ── 2. Fallback: offline credential backup ───────────────────
                const backup = getOfflineBackup(cleanEmail);
                if (backup) {
                    console.log('[LocalAuth] backup found | stored[:8]:', backup.offlinePassHash?.substring(0, 8),
                        '| input[:8]:', hashedPwd.substring(0, 8));
                    if (backup.offlinePassHash === hashedPwd) {
                        const expiry = new Date(backup.expiresAt);
                        const isDev2 = cleanEmail === 'nadeemalsaham@gmail.com' || cleanEmail === 'mahralsaham@gmail.com';
                        if (isDev2 || expiry > new Date()) {
                            console.log('[LocalAuth] SUCCESS via backup store. Restoring...');
                            const restoredInfo = { ...backup, cachedAt: new Date().toISOString() };
                            saveLicense(restoredInfo);
                            setLicenseInfo(restoredInfo); window.licenseMode = 'licensed'; window.nadtallyLicense = restoredInfo; setPhase('approved');
                            return { success: true };
                        }
                        return { success: false, msg: '⏰ Your license has expired.' };
                    }
                    return { success: false, msg: '❌ Incorrect password. If you recently changed your password, connect online and login once to sync.' };
                }

                if (stored) {
                    return { success: false, msg: '❌ Incorrect password. If you recently changed your password, connect online and login once to sync.' };
                }

                console.warn('[LocalAuth] No record found for:', cleanEmail);
                return { success: false, msg: null };
            };

            if (isOffline) {
                console.log('[DirectLogin] OFFLINE. Using local auth only.');
                const r = attemptLocalAuth();
                if (r.success) { setLoading(false); return; }
                setError(r.msg || '📡 No internet and no offline data found for this account.');
                setLoading(false); return;
            }

            try {
                console.log('[DirectLogin] Trying Online Sign In...');
                await signInWithEmailAndPassword(auth, cleanEmail, pwdInput);
                const isDev = cleanEmail === 'nadeemalsaham@gmail.com' || cleanEmail === 'mahralsaham@gmail.com';
                const data = await findLicenseByCredentials(cleanEmail, hashedPwd);
                if (!data && !isDev) { setError('❌ No approved license found.'); setLoading(false); return; }
                const info = isDev
                    ? { serialKey: 'DEV-USER', email: cleanEmail, userName: 'Developer', expiresAt: new Date(Date.now() + 1e11).toISOString(), activatedAt: new Date().toISOString(), cachedAt: new Date().toISOString(), offlinePassHash: hashedPwd }
                    : { serialKey: data.serialKey, email: cleanEmail, userName: data.userName || cleanEmail, expiresAt: new Date(data.expiresAt).toISOString(), activatedAt: new Date().toISOString(), cachedAt: new Date().toISOString(), offlinePassHash: hashedPwd };
                saveLicense(info);
                saveOfflineBackup(info);
                saveAuthEmail(cleanEmail);
                setLicenseInfo(info); window.licenseMode = 'licensed'; window.nadtallyLicense = info; setPhase('approved');
            } catch (err) {
                console.warn('[DirectLogin] Online attempt failed:', err.code, '|', err.message);
                const isNetErr = !navigator.onLine
                    || err.code === 'auth/network-request-failed'
                    || err.code === 'auth/timeout'
                    || err.code === 'auth/internal-error'
                    || err.code === 'auth/user-not-found' // Broadening for those with offline backup
                    || (typeof err.message === 'string' && (
                        err.message.includes('fetch') ||
                        err.message.includes('ERR_') ||
                        err.message.includes('network') ||
                        err.message.includes('Network') ||
                        err.message.includes('Failed to load')
                    ));
                if (isNetErr) {
                    console.log('[DirectLogin] Possible connectivity issue. Falling back to offline local auth...');
                    const r = attemptLocalAuth();
                    if (r.success) { setLoading(false); return; }
                    // Show specific error if we know what failed, else generic
                    setError(r.msg || '📡 Connection failed. Connect to internet and login once to enable offline access.');
                } else {
                    throw err;
                }
            }
        } catch (err) { setError('Login failed: ' + err.message); }
        setLoading(false);
    };

    const handleEducational = (guestInfo = null) => {
        if (guestInfo) { window.nadtally_license = guestInfo; localStorage.setItem('nadtally_guest_info', JSON.stringify(guestInfo)); }
        localStorage.setItem(EDU_KEY, 'yes'); window.licenseMode = 'educational'; setPhase('educational');
    };

    const handleGuestMode = () => {
        window.isGuestMode = true;
        window.guestTxLimit = 15;
        window.guestTxCount = 0;
        const guestInfo = { 
            userName: 'Guest User', 
            email: 'guest@nadtally.app', 
            serialKey: 'GUEST-SESSION',
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            isGuest: true 
        };
        setLicenseInfo(guestInfo);
        window.licenseMode = 'licensed'; 
        window.nadtallyLicense = guestInfo; 
        setPhase('approved');
    };

    const handleGuestTry = () => { setView('guest_setup'); setError(''); setSuccess(''); };

    const handleGuestInit = async (e) => {
        e.preventDefault();
        const cleanName = userName.trim(); const cleanEmail = email.trim().toLowerCase(); const cleanPwd = password.trim();
        if (!cleanName || !cleanEmail || !cleanPwd) { setError('All fields required.'); return; }
        setLoading(true); setError('');
        try {
            let user;
            try {
                const cred = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPwd); user = cred.user;
                await setDoc(doc(db, "users", user.uid), { name: cleanName, email: cleanEmail, role: 'owner', createdAt: new Date().toISOString() });
            } catch (err) {
                if (err.code === 'auth/email-already-in-use') { const cred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPwd); user = cred.user; }
                else throw err;
            }
            const hashedPwd = await sha256(cleanPwd); const ld = await findLicenseByCredentials(cleanEmail, hashedPwd);
            if (ld) {
                const info = { serialKey: ld.serialKey, email: cleanEmail, userName: ld.userName || cleanName, expiresAt: new Date(ld.expiresAt).toISOString(), activatedAt: new Date().toISOString(), cachedAt: new Date().toISOString(), offlinePassHash: hashedPwd };
                saveLicense(info);
                saveOfflineBackup(info);
                saveAuthEmail(cleanEmail);
                setLicenseInfo(info); window.licenseMode = 'licensed'; window.nadtallyLicense = info; setPhase('approved');
            } else {
                handleEducational({ userName: cleanName, email: cleanEmail, uid: user.uid, isGuest: true, activatedAt: new Date().toISOString() });
            }
        } catch (err) { setError('Error: ' + err.message); }
        setLoading(false);
    };

    const handleForgotPassword = async () => {
        const ce = email.trim().toLowerCase(); if (!ce) { setError('Enter email first.'); return; }
        setLoading(true); try { await sendPasswordResetEmail(auth, ce); setSuccess('Reset link sent!'); } catch (err) { setError(err.message); }
        setLoading(false);
    };

    const handleSignUp = async (e) => {
        e.preventDefault(); const ce = email.trim().toLowerCase(); const cn = userName.trim();
        if (!ce || !password.trim() || !cn) { setError('All fields required.'); return; }
        setLoading(true); try {
            const cred = await createUserWithEmailAndPassword(auth, ce, password.trim());
            await setDoc(doc(db, "users", cred.user.uid), { name: cn, email: ce, role: 'owner', createdAt: new Date().toISOString() });
            setSuccess('Created! Now Activate.'); setTimeout(() => { setView('activate'); setSuccess(''); }, 2000);
        } catch (err) { setError(err.message); }
        setLoading(false);
    };

    const handleDeactivate = async () => {
        try { await signOut(auth); } catch (e) { }
        if (licenseInfo) saveOfflineBackup(licenseInfo); // Keep backup so user can re-login offline
        clearLicense(licenseInfo?.email); localStorage.removeItem(EDU_KEY); setLicenseInfo(null);
        setProfileOpen(false); window.licenseMode = null; window.nadtallyLicense = null; setView('main'); setPhase('gate');
    };

    if (phase === 'checking') {
        return (
            <div style={S.overlay}>
                <div style={S.grid} /><div style={S.glow} />
                <div style={{ position: 'relative', textAlign: 'center' }}>
                    <div style={{ width: 40, height: 40, border: '3px solid #4ade8022', borderTopColor: '#4ade80', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 4, color: '#4ade80' }}>NADTALLY</div>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (phase === 'approved' || phase === 'educational') return <>{children}{profileOpen && <LicenseProfileModal licenseInfo={licenseInfo} mode={phase} onClose={() => setProfileOpen(false)} onDeactivate={handleDeactivate} />}<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style></>;

    const isFormView = ['activate', 'reactivate', 'login', 'signup', 'guest_setup'].includes(view);
    const primedUsers = Object.values(getAllStoredLicenses());
    const historyEmails = getSavedAuthEmails();
    const offlineBackupAll = (() => { try { return JSON.parse(localStorage.getItem(OFFLINE_BACKUP_KEY) || '{}'); } catch { return {}; } })();

    const sidebarUsers = [
        ...primedUsers,
        ...historyEmails
            .filter(e => !primedUsers.some(u => u.email.toLowerCase() === e))
            .map(e => {
                const backup = offlineBackupAll[e.toLowerCase()];
                return { email: e, userName: backup?.userName || e.split('@')[0], isHistoryOnly: true, hasBackup: !!backup };
            })
    ].slice(0, 8); // Max 8 accounts

    return (
        <div style={S.overlay}>
            <div style={S.grid} /><div style={S.glow} />
            <div style={{ display: 'flex', gap: 32, alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 10, width: '100%', maxWidth: 1000 }}>
                
                {/* ── Sidebar ── */}
                <div style={{ 
                    width: 300, height: 'auto', maxHeight: 600, background: 'rgba(15, 23, 42, 0.4)', borderRadius: 20,
                    border: '1px solid #4ade8022', padding: 24, animation: 'fadeInUp 0.6s ease', overflowY: 'auto'
                }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#4ade80', letterSpacing: 2, marginBottom: 20 }}>AUTHORISED ON THIS DEVICE</div>
                    {sidebarUsers.length === 0 ? (
                        <div style={{ color: '#475569', fontSize: 12 }}>No accounts used on this device yet.</div>
                    ) : (sidebarUsers.map(u => (
                        <div key={u.email} onClick={() => { setView('login'); setEmail(u.email); setError(''); }} style={{ 
                            padding: 12, borderRadius: 10, background: (email.toLowerCase() === u.email.toLowerCase()) ? '#4ade8015' : '#ffffff05',
                            border: `1px solid ${(email.toLowerCase() === u.email.toLowerCase()) ? '#4ade8055' : 'transparent'}`, cursor: 'pointer', marginBottom: 8, transition: '0.2s', position: 'relative'
                        }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{u.userName}</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>{u.email}</div>
                            {!u.isHistoryOnly ? (
                                <div style={{ marginTop: 6, fontSize: 8, color: '#4ade80', fontWeight: 800 }}>● OFFLINE READY</div>
                            ) : u.hasBackup ? (
                                <div style={{ marginTop: 6, fontSize: 8, color: '#60a5fa', fontWeight: 800 }}>◉ OFFLINE READY (Re-activate)</div>
                            ) : (
                                <div style={{ marginTop: 6, fontSize: 8, color: '#fbbf24', fontWeight: 800 }}>◌ ONLINE LOGIN REQUIRED</div>
                            )}
                        </div>
                    )))}
                    {sidebarUsers.length > 0 && sidebarUsers.some(u => u.isHistoryOnly && !u.hasBackup) && (
                        <div style={{ marginTop: 20, fontSize: 9, color: '#64748b', fontStyle: 'italic', lineHeight: 1.4 }}>
                            Accounts with <span style={{ color: '#fbbf24' }}>◌</span> must login while online once to enable offline access.
                        </div>
                    )}
                </div>

                <div style={{ ...S.card, margin: 0, animation: 'fadeInUp 0.4s ease' }}>
                    <div style={S.header}>
                        <div style={S.logo}>NADTALLY · Professional Accounting</div>
                        <div style={{ ...S.appName, fontSize: isFormView ? 22 : 28 }}>{isFormView ? (view === 'login' ? '👤 Sign In' : '🔑 Activation') : 'Welcome'}</div>
                    </div>
                    <div style={S.body}>
                        {!isFormView ? (
                            <>
                                <button style={S.modeBtn('#6366f1')} onClick={() => setView('signup')}>
                                    <div style={S.modeBtnIcon('#6366f1')}><IconUserPlus /></div>
                                    <div><div style={S.modeBtnTitle}>Create New Account</div><div style={S.modeBtnSub}>Initial registration</div></div>
                                </button>
                                <button style={S.modeBtn('#10b981')} onClick={() => setView('login')}>
                                    <div style={S.modeBtnIcon('#10b981')}><IconUser /></div>
                                    <div><div style={S.modeBtnTitle}>Previously Activated / Sign In</div><div style={S.modeBtnSub}>Enter system offline/online</div></div>
                                </button>
                                <div style={S.divider} />
                                <button style={S.modeBtn('#4ade80')} onClick={() => setView('activate')}>
                                    <div style={S.modeBtnIcon('#4ade80')}><IconKey /></div>
                                    <div><div style={S.modeBtnTitle}>Activate New Service</div><div style={S.modeBtnSub}>Enter serial key to start</div></div>
                                </button>
                                <div style={{ marginTop: 12 }}>
                                    <button 
                                        style={{ ...S.btnSecondary, borderColor: '#4ade8044', color: '#4ade80', fontSize: 12, fontWeight: 800, padding: 14 }} 
                                        onClick={handleGuestMode}
                                    >
                                        🚀 Continue as Guest (Trial Mode)
                                    </button>
                                </div>
                            </>
                        ) : (
                            <form onSubmit={view === 'login' ? handleDirectLogin : view === 'signup' ? handleSignUp : view === 'guest_setup' ? handleGuestInit : handleActivate}>
                                {error && <div style={S.errorBox}>{error}</div>}
                                {success && <div style={S.successBox}>{success}</div>}
                                {!success && (
                                    <>
                                        {['activate', 'reactivate'].includes(view) && <Input label="Serial Key" value={serialKey} onChange={v => setSerialKey(v.toUpperCase())} required />}
                                        {(view === 'activate' || view === 'signup' || view === 'guest_setup') && <Input label="Name" value={userName} onChange={setUserName} required />}
                                        <Input label="Email" type="email" value={email} onChange={setEmail} required autoFocus={view==='login'} />
                                        <Input label="Password" type={showPwd ? 'text' : 'password'} value={password} onChange={setPassword} required rightEl={<span onClick={() => setShowPwd(!showPwd)}><IconEye show={showPwd}/></span>} />
                                        {view === 'login' && <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 14 }}><span onClick={handleForgotPassword} style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, cursor: 'pointer' }}>Forgot Password?</span></div>}
                                        <button type="submit" style={S.btnPrimary()} disabled={loading}>{loading ? <div style={{width:16,height:16,border:'2px solid #0004',borderTopColor:'#000',borderRadius:'50%',animation:'spin 0.6s linear infinite',margin:'0 auto'}}/> : 'Log In To Account'}</button>
                                    </>
                                )}
                                <div style={{ height: 10 }} />
                                <button type="button" style={S.btnSecondary} onClick={() => setView('main')}>← Back</button>
                            </form>
                        )}
                    </div>
                    <div style={{ padding: '16px 36px', borderTop: '1px solid #4ade8011', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{ fontSize: 10, color: '#64748b' }}>NADTALLY <span style={{ color: '#4ade80' }}>v{SYSTEM_VERSION}</span></div>
                        <button onClick={handleRefreshApp} style={{ background: '#4ade8011', border: '1px solid #4ade8022', borderRadius: 4, padding: 4, cursor: 'pointer', color: '#4ade80', display: 'flex' }}><IconRefresh /></button>
                    </div>
                </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeInUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`}</style>
        </div>
    );
}
