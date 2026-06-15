import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Search, ArrowRight, RefreshCw, Wallet2 } from 'lucide-react'
import { listAccounts } from '../api'

export default function CashBankRegister() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const quietLoadAccounts = async () => {
    try {
      const data = await listAccounts()
      const list = data.accounts || []
      setAccounts(list)
      localStorage.setItem('quickaccpro_cached_accounts', JSON.stringify(list))
    } catch (e) {}
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !refreshing && !loading) {
        quietLoadAccounts()
      }
    }, 6000)
    return () => clearInterval(timer)
  }, [refreshing, loading])

  const loadAccounts = async (isRef = false) => {
    if (isRef) setRefreshing(true)
    else setLoading(true)
    
    const cacheKey = 'quickaccpro_cached_accounts'
    const cachedRaw = localStorage.getItem(cacheKey)
    if (cachedRaw && !isRef) {
      try {
        setAccounts(JSON.parse(cachedRaw))
        setLoading(false)
      } catch (e) {}
    }

    try {
      const data = await listAccounts()
      const list = data.accounts || []
      setAccounts(list)
      localStorage.setItem(cacheKey, JSON.stringify(list))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const formatCurrency = (val) => {
    const num = Number(val || 0)
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num)
  }

  const filtered = accounts.filter(acc => 
    (acc.name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Cash / Bank Registers</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time ledger balances of all accounts</p>
        </div>
        <button
          onClick={() => loadAccounts(true)}
          disabled={refreshing}
          className="btn-secondary text-xs"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cash or bank accounts..."
          className="input-field pl-10"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500 mt-4">Loading balances...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Wallet2 size={36} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm">No accounts found matching "{search}"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(acc => {
            const bal = Number(acc.balance || 0)
            const isNegative = bal < 0
            return (
              <div
                key={acc.id}
                onClick={() => navigate(`/daybook?accountName=${encodeURIComponent(acc.name)}`)}
                className="card p-4 hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isNegative ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                    <Building2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide truncate max-w-[180px] sm:max-w-xs">
                      {acc.name}
                    </h3>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">
                      Account ID: {acc.id}
                    </p>
                  </div>
                </div>

                <div className="text-right flex items-center gap-3">
                  <div>
                    <p className={`text-base font-bold font-mono ${isNegative ? 'text-red-600' : 'text-slate-800'}`}>
                      {formatCurrency(bal)}
                    </p>
                    <p className="text-[9px] text-slate-400 font-bold uppercase">
                      Net Balance
                    </p>
                  </div>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
