import React from 'react';
import { MoneyGramTransaction } from '../services/moneygram-oracle';

interface TransactionHistoryChartProps {
    transactions: MoneyGramTransaction[];
}

export const TransactionHistoryChart: React.FC<TransactionHistoryChartProps> = ({ transactions }) => {
    // Empty State
    if (!transactions || transactions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 bg-gray-900/50 rounded-xl border border-gray-800 backdrop-blur-sm h-[200px]">
                <svg className="w-12 h-12 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-gray-400 font-medium">Insufficient History</p>
                <p className="text-xs text-gray-500 mt-1">No remittance data found</p>
            </div>
        );
    }

    // 1. Process Data & Normalize
    // Sort by date ascending to show timeline
    const sortedTx = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Find max value for scaling height
    const maxAmount = Math.max(...sortedTx.map(tx => tx.amountUSD), 1);

    // Formatters
    const formatDate = (isoStr: string) => {
        const d = new Date(isoStr);
        return d.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    };

    return (
        <div className="w-full bg-gray-900/50 rounded-xl border border-gray-800 backdrop-blur-sm overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center bg-gray-900/80">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
                    Remittance History
                </h3>
                <span className="text-xs text-gray-500 uppercase tracking-wider font-mono">Last {transactions.length} txs</span>
            </div>

            {/* Chart Area */}
            <div className="relative h-[220px] w-full px-2 pt-8 pb-2 flex items-end justify-between gap-1 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">

                {/* Y-Axis Guidelines (Absolute Background) */}
                <div className="absolute inset-x-0 top-8 bottom-8 pointer-events-none flex flex-col justify-between px-4 opacity-20">
                    <div className="w-full h-px bg-gray-400 border-dashed"></div>
                    <div className="w-full h-px bg-gray-400 border-dashed"></div>
                    <div className="w-full h-px bg-gray-400 border-dashed"></div>
                </div>

                {sortedTx.map((tx, idx) => {
                    // Calculate relative height (min 10% visually)
                    const heightPercent = Math.max((tx.amountUSD / maxAmount) * 100, 10);

                    return (
                        <div key={tx.id} className="group relative flex flex-col items-center justify-end h-full flex-1 min-w-[30px] transition-all hover:flex-[1.2]">

                            {/* Tooltip (Hover) */}
                            <div className="absolute -top-10 scale-0 group-hover:scale-100 transition-transform origin-bottom z-10 flex flex-col items-center">
                                <div className="bg-gray-800/90 text-white text-xs px-3 py-1.5 rounded-lg border border-gray-700 shadow-xl whitespace-nowrap backdrop-blur-md">
                                    <p className="font-bold text-cyan-400">{formatCurrency(tx.amountUSD)}</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">{new Date(tx.date).toLocaleDateString()}</p>
                                </div>
                                {/* Arrow */}
                                <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-800/90"></div>
                            </div>

                            {/* Bar */}
                            <div
                                style={{ height: `${heightPercent}%` }}
                                className={`
                  w-full max-w-[24px] rounded-t-sm transition-all duration-500 ease-out cursor-pointer
                  bg-gradient-to-t from-cyan-900/80 via-cyan-500/80 to-blue-400/90
                  group-hover:from-cyan-700 group-hover:via-cyan-400 group-hover:to-blue-300
                  group-hover:shadow-[0_0_15px_-3px_rgba(6,182,212,0.6)]
                  relative
                `}
                            >
                                {/* Top Glow Line */}
                                <div className="absolute top-0 inset-x-0 h-[1px] bg-white/40 shadow-sm"></div>
                            </div>

                            {/* X-Axis Label */}
                            <div className="mt-2 text-[0.60rem] text-gray-500 font-mono tracking-tighter opacity-70 group-hover:opacity-100 group-hover:text-cyan-400 transition-colors truncate w-full text-center">
                                {formatDate(tx.date)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
