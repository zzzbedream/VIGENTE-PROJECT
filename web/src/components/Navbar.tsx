'use client';

import Link from 'next/link';
import WalletConnect from './WalletConnect';
import { VigenteWordmark } from './VigenteLogo';

export default function Navbar() {
    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-cyan-500/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo / Brand */}
                    <Link href="/" className="flex items-center" aria-label="Vigente Protocol — inicio">
                        <VigenteWordmark />
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
