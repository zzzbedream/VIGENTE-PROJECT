'use client';

import Link from 'next/link';
import WalletConnect from './WalletConnect';

export default function Navbar() {
    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-cyan-500/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo / Brand */}
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/50">
                            <svg
                                className="w-6 h-6 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                />
                            </svg>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-xl font-bold text-white group-hover:text-cyan-400 transition-colors">
                                VIGENTE
                            </span>
                            <span className="text-xs text-cyan-400/70 -mt-1">Protocol</span>
                        </div>
                    </Link>

                    {/* Navigation Links */}
                    <div className="hidden md:flex items-center gap-6">
                        <Link
                            href="/"
                            className="text-gray-300 hover:text-cyan-400 transition-colors font-medium"
                        >
                            Home
                        </Link>
                        <a
                            href="https://stellar.expert/explorer/testnet/contract/CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-300 hover:text-cyan-400 transition-colors font-medium flex items-center gap-1"
                        >
                            Contract
                            <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                />
                            </svg>
                        </a>
                    </div>

                    {/* Wallet Connect */}
                    <div className="flex items-center">
                        <WalletConnect />
                    </div>
                </div>
            </div>
        </nav>
    );
}
