import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Legend, Cell
} from 'recharts';
import { TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

const CashFlowDashboard = ({ invoices, payments, journalVouchers, dashboardDate, currencySymbol, accounts, parties, expenses, incomeAccounts, isLightVariant }) => {

    const safeNum = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };

    // 1. Process Data for Area Chart (Trend over time - Last 30 days)
    const chartData = useMemo(() => {
        const dataMap = {};
        const today = new Date(dashboardDate || new Date());

        // Initialize last 30 days
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            dataMap[dateStr] = { date: dateStr, displayDate: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), incoming: 0, outgoing: 0 };
        }

        const startDateStr = Object.keys(dataMap)[0];

        // Process Invoices
        invoices.forEach(inv => {
            if (inv.date >= startDateStr && inv.date <= (dashboardDate || '9999-12-31')) {
                if (dataMap[inv.date]) {
                    const amt = safeNum(inv.totalAmount);
                    if (inv.type === 'sales') dataMap[inv.date].incoming += amt;
                    else if (inv.type === 'purchase') dataMap[inv.date].outgoing += amt;
                }
            }
        });

        // Process Payments
        payments.forEach(p => {
            if (p.date >= startDateStr && p.date <= (dashboardDate || '9999-12-31')) {
                if (dataMap[p.date]) {
                    const amt = safeNum(p.amount) * safeNum(p.exchangeRate || 1);
                    if (p.type === 'in') dataMap[p.date].incoming += amt;
                    else if (p.type === 'out') dataMap[p.date].outgoing += amt;
                }
            }
        });

        return Object.values(dataMap).sort((a, b) => a.date.localeCompare(b.date));
    }, [invoices, payments, dashboardDate]);

    // 2. Process Data for Source/Destination (Bar Chart or Summary)
    const flowStats = useMemo(() => {
        const stats = {
            incomingBySource: {},
            outgoingByDest: {},
            totalIn: 0,
            totalOut: 0
        };

        const processIn = (source, amt) => {
            if (!source) source = 'Unknown';
            stats.incomingBySource[source] = (stats.incomingBySource[source] || 0) + amt;
            stats.totalIn += amt;
        };

        const processOut = (dest, amt) => {
            if (!dest) dest = 'Unknown';
            stats.outgoingByDest[dest] = (stats.outgoingByDest[dest] || 0) + amt;
            stats.totalOut += amt;
        };

        // Filter by date (current month)
        const currentMonth = (dashboardDate || new Date().toISOString()).substring(0, 7);

        invoices.forEach(inv => {
            if (inv.date.startsWith(currentMonth) && inv.date <= (dashboardDate || '9999-12-31')) {
                const amt = safeNum(inv.totalAmount);
                if (inv.type === 'sales') processIn(inv.partyName || 'Sales', amt);
                else if (inv.type === 'purchase') processOut(inv.partyName || 'Purchases', amt);
            }
        });

        payments.forEach(p => {
            if (p.date.startsWith(currentMonth) && p.date <= (dashboardDate || '9999-12-31')) {
                const amt = safeNum(p.amount) * safeNum(p.exchangeRate || 1);
                if (p.type === 'in') {
                    // Receipt: From where?
                    let source = p.partyName || p.incomeAccountName || 'Other Income';
                    if (p.isMulti && p.splits) {
                        p.splits.forEach(s => processIn(s.targetName || 'Other Income', safeNum(s.amount) * safeNum(p.exchangeRate || 1)));
                    } else {
                        processIn(source, amt);
                    }
                } else if (p.type === 'out') {
                    // Payment: To where?
                    let dest = p.partyName || p.expenseName || 'Other Expense';
                    if (p.isMulti && p.splits) {
                        p.splits.forEach(s => processOut(s.targetName || 'Other Expense', safeNum(s.amount) * safeNum(p.exchangeRate || 1)));
                    } else {
                        processOut(dest, amt);
                    }
                }
            }
        });

        return stats;
    }, [invoices, payments, dashboardDate]);

    const formatCurr = (val) => `${currencySymbol} ${safeNum(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

    const topInSources = Object.entries(flowStats.incomingBySource)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, value]) => ({ name, value }));

    const topOutDests = Object.entries(flowStats.outgoingByDest)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, value]) => ({ name, value }));

    return (
        <div className="space-y-6 animate-in fade-in duration-700">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Incoming</p>
                        <p className="text-xl font-black text-emerald-700">{formatCurr(flowStats.totalIn)}</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                    <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                        <TrendingDown size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Outgoing</p>
                        <p className="text-xl font-black text-rose-700">{formatCurr(flowStats.totalOut)}</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                        <Wallet size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Net Cash Flow</p>
                        <p className={`text-xl font-black ${flowStats.totalIn - flowStats.totalOut >= 0 ? 'text-blue-700' : 'text-amber-600'}`}>
                            {formatCurr(flowStats.totalIn - flowStats.totalOut)}
                        </p>
                    </div>
                </div>
            </div>

            {/* Main Chart */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800">Cash Flow Trend</h3>
                        <p className="text-xs text-slate-400">Past 30 days movement</p>
                    </div>
                    <div className="flex gap-4 text-xs font-bold">
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Incoming</div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-rose-500"></div> Outgoing</div>
                    </div>
                </div>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.1} />
                                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                                dataKey="displayDate"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                minTickGap={30}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', padding: '12px' }}
                                formatter={(value) => [formatCurr(value), '']}
                            />
                            <Area
                                type="monotone"
                                dataKey="incoming"
                                stroke="#10b981"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorIn)"
                                animationDuration={1500}
                            />
                            <Area
                                type="monotone"
                                dataKey="outgoing"
                                stroke="#f43f5e"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorOut)"
                                animationDuration={1500}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Source/Destination Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Incoming Sources */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <ArrowUpRight size={16} className="text-emerald-500" /> Top Incoming Sources
                    </h4>
                    <div className="space-y-4">
                        {topInSources.map((item, idx) => (
                            <div key={idx} className="space-y-1">
                                <div className="flex justify-between text-xs font-bold">
                                    <span className="text-slate-700">{item.name}</span>
                                    <span className="text-emerald-600">{formatCurr(item.value)}</span>
                                </div>
                                <div className="w-full bg-slate-50 h-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                                        style={{ width: `${(item.value / flowStats.totalIn) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                        {topInSources.length === 0 && <p className="text-center text-slate-300 text-xs py-10 italic">No incoming data this month</p>}
                    </div>
                </div>

                {/* Outgoing Destinations */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <ArrowDownLeft size={16} className="text-rose-500" /> Top Spending
                    </h4>
                    <div className="space-y-4">
                        {topOutDests.map((item, idx) => (
                            <div key={idx} className="space-y-1">
                                <div className="flex justify-between text-xs font-bold">
                                    <span className="text-slate-700">{item.name}</span>
                                    <span className="text-rose-600">{formatCurr(item.value)}</span>
                                </div>
                                <div className="w-full bg-slate-50 h-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-rose-500 rounded-full transition-all duration-1000"
                                        style={{ width: `${(item.value / flowStats.totalOut) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                        {topOutDests.length === 0 && <p className="text-center text-slate-300 text-xs py-10 italic">No outgoing data this month</p>}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CashFlowDashboard;
