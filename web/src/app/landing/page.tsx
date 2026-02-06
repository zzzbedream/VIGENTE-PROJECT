"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function LandingPage() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        setIsVisible(true);
    }, []);

    return (
        <div className="min-h-screen bg-[#050505] text-white overflow-x-hidden font-sans antialiased selection:bg-[#00F0FF]/20">

            {/* Ambient Gradient Background */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-[#3E1BDB]/20 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: '8s' }}></div>
                <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-[#00F0FF]/15 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '10s' }}></div>
            </div>

            {/* NAVBAR */}
            <nav className="fixed w-full z-50 backdrop-blur-xl bg-[#0A0B0D]/80 border-b border-white/5">
                <div className="max-w-7xl mx-auto px-6 md:px-12 h-20 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00F0FF] to-[#3E1BDB] flex items-center justify-center shadow-[0_0_20px_rgba(0,240,255,0.3)]">
                            <svg className="w-5 h-5 text-[#050505]" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                        </div>
                        <span className="text-lg font-bold tracking-tight">VIGENTE</span>
                        <span className="hidden md:inline text-xs text-white/40 ml-2">PROTOCOL</span>
                    </div>

                    <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
                        <a href="#how-it-works" className="hover:text-[#00F0FF] transition-colors">How it Works</a>
                        <a href="#developers" className="hover:text-[#3E1BDB] transition-colors">Developers</a>
                        <a href="https://github.com/zzzbedream/VIGENTE-PROJECT" target="_blank" className="hover:text-white transition-colors">Whitepaper</a>
                    </div>

                    <Link
                        href="/"
                        className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-[#00F0FF] to-[#3E1BDB] text-[#050505] font-bold text-sm hover:shadow-[0_0_30px_rgba(0,240,255,0.4)] transition-all duration-300 hover:scale-105"
                    >
                        Launch App
                    </Link>
                </div>
            </nav>

            {/* HERO SECTION */}
            <section className="relative pt-32 md:pt-40 pb-20 md:pb-32 px-6 max-w-7xl mx-auto">
                <div className={`text-center transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>

                    {/* Status Badge */}
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-[#00F0FF] mb-8 backdrop-blur-sm">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00F0FF] opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00F0FF]"></span>
                        </span>
                        LIVE ON STELLAR TESTNET
                    </div>

                    {/* Main Headline */}
                    <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-8 tracking-tighter leading-[0.95]">
                        Transform Your <br className="hidden md:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00F0FF] via-[#3E1BDB] to-[#00F0FF] animate-gradient">
                            Remittance History
                        </span>
                        <br />
                        into DeFi Credit.
                    </h1>

                    {/* Subheadline */}
                    <p className="text-lg md:text-xl text-white/60 max-w-3xl mx-auto mb-12 leading-relaxed font-light">
                        The first privacy-preserving reputation layer on Stellar. Turn MoneyGram receipts
                        into under-collateralized loans via Soroban smart contracts.
                    </p>

                    {/* CTA Buttons */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                        <Link
                            href="/"
                            className="group px-8 py-4 rounded-xl bg-gradient-to-r from-[#00F0FF] to-[#3E1BDB] text-[#050505] font-bold text-lg shadow-[0_0_40px_-10px_rgba(0,240,255,0.5)] hover:shadow-[0_0_60px_-5px_rgba(0,240,255,0.7)] transition-all duration-300 hover:scale-105 flex items-center gap-2"
                        >
                            Launch App
                            <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                        </Link>
                        <a
                            href="https://github.com/zzzbedream/VIGENTE-PROJECT"
                            target="_blank"
                            className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 text-white font-bold text-lg backdrop-blur-sm transition-all hover:bg-white/10 flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                            </svg>
                            Read Docs
                        </a>
                    </div>
                </div>
            </section>

            {/* SOCIAL PROOF */}
            <section className="border-y border-white/5 bg-white/[0.02] backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-6 py-16">
                    <p className="text-center text-xs font-bold tracking-[0.3em] text-white/40 mb-8">POWERED BY INFRASTRUCTURE FROM</p>
                    <div className="flex flex-wrap justify-center items-center gap-12 md:gap-16 opacity-40 grayscale hover:opacity-70 hover:grayscale-0 transition-all duration-500">
                        <div className="text-2xl font-bold tracking-wider">STELLAR</div>
                        <div className="text-2xl font-bold tracking-wider">SOROBAN</div>
                        <div className="text-2xl font-bold tracking-wider">MONEYGRAM</div>
                        <div className="text-2xl font-bold tracking-wider">BLEND</div>
                    </div>
                </div>
            </section>

            {/* HOW IT WORKS */}
            <section id="how-it-works" className="py-32 px-6 max-w-7xl mx-auto relative">
                <div className="text-center mb-20">
                    <h2 className="text-4xl md:text-6xl font-black mb-6 tracking-tight">How It Works</h2>
                    <p className="text-white/50 max-w-2xl mx-auto text-lg">
                        Four steps from invisible credit history to verified on-chain reputation.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Card 1 */}
                    <div className="group relative bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:border-[#00F0FF]/50 hover:bg-white/[0.05] transition-all duration-300">
                        <div className="absolute inset-0 bg-gradient-to-br from-[#00F0FF]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>
                        <div className="relative">
                            <div className="w-12 h-12 bg-[#00F0FF]/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 text-[#00F0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                            </div>
                            <div className="text-[#00F0FF] text-sm font-bold mb-2">STEP 1</div>
                            <h3 className="text-xl font-bold mb-3">Connect</h3>
                            <p className="text-white/50 text-sm leading-relaxed">
                                Link your MoneyGram account via OAuth. We fetch your transaction history without storing personal data.
                            </p>
                        </div>
                    </div>

                    {/* Card 2 */}
                    <div className="group relative bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:border-[#3E1BDB]/50 hover:bg-white/[0.05] transition-all duration-300">
                        <div className="absolute inset-0 bg-gradient-to-br from-[#3E1BDB]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>
                        <div className="relative">
                            <div className="w-12 h-12 bg-[#3E1BDB]/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 text-[#3E1BDB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                                </svg>
                            </div>
                            <div className="text-[#3E1BDB] text-sm font-bold mb-2">STEP 2</div>
                            <h3 className="text-xl font-bold mb-3">Score</h3>
                            <p className="text-white/50 text-sm leading-relaxed">
                                Our Oracle calculates your Credit Tier (Gold/Silver/Bronze) using volume, frequency, and consistency.
                            </p>
                        </div>
                    </div>

                    {/* Card 3 */}
                    <div className="group relative bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:border-[#00F0FF]/50 hover:bg-white/[0.05] transition-all duration-300">
                        <div className="absolute inset-0 bg-gradient-to-br from-[#00F0FF]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>
                        <div className="relative">
                            <div className="w-12 h-12 bg-[#00F0FF]/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 text-[#00F0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                                </svg>
                            </div>
                            <div className="text-[#00F0FF] text-sm font-bold mb-2">STEP 3</div>
                            <h3 className="text-xl font-bold mb-3">Mint</h3>
                            <p className="text-white/50 text-sm leading-relaxed">
                                Get your CreditBadge minted on-chain as a non-transferable SBT via Soroban smart contract.
                            </p>
                        </div>
                    </div>

                    {/* Card 4 */}
                    <div className="group relative bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:border-[#3E1BDB]/50 hover:bg-white/[0.05] transition-all duration-300">
                        <div className="absolute inset-0 bg-gradient-to-br from-[#3E1BDB]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>
                        <div className="relative">
                            <div className="w-12 h-12 bg-[#3E1BDB]/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 text-[#3E1BDB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div className="text-[#3E1BDB] text-sm font-bold mb-2">STEP 4</div>
                            <h3 className="text-xl font-bold mb-3">Borrow</h3>
                            <p className="text-white/50 text-sm leading-relaxed">
                                Access Blend Protocol liquidity pools with reduced collateral requirements using your reputation.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* DEVELOPER-FIRST SECTION */}
            <section id="developers" className="py-24 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-[#050505] via-[#0A0B0D] to-[#050505]"></div>

                <div className="max-w-5xl mx-auto px-6 relative">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl md:text-5xl font-black mb-6 tracking-tight">Built for the Future of Finance</h2>
                        <p className="text-white/50 max-w-2xl mx-auto">
                            Infrastructure-grade protocol built with bleeding-edge blockchain technology.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Tech Badge Cards */}
                        <div className="bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 flex items-start gap-4 hover:border-[#00F0FF]/30 transition-all">
                            <div className="w-6 h-6 rounded-full bg-[#00F0FF]/20 flex items-center justify-center flex-shrink-0 mt-1">
                                <svg className="w-4 h-4 text-[#00F0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="font-bold mb-2">ZKP-Ready Architecture (Noir Lang)</h4>
                                <p className="text-sm text-white/50">Privacy-preserving proofs allow credit verification without exposing transaction history.</p>
                            </div>
                        </div>

                        <div className="bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 flex items-start gap-4 hover:border-[#3E1BDB]/30 transition-all">
                            <div className="w-6 h-6 rounded-full bg-[#3E1BDB]/20 flex items-center justify-center flex-shrink-0 mt-1">
                                <svg className="w-4 h-4 text-[#3E1BDB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="font-bold mb-2">Soroban Native (Rust)</h4>
                                <p className="text-sm text-white/50">Memory-safe smart contracts with 5-second finality and sub-cent transaction costs.</p>
                            </div>
                        </div>

                        <div className="bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 flex items-start gap-4 hover:border-[#00F0FF]/30 transition-all">
                            <div className="w-6 h-6 rounded-full bg-[#00F0FF]/20 flex items-center justify-center flex-shrink-0 mt-1">
                                <svg className="w-4 h-4 text-[#00F0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="font-bold mb-2">Auditable On-Chain History</h4>
                                <p className="text-sm text-white/50">Every badge mint is verifiable on Stellar Explorer for full transparency.</p>
                            </div>
                        </div>

                        <div className="bg-white/[0.02] backdrop-blur-sm p-8 rounded-2xl border border-white/10 flex items-start gap-4 hover:border-[#3E1BDB]/30 transition-all">
                            <div className="w-6 h-6 rounded-full bg-[#3E1BDB]/20 flex items-center justify-center flex-shrink-0 mt-1">
                                <svg className="w-4 h-4 text-[#3E1BDB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="font-bold mb-2">Open Source & Composable</h4>
                                <p className="text-sm text-white/50">MIT licensed codebase ready for integration with any Stellar DeFi protocol.</p>
                            </div>
                        </div>
                    </div>

                    {/* Tech Stack Badges */}
                    <div className="mt-12 flex flex-wrap justify-center gap-3">
                        <span className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-mono">Rust</span>
                        <span className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-mono">Soroban SDK</span>
                        <span className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-mono">Next.js 14</span>
                        <span className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-mono">TypeScript</span>
                        <span className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-mono">Stellar Network</span>
                    </div>
                </div>
            </section>

            {/* FOOTER */}
            <footer className="border-t border-white/5 bg-[#0A0B0D] py-12">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="text-center md:text-left">
                            <div className="text-xl font-bold mb-2">VIGENTE PROTOCOL</div>
                            <p className="text-sm text-white/40">© 2026 Vigente Protocol. All rights reserved.</p>
                        </div>

                        <div className="flex gap-6">
                            <a href="https://github.com/zzzbedream/VIGENTE-PROJECT" target="_blank" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all hover:scale-110">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                </svg>
                            </a>
                            <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all hover:scale-110">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                                </svg>
                            </a>
                        </div>
                    </div>
                </div>
            </footer>

            <style jsx>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 8s ease infinite;
        }
      `}</style>
        </div>
    );
}
