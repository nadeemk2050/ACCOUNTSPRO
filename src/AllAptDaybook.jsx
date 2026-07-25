import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';

const formatNum = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });

export default function AllAptDaybook({ onClose, products = [], taxRates = [] }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [vchFilter, setVchFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, 'invoices'), orderBy('date', 'desc')));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const apt = all.filter(inv =>
          ['purchase_apt', 'sales_reg_apt', 'sales_unreg_apt'].includes(inv.type)
        );
        setTransactions(apt);
      } catch (e) { console.error('AllAptDaybook load error:', e); }
      setLoading(false);
    };
    load();
  }, []);

  // Extract specific tax values from appliedTaxes array
  const getTaxAmount = (tx, taxNames) => {
    if (!tx.appliedTaxes || !Array.isArray(tx.appliedTaxes)) return 0;
    const found = tx.appliedTaxes.find(at =>
      taxNames.some(name => (at.taxName || '').toLowerCase().includes(name.toLowerCase()))
    );
    return found ? Number(found.calculatedAmount || 0) : 0;
  };

  const getSingleTaxAmount = (tx, taxNames) => {
    const tn = (tx.taxName || '').toLowerCase();
    if (taxNames.some(name => tn.includes(name.toLowerCase()))) return Number(tx.taxAmount || 0);
    return 0;
  };

  const getCD = (tx) => getTaxAmount(tx, ['customs duty', 'cd', 'custom']) || getSingleTaxAmount(tx, ['customs duty', 'cd', 'custom']);
  const getACD = (tx) => getTaxAmount(tx, ['additional customs', 'additional cd', 'acd']) || getSingleTaxAmount(tx, ['additional customs', 'additional cd', 'acd']);
  const getRCD = (tx) => getTaxAmount(tx, ['regulatory customs', 'regulatory cd', 'rcd']) || getSingleTaxAmount(tx, ['regulatory customs', 'regulatory cd', 'rcd']);
  const getST = (tx) => getTaxAmount(tx, ['sales tax', 'st']) || getSingleTaxAmount(tx, ['sales tax', 'st']);
  const getAST = (tx) => getTaxAmount(tx, ['additional sales tax', 'additional st', 'ast']) || getSingleTaxAmount(tx, ['additional sales tax', 'additional st', 'ast']);
  const getIT = (tx) => getTaxAmount(tx, ['income tax', 'it']) || getSingleTaxAmount(tx, ['income tax', 'it']);

  const getTotalTaxes = (tx) => {
    if (tx.appliedTaxes && Array.isArray(tx.appliedTaxes)) {
      return tx.appliedTaxes.reduce((s, at) => s + Number(at.calculatedAmount || 0), 0);
    }
    return Number(tx.taxAmount || 0);
  };

  const getTotalValue = (tx) => {
    const itemVal = Number(tx.taxableValue || 0);
    return itemVal + getTotalTaxes(tx);
  };

  const getTotalQty = (tx) => {
    if (tx.items && Array.isArray(tx.items) && tx.items.length > 0) {
      return tx.items.reduce((s, i) => s + Number(i.qty || i.quantity || 0), 0);
    }
    return Number(tx.qty || 0);
  };

  const voucherLabel = (type) => {
    switch(type) {
      case 'purchase_apt': return 'APT PUR';
      case 'sales_reg_apt': return 'REG APT';
      case 'sales_unreg_apt': return 'UNREG APT';
      default: return type;
    }
  };

  // Get the earliest and latest dates for date picker limits
  const dateExtents = useMemo(() => {
    if (transactions.length === 0) return { min: '', max: '' };
    const dates = transactions.map(t => t.date || '').filter(Boolean).sort();
    return { min: dates[0], max: dates[dates.length - 1] };
  }, [transactions]);

  const sorted = useMemo(() => {
    let list = [...transactions];

    // Filter by voucher type
    if (vchFilter !== 'all') {
      list = list.filter(tx => tx.type === vchFilter);
    }

    // Filter by date range
    if (fromDate) list = list.filter(tx => (tx.date || '') >= fromDate);
    if (toDate) list = list.filter(tx => (tx.date || '') <= toDate);

    // Search filter
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(tx =>
        (tx.refNo || '').toLowerCase().includes(s) ||
        (tx.hscode || '').toLowerCase().includes(s) ||
        (tx.partyName || '').toLowerCase().includes(s) ||
        (tx.items || []).some(i => (i.productName || '').toLowerCase().includes(s)) ||
        (tx.productName || '').toLowerCase().includes(s)
      );
    }

    // Sort
    list.sort((a, b) => {
      let va, vb;
      if (sortField === 'date') { va = a.date || ''; vb = b.date || ''; }
      else if (sortField === 'vchType') { va = voucherLabel(a.type); vb = voucherLabel(b.type); }
      else if (sortField === 'refNo') { va = a.refNo || ''; vb = b.refNo || ''; }
      else if (sortField === 'hscode') { va = a.hscode || ''; vb = b.hscode || ''; }
      else if (sortField === 'itemName') {
        const aItems = a.items && Array.isArray(a.items) ? a.items.map(i => i.productName).filter(Boolean).join(', ') : (a.productName || '');
        const bItems = b.items && Array.isArray(b.items) ? b.items.map(i => i.productName).filter(Boolean).join(', ') : (b.productName || '');
        va = aItems.toLowerCase();
        vb = bItems.toLowerCase();
      }
      else if (sortField === 'qty') { va = getTotalQty(a); vb = getTotalQty(b); }
      else if (sortField === 'assessedValue') { va = Number(a.taxableValue || 0); vb = Number(b.taxableValue || 0); }
      else if (sortField === 'cd') { va = getCD(a); vb = getCD(b); }
      else if (sortField === 'acd') { va = getACD(a); vb = getACD(b); }
      else if (sortField === 'rcd') { va = getRCD(a); vb = getRCD(b); }
      else if (sortField === 'st') { va = getST(a); vb = getST(b); }
      else if (sortField === 'ast') { va = getAST(a); vb = getAST(b); }
      else if (sortField === 'it') { va = getIT(a); vb = getIT(b); }
      else if (sortField === 'totalTaxes') { va = getTotalTaxes(a); vb = getTotalTaxes(b); }
      else if (sortField === 'total') { va = getTotalValue(a); vb = getTotalValue(b); }
      else { va = a[sortField] || ''; vb = b[sortField] || ''; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return list;
  }, [transactions, search, sortField, sortDir, vchFilter, fromDate, toDate]);

  const totals = useMemo(() => ({
    totalQty: sorted.reduce((s, tx) => s + getTotalQty(tx), 0),
    itemValue: sorted.reduce((s, tx) => s + Number(tx.taxableValue || 0), 0),
    cd: sorted.reduce((s, tx) => s + getCD(tx), 0),
    acd: sorted.reduce((s, tx) => s + getACD(tx), 0),
    rcd: sorted.reduce((s, tx) => s + getRCD(tx), 0),
    st: sorted.reduce((s, tx) => s + getST(tx), 0),
    ast: sorted.reduce((s, tx) => s + getAST(tx), 0),
    it: sorted.reduce((s, tx) => s + getIT(tx), 0),
    totalTaxes: sorted.reduce((s, tx) => s + getTotalTaxes(tx), 0),
    grandTotal: sorted.reduce((s, tx) => s + getTotalValue(tx), 0),
  }), [sorted]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-blue-600 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const activeFilters = (vchFilter !== 'all' ? 1 : 0) + (fromDate || toDate ? 1 : 0);

  if (loading) return (
    <div className="fixed inset-0 z-[10002] bg-white flex flex-col">
      <div className="h-12 bg-[#1e3264] text-white flex items-center justify-between px-5">
        <span className="text-sm font-bold">All APT Transactions</span>
        <button onClick={onClose} className="text-white/70 hover:text-white text-xl">&times;</button>
      </div>
      <div className="flex-1 flex items-center justify-center text-xs text-slate-400">Loading...</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[10002] bg-white flex flex-col">
      <style>{`.aptd input,.aptd select{color:#1e293b!important;background:#fff!important}`}</style>
      {/* Header */}
      <div className="h-12 bg-[#1e3264] text-white flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-xs font-black">D</div>
          <span className="text-sm font-bold">APT Daybook — All Transactions ({sorted.length})</span>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">&times;</button>
      </div>

      {/* Toolbar: Date period + Search + Vch filter */}
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date period - click toggles smart calendar inputs */}
          <div className="flex items-center gap-2">
            <button onClick={() => setShowDatePicker(!showDatePicker)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold transition-all ${showDatePicker || fromDate || toDate ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              <span>📅</span>
              {fromDate || toDate ? `${fromDate || '∞'} → ${toDate || '∞'}` : 'Date Period'}
              {(fromDate || toDate) && <span className="ml-1 text-blue-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setFromDate(''); setToDate(''); }}>✕</span>}
            </button>
            {showDatePicker && (
              <div className="flex items-center gap-2 p-2 bg-white border border-blue-200 rounded-lg shadow-sm">
                <label className="text-[9px] font-bold text-slate-400 uppercase">From</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  min={dateExtents.min} max={dateExtents.max}
                  className="px-2 py-1 border border-slate-200 rounded text-xs outline-none w-[140px] text-slate-800" />
                <label className="text-[9px] font-bold text-slate-400 uppercase">To</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  min={dateExtents.min} max={dateExtents.max}
                  className="px-2 py-1 border border-slate-200 rounded text-xs outline-none w-[140px] text-slate-800" />
              </div>
            )}
          </div>

          {/* Search with magnifier icon */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search Ref, HS Code, Party, Item..."
              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-300 text-slate-800" />
          </div>

          {/* Vch Type filter dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[9px] font-bold text-slate-400 uppercase">Type</label>
            <select value={vchFilter} onChange={e => setVchFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white text-slate-800">
              <option value="all">All Types</option>
              <option value="purchase_apt">APT PUR</option>
              <option value="sales_reg_apt">REG APT</option>
              <option value="sales_unreg_apt">UNREG APT</option>
            </select>
          </div>

          {activeFilters > 0 && (
            <button onClick={() => { setVchFilter('all'); setFromDate(''); setToDate(''); setSearch(''); }}
              className="text-[10px] text-blue-600 hover:text-blue-800 underline font-bold">
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 flex gap-4 text-[10px] font-bold text-amber-800 flex-shrink-0 flex-wrap">
        <span>📦 Items: {formatNum(totals.itemValue)}</span>
        <span>📦 Qty: {formatNum(totals.totalQty)}</span>
        <span>CD: {formatNum(totals.cd)}</span>
        <span>ACD: {formatNum(totals.acd)}</span>
        <span>RCD: {formatNum(totals.rcd)}</span>
        <span>ST: {formatNum(totals.st)}</span>
        <span>AST: {formatNum(totals.ast)}</span>
        <span>IT: {formatNum(totals.it)}</span>
        <span className="text-blue-700">🧾 Total Taxes: {formatNum(totals.totalTaxes)}</span>
        <span className="text-green-700">💰 Grand Total: {formatNum(totals.grandTotal)}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-5 aptd">
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-xs text-slate-400">No APT transactions found.</div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('date')}>Date <SortIcon field="date" /></th>
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('vchType')}>Vch Type <SortIcon field="vchType" /></th>
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('refNo')}>Ref No. <SortIcon field="refNo" /></th>
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('hscode')}>HS Code <SortIcon field="hscode" /></th>
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('itemName')}>Item Name <SortIcon field="itemName" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('qty')}>Qty <SortIcon field="qty" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('assessedValue')}>Assessed Value <SortIcon field="assessedValue" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('cd')}>CD <SortIcon field="cd" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('acd')}>ACD <SortIcon field="acd" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('rcd')}>RCD <SortIcon field="rcd" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('st')}>ST <SortIcon field="st" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('ast')}>AST <SortIcon field="ast" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('it')}>IT <SortIcon field="it" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('totalTaxes')}>Total Taxes <SortIcon field="totalTaxes" /></th>
                    <th className="px-3 py-2.5 text-right text-[9px] font-bold text-slate-400 uppercase cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('total')}>Total Value <SortIcon field="total" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(tx => {
                    const itemsList = tx.items && Array.isArray(tx.items) && tx.items.length > 0 ? tx.items : (tx.productName ? [{ productName: tx.productName, hscode: tx.hscode, qty: tx.qty }] : []);
                    const itemName = itemsList.map(i => i.productName).filter(Boolean).join(', ') || '-';
                    const hsCode = itemsList.map(i => i.hscode).filter(Boolean).join(', ') || tx.hscode || '-';
                    return (
                      <tr key={tx.id} className="border-t border-slate-100 hover:bg-amber-50">
                        <td className="px-3 py-2 text-slate-800">{tx.date}</td>
                        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${tx.type === 'purchase_apt' ? 'bg-red-50 text-red-700' : tx.type === 'sales_reg_apt' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{voucherLabel(tx.type)}</span></td>
                        <td className="px-3 py-2 font-mono text-slate-800">{tx.refNo || '-'}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{hsCode}</td>
                        <td className="px-3 py-2 text-slate-800 max-w-[180px] truncate" title={itemName}>{itemName}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{getTotalQty(tx)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{formatNum(tx.taxableValue)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{getCD(tx) ? formatNum(getCD(tx)) : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{getACD(tx) ? formatNum(getACD(tx)) : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{getRCD(tx) ? formatNum(getRCD(tx)) : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{getST(tx) ? formatNum(getST(tx)) : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{getAST(tx) ? formatNum(getAST(tx)) : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800">{getIT(tx) ? formatNum(getIT(tx)) : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700">{formatNum(getTotalTaxes(tx))}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-green-700">{formatNum(getTotalValue(tx))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
