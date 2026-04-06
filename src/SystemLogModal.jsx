import React, { useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCcw, Search, X, ChevronLeft, ChevronRight, Calendar, Filter, ArrowUpDown } from 'lucide-react';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from './firebase';
import { Modal } from './components/Modal';

const parseDate = (d) => {
  if (!d) return 0;
  if (d.toMillis) return d.toMillis();
  if (d.seconds) return d.seconds * 1000;
  if (typeof d === 'string') {
    const parsed = new Date(d).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }
  if (typeof d === 'number') return d;
  return 0;
};

const SystemLogModal = ({
  isOpen, onClose, onBack, zIndex, user, dataOwnerId, onScan,
  accounts = [], parties = [], expenses = [], incomeAccounts = [], products = [], subUsers = [], staff = [], locations = []
}) => {
  const [allLogs, setAllLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);

  // Function to resolve ID to Name
  const resolveEntityName = (id) => {
    if (!id || typeof id !== 'string') return id;
    const cleanId = id.trim();
    // Compile all possible entity lists
    const allEntities = [...accounts, ...parties, ...expenses, ...incomeAccounts, ...products, ...subUsers, ...staff, ...locations];
    // Case-insensitive search just in case, and supporting .id / .uid
    const found = allEntities.find(e => 
      (e.id && e.id.toLowerCase() === cleanId.toLowerCase()) || 
      (e.uid && e.uid.toLowerCase() === cleanId.toLowerCase())
    );
    
    if (found) {
      return found.name || found.accountName || found.expenseName || found.incomeName || found.productName || found.vNo || found.displayName || found.email || id;
    }
    return id;
  };

  // Filter State
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Custom View State
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' = Newest First, 'asc' = Oldest First
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const uid = dataOwnerId || user?.uid;

  const loadAllLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch docs for this user (up to 10,000 for safety, hits local cache fast)
      const qBase = query(
        collection(db, 'audit_logs'),
        where('ownerId', '==', uid),
        limit(10000)
      );

      const snap = await getDocs(qBase);
      const items = [];
      snap.forEach(d => {
        const data = d.data();
        items.push({
          id: d.id,
          ...data,
          t: parseDate(data.date || Date.now()),
          vDate: parseDate(data.voucherDate)
        });
      });

      setAllLogs(items);
      setPage(1);

    } catch (e) {
      console.error('Failed to load logs', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !uid) return;
    loadAllLogs();
  }, [isOpen, uid]);

  const handleScan = async () => {
    if (onScan) {
      setLoading(true);
      await onScan();
      loadAllLogs();
    }
  };

  // Pure Local Filtering & Sorting & Global Search
  const filteredAndSorted = useMemo(() => {
    let result = allLogs;

    // Date Filters
    if (startDate) {
      const sd = new Date(startDate);
      sd.setHours(0, 0, 0, 0);
      const sT = sd.getTime();
      result = result.filter(l => l.t >= sT);
    }
    if (endDate) {
      const ed = new Date(endDate);
      ed.setHours(23, 59, 59, 999);
      const eT = ed.getTime();
      result = result.filter(l => l.t <= eT);
    }

    // Global Search (Matches everywhere!)
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(l =>
        (l.description || '').toLowerCase().includes(s) ||
        (l.docType || '').toLowerCase().includes(s) ||
        (l.refNo || '').toLowerCase().includes(s) ||
        (l.userName || '').toLowerCase().includes(s) ||
        (l.email || '').toLowerCase().includes(s) ||
        (l.action || '').toLowerCase().includes(s) ||
        (l.oldAmount?.toString() || '').includes(s) ||
        (l.amount?.toString() || '').includes(s)
      );
    }

    // Sorting
    result.sort((a, b) => {
      if (sortOrder === 'desc') return b.t - a.t;
      return a.t - b.t;
    });

    // Compute Status "Modified X time" sequentially
    const chronological = [...result].sort((a, b) => a.t - b.t);
    const counts = {};
    const statusMap = {};

    chronological.forEach(l => {
      const key = l.docId || l.id;
      const index = counts[key] || 0;
      counts[key] = index + 1;

      let statusText = l.action;
      if (statusText === 'UPDATED') {
        statusText = `Modified ${index} time`;
        if (index === 1) statusText = 'Modified';
        if (index === 2) statusText = 'Modified 2nd time';
        if (index === 3) statusText = 'Modified 3rd time';
      }
      statusMap[l.id] = statusText;
    });

    return result.map(l => ({ ...l, statusText: statusMap[l.id] }));

  }, [allLogs, searchTerm, startDate, endDate, sortOrder]);

  const totalFilteredCount = filteredAndSorted.length;
  const totalFilteredValue = filteredAndSorted.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const totalPages = Math.ceil(totalFilteredCount / pageSize) || 1;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  // Paginated View
  const paginatedLogs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAndSorted.slice(start, start + pageSize);
  }, [filteredAndSorted, page, pageSize]);

  // Jumpers
  const jumpToFirst = () => setPage(1);
  const jumpToLast = () => setPage(totalPages);
  const handlePrevPage = () => { if (page > 1) setPage(page - 1); };
  const handleNextPage = () => { if (page < totalPages) setPage(page + 1); };

  const jumpToPage = (target) => {
    let p = Number(target);
    if (!isNaN(p)) {
      if (p < 1) p = 1;
      if (p > totalPages) p = totalPages;
      setPage(p);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onBack={onBack}
      zIndex={zIndex}
      title="System Log"
      maxWidth="max-w-6xl"
      defaultMaximized={true}
    >
      <div className="flex flex-col h-full overflow-hidden -m-4">
        {/* Toolbar */}
        <div className="px-5 py-3 border-b flex flex-wrap items-center gap-3 bg-slate-50">
          <div className="relative flex-1 min-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" size={16} />
            <input
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
              placeholder="GLOBAL SEARCH: Type ref numbers, users, amounts, types..."
              className="w-full pl-9 p-2.5 text-xs border border-blue-200 rounded-lg outline-none focus:border-blue-500 bg-white focus:ring-2 focus:ring-blue-100 placeholder:text-blue-300 font-bold"
            />
          </div>

          <div className="flex items-center gap-2 bg-white border p-1 rounded-lg">
            <button
              onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded transiton-all"
            >
              <ArrowUpDown size={12} />
              {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
            </button>
            <div className="w-px h-6 bg-slate-200 mx-1"></div>
            <div className="flex items-center gap-1 px-2 text-[10px] text-slate-500 font-bold uppercase">
              <Calendar size={12} className="text-blue-500" />
              Date Filter
            </div>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setPage(1); }}
              className="text-[11px] p-1.5 outline-none border-none bg-transparent"
              title="Start Date"
            />
            <span className="text-slate-300">|</span>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setPage(1); }}
              className="text-[11px] p-1.5 outline-none border-none bg-transparent"
              title="End Date"
            />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}
                className="p-1.5 hover:bg-red-50 text-red-500 rounded transition-colors"
                title="Clear Filters"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex gap-2 ml-auto">
            <div className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-3 border border-blue-200 shadow-sm mr-2">
              <div className="flex items-center gap-1">
                <Filter size={12} />
                Matches: <span className="p-0.5 px-1.5 bg-blue-700 text-white rounded min-w-[24px] text-center ml-1">{totalFilteredCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto w-full relative">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] sticky top-0 z-10 shadow-sm border-b">
              <tr>
                <th className="p-3 whitespace-nowrap">Time</th>
                <th className="p-3">Doc Details / Name</th>
                <th className="p-3 font-semibold whitespace-nowrap">Ref / Voucher No.</th>
                <th className="p-3">Voucher Date</th>
                <th className="p-3 text-right whitespace-nowrap">Old Value</th>
                <th className="p-3 text-right text-blue-700 whitespace-nowrap">New Value</th>
                <th className="p-3 text-center">Added/Edited By</th>
                <th className="p-3 text-center">Latest Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedLogs.map(l => (
                <tr key={l.id}
                  className="hover:bg-blue-50/50 cursor-pointer active:bg-blue-100 transition-colors"
                  onClick={() => setSelectedLog(l)}
                >
                  <td className="p-3 text-slate-500 whitespace-nowrap font-mono text-[11px]">{l.t ? new Date(l.t).toLocaleString() : 'Date Missing'}</td>
                  <td className="p-3 font-medium text-slate-800 max-w-xs truncate" title={l.description || l.docType}>
                    {l.description?.split(' (FCY')[0] || l.docType}
                  </td>
                  <td className="p-3 font-black text-slate-700 whitespace-nowrap bg-slate-50/50">{l.refNo || '-'}</td>
                  <td className="p-3 text-[11px] text-slate-500 whitespace-nowrap font-medium">
                    {l.vDate ? new Date(l.vDate).toLocaleDateString() : '-'}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-slate-400">
                    {l.oldAmount !== undefined ? Number(l.oldAmount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-blue-800">
                    {Number(l.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-[10px] text-center text-slate-500 min-w-[120px] max-w-[150px] truncate" title={l.userName || l.email || l.userId}>
                    {l.userName || l.email || l.userId || '-'}
                  </td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${l.action === 'CREATED' ? 'bg-green-100 text-green-700 border border-green-200' :
                      l.action === 'DELETED' ? 'bg-red-100 text-red-700 border border-red-200' :
                        'bg-indigo-100 text-indigo-700 border border-indigo-200'
                      }`}>
                      {l.statusText || l.action}
                    </span>
                  </td>
                </tr>
              ))}
              {error && (
                <tr><td colSpan="8" className="p-8 text-center text-red-500 font-bold bg-red-50">{error}</td></tr>
              )}
              {!error && loading && allLogs.length === 0 && (
                <tr><td colSpan="8" className="p-10 text-center text-slate-400 font-bold animate-pulse">Loading Logs...</td></tr>
              )}
              {!error && !loading && filteredAndSorted.length === 0 && (
                <tr><td colSpan="8" className="p-10 text-center text-slate-400 text-sm bg-slate-50/50">
                  <div className="font-bold text-slate-500 mb-1">No logs found matching your filters.</div>
                  <div className="text-xs opacity-60">Try clearing the search or date filter. Data loads offline instantly if previously synced.</div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-5 py-3 border-t bg-white flex flex-wrap items-center justify-between gap-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Jump to</span>
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300 transition-all">
              <button onClick={jumpToFirst} className="px-3 py-1.5 text-[10px] font-black text-blue-600 hover:bg-white hover:text-blue-800 border-r border-slate-200 uppercase" title="First Page">&laquo; First</button>
              <input
                type="number"
                min="1"
                max={totalPages}
                value={page}
                onChange={(e) => jumpToPage(e.target.value)}
                className="w-16 text-center text-[13px] font-black text-slate-800 bg-transparent outline-none p-1 appearance-none"
                title="Type page number"
              />
              <button onClick={jumpToLast} className="px-3 py-1.5 text-[10px] font-black text-blue-600 hover:bg-white hover:text-blue-800 border-l border-slate-200 uppercase" title="Last Page">Last &raquo;</button>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 flex items-center gap-3 font-medium">
            <span>Page <strong className="text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{page}</strong> of <strong className="text-slate-800">{totalPages}</strong></span>
            <div className="w-1 h-1 rounded-full bg-slate-300"></div>
            <span><strong className="text-slate-700">{paginatedLogs.length}</strong> items displayed</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevPage}
              disabled={page <= 1}
              className="px-4 py-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white shadow-sm font-bold text-slate-600 flex items-center gap-1"
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <button
              onClick={handleNextPage}
              disabled={page >= totalPages}
              className="px-4 py-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white shadow-sm font-bold text-slate-600 flex items-center gap-1"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {selectedLog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-200 overflow-hidden slide-in-from-bottom-8">
            <div className="flex items-center justify-between p-4 bg-slate-50 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="text-blue-500" />
                  Voucher Historical Snapshot
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {selectedLog.docType} • {selectedLog.refNo} • {selectedLog.statusText || selectedLog.action}
                </p>
              </div>
              <button onClick={() => setSelectedLog(null)} className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
              {!selectedLog.snapshotData ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-50">
                  <FileText size={48} className="mb-4 text-slate-400" />
                  <p className="text-slate-600 font-medium">Historical snapshot not available.</p>
                  <p className="text-xs text-slate-400 max-w-md text-center mt-2">
                    This log was generated before full voucher snapshots were enabled. Detailed historical views are only available for changes made from now onwards.
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
                  {(() => {
                    try {
                      const parsed = JSON.parse(selectedLog.snapshotData);
                      return (
                        <div className="flex flex-col gap-4">
                          {/* Top Info Grid */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {parsed.date && (
                              <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Voucher Date</div>
                                <div className="text-sm font-bold text-slate-700">{parsed.date}</div>
                              </div>
                            )}
                            {parsed.type && (
                              <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Document Type</div>
                                <div className="text-sm font-bold text-indigo-600 uppercase">{parsed.type}</div>
                              </div>
                            )}
                            {parsed.refNo && (
                              <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Reference No.</div>
                                <div className="text-sm font-bold text-slate-700">{parsed.refNo}</div>
                              </div>
                            )}
                            {parsed.amount !== undefined && (
                              <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Total Amount</div>
                                <div className="text-sm font-black text-blue-600">{Number(parsed.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {parsed.currencySymbol || ''}</div>
                              </div>
                            )}
                          </div>

                          {/* Party & Accounts Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(parsed.partyName || parsed.partyId) && (
                              <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 flex flex-col justify-center">
                                <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Party / Customer</span>
                                <span className="text-sm font-bold text-blue-900">{parsed.partyName || resolveEntityName(parsed.partyId)}</span>
                              </div>
                            )}
                            {(parsed.accountId || parsed.toAccountId || parsed.bankId) && (
                              <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 flex flex-col justify-center">
                                <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1">Bank / Cash Account</span>
                                <span className="text-sm font-bold text-emerald-900">{resolveEntityName(parsed.accountId || parsed.toAccountId || parsed.bankId)}</span>
                              </div>
                            )}
                          </div>

                          {/* Narration */}
                          {parsed.narration && (
                            <div className="bg-yellow-50/50 p-3 rounded-lg border border-yellow-100 mt-2">
                              <div className="text-[9px] font-black text-yellow-600 uppercase tracking-widest mb-1">Narration / Remarks</div>
                              <div className="text-sm font-medium text-yellow-900 italic">"{parsed.narration}"</div>
                            </div>
                          )}

                          {/* Items / Products Table */}
                          {parsed.items && Array.isArray(parsed.items) && parsed.items.length > 0 && (
                            <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                              <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
                                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Products & Items</span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-50">
                                    <tr>
                                      <th className="p-3 font-bold text-slate-500">Item Details</th>
                                      <th className="p-3 font-bold text-slate-500 text-right">Quantity</th>
                                      <th className="p-3 font-bold text-slate-500 text-right">Rate</th>
                                      <th className="p-3 font-bold text-slate-500 text-right">Total Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {parsed.items.map((it, idx) => (
                                      <tr key={idx} className="hover:bg-slate-50">
                                        <td className="p-3 font-semibold text-slate-700">{it.productName || resolveEntityName(it.item || it.productId) || 'Unknown Item'}</td>
                                        <td className="p-3 text-right font-medium text-slate-600">{it.quantity || it.qty || 0}</td>
                                        <td className="p-3 text-right font-mono text-slate-500">{Number(it.rate || it.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        <td className="p-3 text-right font-black text-blue-700">{Number(it.amount || it.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Multi Account Splits */}
                          {parsed.splits && Array.isArray(parsed.splits) && parsed.splits.length > 0 && (
                            <div className="mt-4 border border-indigo-100 rounded-xl overflow-hidden shadow-sm">
                              <div className="bg-indigo-50 px-4 py-2 border-b border-indigo-100">
                                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Multi-Account Distribution</span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-white">
                                    <tr>
                                      <th className="p-3 font-bold text-indigo-400 uppercase text-[10px]">Category</th>
                                      <th className="p-3 font-bold text-indigo-400 uppercase text-[10px]">Target Entity ID</th>
                                      <th className="p-3 font-bold text-indigo-400 uppercase text-[10px] text-right">Amount Allocated</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-indigo-50 bg-white">
                                    {parsed.splits.map((sp, idx) => (
                                      <tr key={idx}>
                                        <td className="p-3 font-black text-slate-600 uppercase text-[10px]">{sp.category}</td>
                                        <td className="p-3 font-medium text-indigo-900">{resolveEntityName(sp.targetId)}</td>
                                        <td className="p-3 text-right font-black text-indigo-700">{Number(sp.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Other Raw Data Metadata */}
                          <div className="mt-6 pt-4 border-t border-slate-100">
                            <span className="text-[10px] font-black tracking-widest text-slate-400 uppercase block mb-3">System Metadata</span>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(parsed).map(([key, value]) => {
                                const lowKey = key.toLowerCase();
                                // 1. Exclude fields already shown in summary boxes above
                                const excludes = ['date', 'type', 'refno', 'amount', 'narration', 'items', 'splits', 'lastmodifiedat', 'partyname', 'partyid', 'accountid', 'toaccountid', 'bankid', 'currencysymbol', 'totalamount', 'foreigntotal', 'foreignamount', 'vdate'];
                                if (excludes.includes(lowKey)) return null;

                                // 2. Hide ID field if the Name field already exists in snapshot
                                // This prevents seeing "CREATEDBY: ID" alongside "CREATEDBYNAME: Name"
                                const potentialNameKeys = [key + 'NAME', key + 'Name', key + 'name', key.replace(/id$/i, 'Name'), key.replace(/uid$/i, 'Name')];
                                if (potentialNameKeys.some(nk => parsed[nk] !== undefined)) return null;
                                
                                // 3. Skip objects and empty values
                                if (typeof value === 'object') return null;
                                if (value === null || value === '') return null;

                                return (
                                  <div key={key} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 flex flex-col min-w-[120px]">
                                    <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider mb-0.5">{key}</span>
                                    <span className="text-xs font-medium text-slate-700 break-all">
                                      {lowKey.includes('amount') || lowKey.includes('rate') ? value : resolveEntityName(String(value))}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                        </div>
                      );
                    } catch (e) {
                      return (
                        <div className="bg-red-50 text-red-700 p-4 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                          {selectedLog.snapshotData}
                        </div>
                      );
                    }
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </Modal>
  );
};

export default SystemLogModal;
