"use client";
import { useState, useMemo } from "react";
import { jsPDF } from "jspdf";
import Image from "next/image";
import { TransactionHistoryChart } from "../components/TransactionHistoryChart";
import { useWallet } from "../contexts/WalletContext";
import { mintCreditBadge } from "../services/mint-service";

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------
interface CreditProfile {
    found: boolean;
    profile: {
        name: string;
        country: string;
        kycLevel: number;
        registeredAt: string;
    };
    scoring: {
        totalScore: number;
        tier: number;
        badgeType: "Gold" | "Silver" | "Bronze" | "None";
        maxLoanAmount: number;
        breakdown: {
            volumePoints: number;
            consistencyPoints: number;
            frequencyPoints: number;
        };
    };
    history: any[];
    oracleSignature: string;
}

// -----------------------------------------------------------------------------
// VALIDATOR (RUT - CHILE)
// -----------------------------------------------------------------------------
const RutValidator = {
    clean: (rut: string): string => rut.replace(/[^0-9kK\-]/g, '').toUpperCase(),
    validateFormat: (rut: string): { valid: boolean; error?: string } => {
        const cleanRut = RutValidator.clean(rut);
        if (!cleanRut.includes('-')) return { valid: false, error: "Formato inválido. Usa el formato: 12345678-K" };
        const parts = cleanRut.split('-');
        if (parts.length !== 2) return { valid: false, error: "Formato inválido. Usa el formato: 12345678-K" };
        const [num, dv] = parts;
        if (!/^\d{7,8}$/.test(num)) return { valid: false, error: "El RUT debe tener 7 u 8 dígitos antes del guión" };
        if (!/^[0-9K]$/.test(dv)) return { valid: false, error: "El dígito verificador debe ser un número (0-9) o K" };
        return { valid: true };
    },
    validate: (rut: string): boolean => {
        const formatCheck = RutValidator.validateFormat(rut);
        if (!formatCheck.valid) return false;

        // DEMO MODE: Skip mathematical check digit validation
        // In production, uncomment the code below to enable full validation
        return true;

        /* FULL VALIDATION (Commented for demo):
        const cleanRut = RutValidator.clean(rut);
        const [num, dv] = cleanRut.split('-');
        let sum = 0, mul = 2;
        for (let i = num.length - 1; i >= 0; i--) {
            sum += parseInt(num.charAt(i)) * mul;
            mul = mul === 7 ? 2 : mul + 1;
        }
        const expected = 11 - (sum % 11);
        let validDv = expected === 11 ? '0' : expected === 10 ? 'K' : expected.toString();
        return validDv === dv.toUpperCase();
        */
    },
    validateWithError: (rut: string): { valid: boolean; error?: string } => {
        const formatCheck = RutValidator.validateFormat(rut);
        if (!formatCheck.valid) return formatCheck;

        // DEMO MODE: Skip check digit verification error
        // if (!RutValidator.validate(rut)) return { valid: false, error: "Dígito verificador incorrecto" };

        return { valid: true };
    }
};

export default function Home() {
    const { isConnected, publicKey } = useWallet();
    const [rut, setRut] = useState("");
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [creditProfile, setCreditProfile] = useState<CreditProfile | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [txHash, setTxHash] = useState<string | null>(null);

    // Validación en tiempo real del RUT
    const rutValidation = useMemo(() => {
        if (!rut) return { valid: false, error: undefined };
        return RutValidator.validateWithError(rut);
    }, [rut]);

    const addLog = (msg: string) => setLogs(prev => [...prev, `> ${msg}`]);

    // ---------------------------------------------------------------------------
    // RUT AUTO-FORMAT FUNCTION
    // ---------------------------------------------------------------------------
    const formatRut = (value: string): string => {
        // Remove all non-alphanumeric characters
        const clean = value.replace(/[^0-9kK]/g, '').toUpperCase();

        if (clean.length === 0) return '';
        if (clean.length === 1) return clean;

        // Split into body and verifier digit
        const body = clean.slice(0, -1);
        const verifier = clean.slice(-1);

        // Add thousand separators to body
        const formatted = body.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');

        // Return formatted with hyphen
        return `${formatted}-${verifier}`;
    };

    // Handle RUT input change with auto-formatting
    const handleRutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        const formatted = formatRut(rawValue);
        setRut(formatted);
    };

    // ---------------------------------------------------------------------------
    // STEP 1: CONNECT & ANALYZE (CALL ORACLE)
    // ---------------------------------------------------------------------------
    const handleConnectMoneyGram = async () => {
        if (!rutValidation.valid) {
            addLog(`❌ ${rutValidation.error || "RUT inválido"}`);
            return;
        }

        setIsLoading(true);
        addLog("📡 Connecting to MoneyGram Access API...");

        try {
            // Llamada al endpoint real que implementamos
            // Incluimos publicKey para recibir un score firmado para esa wallet específica
            console.log("DEBUG: publicKey for signing:", publicKey);
            const cacheBuster = `&_t=${Date.now()}`;
            const url = `/api/score?rut=${rut}${publicKey ? `&userAddress=${publicKey}` : ''}${cacheBuster}`;
            console.log("DEBUG: Fetching URL:", url);

            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();

            console.log("DEBUG: API Response Scoring:", data?.scoring);
            console.log("DEBUG: Signature received:", data?.scoring?.signature);
            console.log("DEBUG: Server _debug:", data?._debug);

            if (res.ok && data.found) {
                setCreditProfile(data);
                addLog("✅ User Identity Verified (KYC Level " + data.profile.kycLevel + ")");
                addLog("📊 Remittance History Downloaded.");
                addLog(`🏆 Score Calculated: ${data.scoring.totalScore} Pts (Tier ${data.scoring.tier})`);

                // Simular un pequeño delay para efecto UI
                setTimeout(() => {
                    setStep(2);
                    setIsLoading(false);
                }, 800);
            } else {
                addLog(`❌ ${data.message || "User not found"}`);
                setIsLoading(false);
            }
        } catch (error: any) {
            addLog(`❌ API Error: ${error.message}`);
            setIsLoading(false);
        }
    };

    // ---------------------------------------------------------------------------
    // STEP 2: MINT BADGE (ON-CHAIN)
    // ---------------------------------------------------------------------------
    const handleMintBadge = async () => {
        if (!creditProfile) return;

        // Check wallet connection
        if (!isConnected || !publicKey) {
            addLog("❌ Please connect your wallet first");
            alert("Please connect your Freighter wallet before minting");
            return;
        }

        setIsLoading(true);
        addLog("⛓️ Preparing transaction with your wallet...");
        addLog("📝 Building CreditBadge Mint Transaction...");

        try {
            const signature = (creditProfile.scoring as any).signature;

            // Call client-side mint service (signature no longer needed - simplified contract)
            const result = await mintCreditBadge({
                userAddress: publicKey,
                tier: creditProfile.scoring.tier,
                score: (creditProfile.scoring as any).score || creditProfile.scoring.totalScore,
                rut: (creditProfile as any).rut || rut,
                creditProfile // Pass full creditProfile for dataHash
            });

            if (result.success && result.hash) {
                addLog("✅ BADGE MINTED ON STELLAR NETWORK!");
                addLog(`TX HASH: ${result.hash}`);
                setTxHash(result.hash);
                setStep(3);
            } else {
                addLog(`❌ Mint Error: ${result.error || "Unknown error"}`);
            }
        } catch (e: any) {
            addLog(`💥 Network Error: ${e.message}`);
        }
        setIsLoading(false);
    };

    // ---------------------------------------------------------------------------
    // RENDER
    // ---------------------------------------------------------------------------
    return (
        <div className="min-h-screen bg-[#0d0f11] text-slate-300 font-sans selection:bg-cyan-500/30">
            {/* Navbar is now in layout.tsx */}
            <main className="max-w-5xl mx-auto pt-24 px-6 pb-20">

                {/* HERO SECTION */}
                <div className="flex flex-col items-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 mb-4 tracking-tight text-center">
                        Financial Identity Protocol
                    </h1>
                    <p className="text-slate-400 max-w-xl text-center text-lg">
                        Turn your MoneyGram remittance history into a verifiable
                        <span className="text-cyan-400 font-semibold mx-1">On-Chain Credit Score</span>
                        to access global DeFi loans for your business.
                    </p>
                </div>

                <div className="grid gap-8">

                    {/* -------------------------------------------------------------- */}
                    {/* STEP 1: IDENTITY & CONNECT */}
                    {/* -------------------------------------------------------------- */}
                    <div className={`bg-[#121417] border rounded-xl overflow-hidden transition-all duration-500 relative ${step === 1 ? 'border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.15)]' : 'border-white/5 opacity-40'}`}>
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-cyan-400 to-blue-600"></div>
                        <div className="p-8">
                            <h3 className="text-white font-bold text-xl mb-6 flex items-center gap-3">
                                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500 text-black font-black text-sm">1</span>
                                Connect Financial Data
                            </h3>

                            <div className="grid md:grid-cols-2 gap-8 items-center">
                                <div className="space-y-4">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Chilean National ID (RUT)</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="e.g. 202444520 o 7452862K"
                                            maxLength={12}
                                            className={`w-full bg-black/40 border p-4 rounded-lg outline-none transition-all text-white text-lg font-mono ${rut && !rutValidation.valid
                                                ? 'border-red-500/50 focus:border-red-500'
                                                : rut && rutValidation.valid
                                                    ? 'border-cyan-500/50 focus:border-cyan-500'
                                                    : 'border-white/10 focus:border-cyan-500/50'
                                                }`}
                                            value={rut}
                                            onChange={handleRutChange}
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                            {rutValidation.valid && <span className="text-cyan-400 text-xl">✓</span>}
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500">
                                        We use your ID to fetch hashed remittance records from the MoneyGram Oracle.
                                    </p>
                                </div>

                                <div className="bg-white/5 rounded-xl p-6 border border-white/5 flex flex-col items-center text-center">
                                    <div className="mb-4 p-3 bg-white/5 rounded-full">
                                        <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                                        </svg>
                                    </div>
                                    <h4 className="text-white font-bold mb-2">MoneyGram Integration</h4>
                                    <p className="text-xs text-slate-400 mb-4">
                                        Securely access your remittance history to calculate your credit score.
                                    </p>
                                    <button
                                        onClick={handleConnectMoneyGram}
                                        disabled={isLoading || step !== 1 || !rutValidation.valid}
                                        className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-cyan-900/20"
                                    >
                                        {isLoading ? "Analyzing Data..." : "Connect & Analyze"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* -------------------------------------------------------------- */}
                    {/* STEP 2: DASHBOARD & MINT */}
                    {/* -------------------------------------------------------------- */}
                    {step >= 2 && creditProfile && (
                        <div className={`bg-[#121417] border rounded-xl overflow-hidden transition-all duration-700 relative animate-in zoom-in-95 ${step === 2 ? 'border-cyan-500/50' : 'border-white/5 opacity-50'}`}>
                            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-500 to-pink-600"></div>

                            <div className="p-8">
                                <div className="flex flex-col md:flex-row justify-between items-start mb-8 gap-4">
                                    <div>
                                        <h3 className="text-white font-bold text-2xl flex items-center gap-3">
                                            Credit Profile Dashboard
                                            {creditProfile.scoring.badgeType !== "None" && (
                                                <span className={`text-xs px-2 py-1 rounded border ${creditProfile.scoring.badgeType === 'Gold' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                                                    creditProfile.scoring.badgeType === 'Silver' ? 'bg-slate-300/10 text-slate-300 border-slate-300/30' :
                                                        'bg-orange-700/10 text-orange-400 border-orange-700/30'
                                                    }`}>
                                                    {creditProfile.scoring.badgeType} Badge
                                                </span>
                                            )}
                                        </h3>
                                        <p className="text-slate-500 text-sm mt-1">Hello, <span className="text-white font-medium">{creditProfile.profile.name}</span> ({creditProfile.profile.country})</p>
                                    </div>

                                    <div className="text-right">
                                        <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Total Score</div>
                                        <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
                                            {creditProfile.scoring.totalScore}
                                        </div>
                                    </div>
                                </div>


                                <div className="grid lg:grid-cols-3 gap-6 mb-8">

                                    {/* CHART COLUMN (Span 2) */}
                                    <div className="lg:col-span-2">
                                        <TransactionHistoryChart transactions={creditProfile.history} />
                                    </div>

                                    {/* STATS COLUMN */}
                                    <div className="bg-black/20 rounded-xl border border-white/5 p-6 flex flex-col justify-between">
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-300 mb-4 border-b border-white/5 pb-2">Scoring Breakdown</h4>
                                            <div className="space-y-4">
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-slate-500">Volume</span>
                                                    <span className="font-mono text-cyan-400">+{creditProfile.scoring.breakdown.volumePoints}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-slate-500">Consistency</span>
                                                    <span className="font-mono text-cyan-400">+{creditProfile.scoring.breakdown.consistencyPoints}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-slate-500">Frequency</span>
                                                    <span className="font-mono text-cyan-400">+{creditProfile.scoring.breakdown.frequencyPoints}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-8 pt-4 border-t border-white/5">
                                            <div className="text-xs text-slate-500 uppercase mb-1">Approved Credit Limit</div>
                                            <div className="text-3xl font-bold text-white">
                                                ${creditProfile.scoring.maxLoanAmount} <span className="text-lg text-slate-500">USDC</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3">
                                    {step === 2 && (
                                        <button
                                            onClick={handleMintBadge}
                                            disabled={isLoading}
                                            className="bg-green-600 hover:bg-green-500 text-black font-black py-4 px-8 rounded-lg text-sm transition-all shadow-lg shadow-green-900/20 flex items-center gap-2"
                                        >
                                            {isLoading ? (
                                                <span className="animate-spin text-xl">◌</span>
                                            ) : (
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                            )}
                                            MINT CREDIT BADGE
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* -------------------------------------------------------------- */}
                    {/* STEP 3: SUCCESS */}
                    {/* -------------------------------------------------------------- */}
                    {step === 3 && txHash && (
                        <div className="bg-[#121417] border border-green-500/50 rounded-xl p-8 text-center animate-in zoom-in-95 shadow-[0_0_50px_rgba(34,197,94,0.1)]">
                            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/30">
                                <span className="text-4xl">🎉</span>
                            </div>
                            <h2 className="text-3xl font-bold text-white mb-2">Reputation Minted!</h2>
                            <p className="text-slate-400 mb-8 max-w-md mx-auto">
                                Your <b>{creditProfile?.scoring.badgeType} Credit Badge</b> is now live on the Stellar Network.
                                You can now access under-collateralized loans on Blend Protocol.
                            </p>

                            <div className="bg-black/30 rounded-lg p-4 max-w-lg mx-auto mb-8 border border-white/10 flex flex-col items-center">
                                <span className="text-xs text-slate-500 uppercase font-bold mb-2">Transaction Hash</span>
                                <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" className="font-mono text-cyan-400 hover:text-cyan-300 text-xs break-all hover:underline">
                                    {txHash}
                                </a>
                            </div>

                            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                                <button onClick={() => window.location.reload()} className="py-3 rounded-lg border border-white/10 hover:bg-white/5">
                                    Start Over
                                </button>
                                <button className="py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold">
                                    View on Blend
                                </button>
                            </div>
                        </div>
                    )}

                    {/* -------------------------------------------------------------- */}
                    {/* LOGS CONSOLE */}
                    {/* -------------------------------------------------------------- */}
                    <div className="bg-black/60 rounded-xl p-6 border border-white/5 font-mono text-[11px] leading-relaxed max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800">
                        <div className="flex items-center gap-2 mb-2 sticky top-0 bg-black/60 pb-2 border-b border-white/5 backdrop-blur-sm">
                            <span className="text-green-500">●</span>
                            <span className="text-slate-500 uppercase">System Logs</span>
                        </div>
                        {logs.length === 0 && <span className="text-slate-600 italic">Waiting for connection...</span>}
                        {logs.map((log, i) => (
                            <div key={i} className="text-green-500/80 hover:text-green-400 py-0.5">
                                {log}
                            </div>
                        ))}
                    </div>

                </div>
            </main>
        </div>
    );
}
