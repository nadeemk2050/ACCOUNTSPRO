import React, { useState } from 'react'
import { 
  Building2, Key, Shield, Mail, User, Calendar, 
  RefreshCw, CheckCircle, AlertCircle, Copy, Check,
  Users, Hash, Clock
} from 'lucide-react'

export default function Profile({ company, subUser, onRefresh }) {
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  const copyToClip = (text) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatDate = (ts) => {
    if (!ts) return 'N/A'
    try {
      const d = typeof ts === 'number' ? new Date(ts) : new Date(ts.seconds ? ts.seconds * 1000 : ts)
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    } catch { return 'N/A' }
  }

  const license = company?.license

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Company Profile</h1>
          <p className="text-sm text-slate-500 mt-1">Your AccountsPro company information</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-secondary text-xs"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Company Info Card */}
      <div className="card">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
            <Building2 size={28} className="text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Company Name</label>
              <input
                type="text"
                value={company?.name || 'AccountsPro Company'}
                onChange={(e) => {
                  const updated = { ...company, name: e.target.value }
                  // Save to state and localStorage via direct update
                  localStorage.setItem('quickaccpro_company', JSON.stringify(updated))
                  // Simply let page refresh on state change if layout listens
                  window.location.reload()
                }}
                className="text-lg font-bold text-slate-800 bg-transparent border-b border-dashed border-slate-300 hover:border-indigo-500 focus:border-indigo-600 outline-none pb-0.5"
                placeholder="Enter Company Name..."
                title="Click to edit company name"
              />
            </div>
            <p className="text-xs text-slate-500 mt-2">Company ID: <span className="font-mono text-slate-600">{company?.id || '—'}</span></p>
            
            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Users size={13} />
                <span>{company?.teamCount || 0} team member{(company?.teamCount || 0) !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <CheckCircle size={13} className="text-green-500" />
                <span>Connected</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* License Information */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-indigo-600" />
          <h2 className="text-sm font-bold text-slate-700">License & Serial Information</h2>
        </div>

        {license ? (
          <div className="space-y-4">
            {/* Serial Key */}
            <div className="bg-slate-900 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Serial Key</span>
                <button
                  onClick={() => copyToClip(license.serialKey)}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors"
                  title="Copy serial key"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-green-400 font-mono text-sm tracking-widest break-all">
                {license.serialKey || '—'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                  <User size={11} className="inline mr-1" />
                  Licensed User
                </label>
                <p className="text-sm font-medium text-slate-800">{license.userName || '—'}</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                  <Mail size={11} className="inline mr-1" />
                  Email
                </label>
                <p className="text-sm font-medium text-slate-800">{license.email || '—'}</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                  <Hash size={11} className="inline mr-1" />
                  Status
                </label>
                <span className={`badge mt-0.5 ${license.status === 'active' || license.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {license.status || 'active'}
                </span>
              </div>
              {license.expiresAt && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                    <Clock size={11} className="inline mr-1" />
                    Expires
                  </label>
                  <p className="text-sm font-medium text-slate-800">{formatDate(license.expiresAt)}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 text-center">
            <Key size={32} className="text-slate-300 mb-3" />
            <p className="text-sm font-medium text-slate-500">No license information available</p>
            <p className="text-xs text-slate-400 mt-1">
              License details appear when logging in via serial key, or if your API key is linked to a licensed company.
            </p>
          </div>
        )}
      </div>

      {/* Logged-in User Info */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <User size={18} className="text-indigo-600" />
          <h2 className="text-sm font-bold text-slate-700">Logged-in User</h2>
        </div>
        {subUser ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
                {(subUser.name || 'U')[0].toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{subUser.name}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">{subUser.role || 'user'}</p>
              </div>
            </div>
            {company?.name && (
              <div className="border-t border-slate-100 pt-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                  Active Company
                </label>
                <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider">{company.name}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No user logged in. Vouchers will be tagged as "QuickAccPro User".</p>
        )}
      </div>

      {/* API Key Info */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Key size={18} className="text-amber-600" />
          <h2 className="text-sm font-bold text-slate-700">API Connection</h2>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-800">
                This app connects via the AccountsPro API key system.
              </p>
              <p className="text-[10px] text-amber-700 mt-1">
                Manage your API key from within the main AccountsPro app: 
                <span className="font-semibold"> API & Widget Access</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
