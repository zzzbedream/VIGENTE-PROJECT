"use client";
import { useState, useMemo } from "react";
import { jsPDF } from "jspdf";

// Validador de RUT (misma lógica que el backend)
const RutValidator = {
  clean: (rut: string): string => {
    return rut.replace(/[^0-9kK\-]/g, '').toUpperCase();
  },

  validateFormat: (rut: string): { valid: boolean; error?: string } => {
    const cleanRut = RutValidator.clean(rut);
    
    if (!cleanRut.includes('-')) {
      return { valid: false, error: "Formato inválido. Usa el formato: 12345678-K" };
    }

    const parts = cleanRut.split('-');
    if (parts.length !== 2) {
      return { valid: false, error: "Formato inválido. Usa el formato: 12345678-K" };
    }

    const [num, dv] = parts;

    if (!/^\d{7,8}$/.test(num)) {
      return { valid: false, error: "El RUT debe tener 7 u 8 dígitos antes del guión" };
    }

    if (!/^[0-9K]$/.test(dv)) {
      return { valid: false, error: "El dígito verificador debe ser un número (0-9) o K" };
    }

    return { valid: true };
  },

  validate: (rut: string): boolean => {
    const formatCheck = RutValidator.validateFormat(rut);
    if (!formatCheck.valid) return false;

    const cleanRut = RutValidator.clean(rut);
    const [num, dv] = cleanRut.split('-');

    let sum = 0;
    let mul = 2;

    for (let i = num.length - 1; i >= 0; i--) {
      sum += parseInt(num.charAt(i)) * mul;
      mul = mul === 7 ? 2 : mul + 1;
    }

    const expected = 11 - (sum % 11);
    let validDv: string;
    
    if (expected === 11) validDv = '0';
    else if (expected === 10) validDv = 'K';
    else validDv = expected.toString();

    return validDv === dv.toUpperCase();
  },

  validateWithError: (rut: string): { valid: boolean; error?: string } => {
    const formatCheck = RutValidator.validateFormat(rut);
    if (!formatCheck.valid) return formatCheck;

    if (!RutValidator.validate(rut)) {
      return { valid: false, error: "Dígito verificador incorrecto. Verifica tu RUT" };
    }

    return { valid: true };
  }
};


export default function Home() {
  const [rut, setRut] = useState("");
  const [step, setStep] = useState(1); 
  const [isLoading, setIsLoading] = useState(false);
  const [scoring, setScoring] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Validación en tiempo real del RUT
  const rutValidation = useMemo(() => {
    if (!rut) return { valid: false, error: undefined };
    return RutValidator.validateWithError(rut);
  }, [rut]);

  const addLog = (msg: string) => setLogs(prev => [...prev, `> ${msg}`]);

  const generateCertificate = () => {
    if (!txHash || !scoring) return;
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header con fondo verde
    doc.setFillColor(34, 197, 94);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    // Logo/Título
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.text('VIGENTE', pageWidth / 2, 25, { align: 'center' });
    
    // Subtítulo
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Certificado de Registro en Blockchain', pageWidth / 2, 33, { align: 'center' });
    
    // Contenido principal
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('CERTIFICADO DE FINANCIAMIENTO DIGITAL', pageWidth / 2, 60, { align: 'center' });
    
    // Línea decorativa
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.5);
    doc.line(40, 65, pageWidth - 40, 65);
    
    // Información del certificado
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const startY = 80;
    const lineHeight = 10;
    
    doc.setFont('helvetica', 'bold');
    doc.text('Folio:', 30, startY);
    doc.setFont('helvetica', 'normal');
    doc.text(scoring.folio, 70, startY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('RUT Empresa:', 30, startY + lineHeight);
    doc.setFont('helvetica', 'normal');
    doc.text(rut, 70, startY + lineHeight);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Score:', 30, startY + lineHeight * 2);
    doc.setFont('helvetica', 'normal');
    doc.text(`${scoring.score} Pts - ${scoring.capacidad}`, 70, startY + lineHeight * 2);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Estado:', 30, startY + lineHeight * 3);
    doc.setTextColor(34, 197, 94);
    doc.text(scoring.status, 70, startY + lineHeight * 3);
    
    doc.setTextColor(50, 50, 50);
    doc.setFont('helvetica', 'bold');
    doc.text('Fecha Registro:', 30, startY + lineHeight * 4);
    doc.setFont('helvetica', 'normal');
    doc.text(new Date().toLocaleString('es-CL'), 70, startY + lineHeight * 4);
    
    // TX Hash (destacado)
    doc.setFillColor(240, 240, 240);
    doc.roundedRect(25, startY + lineHeight * 5.5, pageWidth - 50, 30, 3, 3, 'F');
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('TRANSACTION HASH (Stellar Testnet):', 30, startY + lineHeight * 6.5);
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.text(txHash, 30, startY + lineHeight * 7.5);
    
    // Mensaje de verificación
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    doc.text(
      'Este documento certifica que el financiamiento ha sido registrado de forma inmutable',
      pageWidth / 2, startY + lineHeight * 10, { align: 'center' }
    );
    doc.text(
      'en la red Stellar Testnet. Puede verificar la transacción en stellar.expert',
      pageWidth / 2, startY + lineHeight * 11, { align: 'center' }
    );
    
    // Footer
    doc.setFillColor(18, 20, 23);
    doc.rect(0, 270, pageWidth, 30, 'F');
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(8);
    doc.text('VIGENTE - Sistema de Validación Digital de Financiamiento', pageWidth / 2, 280, { align: 'center' });
    doc.text('Powered by Stellar Blockchain', pageWidth / 2, 286, { align: 'center' });
    
    // Descargar
    doc.save(`certificado-vigente-${scoring.folio}.pdf`);
  };

  const handleSIIValidation = () => {
    // Validar RUT antes de continuar
    if (!rutValidation.valid) {
      addLog(`❌ ${rutValidation.error || "RUT inválido"}`);
      return;
    }
    
    setIsLoading(true);
    addLog("📡 Estableciendo túnel seguro con SII...");
    
    setTimeout(() => {
      addLog("✅ Autenticación exitosa.");
      addLog("📊 Procesando vectores de scoring...");
      
      const mockScoring = {
        folio: `V-GE-${Math.floor(Math.random() * 999999)}`,
        score: 820,
        status: "VIGENTE",
        capacidad: "ÓPTIMA"
      };
      
      setScoring(mockScoring);
      setStep(2);
      setIsLoading(false);
    }, 2000);
  };

const handleBlockchainMint = async () => {
    setIsLoading(true);
    addLog("⛓️ Iniciando handshake con Soroban...");
    
    try {
      // MODIFICACIÓN AQUÍ: Añadimos Headers y Body
      const response = await fetch("/api/mint", { 
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rut: rut }) // Envia el RUT que el usuario ingresó
      });

      const data = await response.json();

      if (data.success) {
        addLog("✅ REGISTRO EN LEDGER COMPLETADO.");
        addLog(`TX HASH: ${data.hash}`);
        setTxHash(data.hash);
        setStep(3);
      } else {
        // Mostramos el error específico que viene del servidor
        addLog(`❌ Error: ${data.error || "Falla en el servidor"}`);
      }
    } catch (e) {
      addLog("💥 Fallo de comunicación con la API.");
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0d0f11] text-slate-300 font-sans selection:bg-green-500/30">
      {/* NAVBAR AL ESTILO DE LA IMAGEN */}
      <nav className="border-b border-white/5 bg-[#121417] px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-500 rounded flex items-center justify-center font-black text-black italic">V</div>
          <span className="text-xl font-bold tracking-tighter text-white">VIGENTE</span>
        </div>
        <div className="flex gap-4 items-center">
            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10"></div>
            <button className="bg-green-500 text-black px-4 py-1.5 rounded font-bold text-xs hover:bg-green-400 transition-colors">
                SOANG
            </button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto pt-16 px-6 pb-20">
        
        {/* LOGO CENTRAL Y TÍTULO */}
        <div className="flex flex-col items-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
             <div className="text-6xl mb-4 text-green-500">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
             </div>
             <h2 className="text-5xl font-black text-white tracking-tight">VIGENTE</h2>
             <p className="text-slate-500 mt-2 font-medium tracking-wide">Viblide agoles • Operación Digital</p>
        </div>

        <div className="grid gap-6">
          
          {/* PASO 1: VALIDACIÓN */}
          <div className={`bg-[#121417] border rounded-xl overflow-hidden transition-all duration-500 ${step === 1 ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.1)]' : 'border-white/5 opacity-50'}`}>
            <div className="p-8">
                <h3 className="text-white font-bold mb-6 flex items-center gap-3">
                    <span className="text-green-500">01</span> VALIDAR CREDENCIALES
                </h3>
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                        <input 
                            type="text" 
                            placeholder="Ej: 12345678-K" 
                            maxLength={12}
                            className={`bg-black/40 border p-4 rounded-lg outline-none transition-all text-white ${
                              rut && !rutValidation.valid 
                                ? 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500' 
                                : rut && rutValidation.valid
                                  ? 'border-green-500 focus:border-green-500 focus:ring-1 focus:ring-green-500'
                                  : 'border-white/10 focus:border-green-500 focus:ring-1 focus:ring-green-500'
                            }`}
                            value={rut}
                            onChange={(e) => setRut(e.target.value)}
                        />
                        {rut && rutValidation.error && (
                          <p className="text-red-400 text-xs flex items-center gap-1">
                            <span>⚠️</span> {rutValidation.error}
                          </p>
                        )}
                        {rut && rutValidation.valid && (
                          <p className="text-green-400 text-xs flex items-center gap-1">
                            <span>✓</span> RUT válido
                          </p>
                        )}
                    </div>
                    <button 
                        onClick={handleSIIValidation}
                        disabled={isLoading || step !== 1 || !rutValidation.valid}
                        className="bg-green-600 hover:bg-green-500 disabled:bg-slate-800 disabled:cursor-not-allowed text-black font-black py-4 rounded-lg transition-all"
                    >
                        {isLoading ? "PROCESANDO..." : "VALIDAR EN SII"}
                    </button>
                </div>
            </div>
          </div>

          {/* PASO 2: SCORE Y RESULTADO */}
          {step >= 2 && (
            <div className={`bg-[#121417] border rounded-xl overflow-hidden transition-all duration-500 ${step === 2 ? 'border-green-500' : 'border-white/5 opacity-50'}`}>
                <div className="p-8">
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <h3 className="text-white font-bold mb-1">REPORTE DE VIGENCIA</h3>
                            <p className="text-xs text-slate-500 tracking-widest uppercase">Folio: {scoring?.folio}</p>
                        </div>
                        <div className="bg-green-500/10 text-green-500 px-3 py-1 rounded border border-green-500/20 font-bold text-xs">
                            {scoring?.status}
                        </div>
                    </div>

                    <div className="mb-8">
                        <div className="flex justify-between text-xs mb-2">
                            <span className="text-slate-400">Score de Confianza</span>
                            <span className="text-green-500 font-bold">{scoring?.score} Pts</span>
                        </div>
                        <div className="h-2 w-full bg-black rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 shadow-[0_0_10px_#22c55e]" style={{width: '91%'}}></div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <button className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-lg border border-white/10 text-sm transition-all">
                            DESCARGAR PDF
                        </button>
                        {step === 2 && (
                             <button 
                                onClick={handleBlockchainMint}
                                className="flex-1 bg-green-600 hover:bg-green-500 text-black font-black py-3 rounded-lg text-sm transition-all shadow-lg shadow-green-900/20"
                             >
                                REGISTRAR EN LEDGER
                             </button>
                        )}
                    </div>
                </div>
            </div>
          )}

          {/* PASO 3: CERTIFICADO */}
          {step === 3 && txHash && (
            <div className="bg-[#121417] border border-green-500 rounded-xl overflow-hidden transition-all duration-500 shadow-[0_0_30px_rgba(34,197,94,0.2)]">
                <div className="p-8">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-4">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </div>
                        <h3 className="text-white font-bold text-xl mb-2">¡REGISTRO EXITOSO!</h3>
                        <p className="text-slate-400 text-sm mb-6">Tu financiamiento ha sido registrado en Blockchain</p>
                        
                        <div className="w-full bg-black/40 rounded-lg p-4 mb-6 border border-white/10">
                            <p className="text-xs text-slate-500 mb-2">TX HASH</p>
                            <p className="text-green-500 font-mono text-xs break-all">{txHash}</p>
                        </div>
                        
                        <div className="flex gap-4 w-full">
                            <a 
                                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-lg border border-white/10 text-sm transition-all text-center"
                            >
                                VER EN EXPLORER
                            </a>
                            <button 
                                onClick={generateCertificate}
                                className="flex-1 bg-green-600 hover:bg-green-500 text-black font-black py-3 rounded-lg text-sm transition-all shadow-lg shadow-green-900/20 flex items-center justify-center gap-2"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                DESCARGAR CERTIFICADO
                            </button>
                        </div>
                    </div>
                </div>
            </div>
          )}

          {/* CONSOLA DE SALIDA */}
          <div className="bg-black/60 rounded-xl p-6 border border-white/5 font-mono text-[11px] leading-relaxed">
            <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="ml-2 text-slate-600 uppercase tracking-tighter">System Terminal</span>
            </div>
            <div className="space-y-1">
                {logs.length === 0 && <span className="text-slate-700">Inicie validación para ver logs...</span>}
                {logs.map((log, i) => (
                    <div key={i} className="text-green-500/80">
                        <span className="text-slate-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                        {log}
                    </div>
                ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}