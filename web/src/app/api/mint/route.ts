import { NextResponse } from "next/server";
import { Keypair, Contract, rpc, TransactionBuilder, Networks, nativeToScVal } from "@stellar/stellar-sdk";
import { RutValidator } from "../../lib/rut-validator";
import { createHmac } from "crypto";

export async function POST(req: Request) {
  try {
    // Verificamos que el cuerpo no venga vacío
    const body = await req.json().catch(() => null);
    
    if (!body || !body.rut) {
      return NextResponse.json({ error: "No se recibieron datos (RUT faltante)" }, { status: 400 });
    }

    const { rut, amount } = body;
    // ... sigue el resto de tu lógica de validación y Stellar
    // 1. VALIDACIÓN DE IDENTIDAD (Backend Guard)
    const rutValidation = RutValidator.validateWithError(rut);
    if (!rutValidation.valid) {
        return NextResponse.json({ error: rutValidation.error }, { status: 400 });
    }

    // 1.a Consentimiento (Ley Fintech) - TODO: Sprint 3 - integrar LegalCore
    // Por ahora saltamos la verificación de consentimiento

    const authorized = process.env.AUTHORIZED_RUTS?.split(",") || [];
    if (!authorized.includes(RutValidator.clean(rut))) {
        return NextResponse.json({ error: "RUT no autorizado en el sistema Vigente" }, { status: 403 });
    }

    // 2. CONFIGURACIÓN DE CONEXIÓN
    const server = new rpc.Server(process.env.RPC_URL!);
    const adminSecret = process.env.ADMIN_SECRET?.trim();
    if (!adminSecret) {
      console.error("❌ ADMIN_SECRET no configurada");
      return NextResponse.json({ error: "Configuración del servidor incompleta" }, { status: 500 });
    }
    const sourceKey = Keypair.fromSecret(adminSecret);
    const account = await server.getAccount(sourceKey.publicKey());

    // 3. PREPARAR PARÁMETROS PARA PymeTokenV1
    // Firma: mint_deal(data_hash: BytesN<32>, partner: Address, amount: i128, nonce: i128)
    
    // 3.1 data_hash: HMAC-SHA256 del RUT (privacidad - el RUT nunca va on-chain)
    const hashSecret = process.env.ADMIN_SECRET || "default-hash-secret";
    const dataHash = createHmac('sha256', hashSecret).update(rut).digest();
    
    // 3.2 partner: La dirección del admin que firma
    const partnerAddress = sourceKey.publicKey();
    
    // 3.3 amount: Monto en stroops (del body o default 5M = 0.5 XLM)
    const mintAmount = BigInt(amount || 5000000);
    
    // 3.4 nonce: Timestamp para idempotencia
    const nonce = BigInt(Date.now());

    // 4. CONSTRUCCIÓN DE LA TRANSACCIÓN (PymeTokenV1)
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
    const networkPassphrase = process.env.NETWORK_PASSPHRASE?.trim();
    
    if (!contractId || !networkPassphrase) {
      console.error("❌ CONTRACT_ID o NETWORK_PASSPHRASE no configuradas");
      return NextResponse.json({ error: "Configuración del servidor incompleta" }, { status: 500 });
    }

    const tx = new TransactionBuilder(account, { fee: "100000" })
      .addOperation(new Contract(contractId).call(
        "mint_deal", 
        nativeToScVal(dataHash, { type: 'bytes' }),           // data_hash (32 bytes)
        nativeToScVal(partnerAddress, { type: 'address' }),   // partner
        nativeToScVal(mintAmount, { type: 'i128' }),          // amount
        nativeToScVal(nonce, { type: 'i128' })                // nonce
      ))
      .setTimeout(30)
      .setNetworkPassphrase(networkPassphrase)
      .build();

    // 5. SIMULAR Y PREPARAR (necesario para Soroban)
    const preparedTx = await server.prepareTransaction(tx);

    // 6. FIRMA ELECTRÓNICA (Admin Signature)
    preparedTx.sign(sourceKey);

    // 7. ENVÍO Y MANEJO DE RESPUESTA
    const sendResponse = await server.sendTransaction(preparedTx);

    // En Soroban, el éxito inicial es siempre "PENDING"
    // Si es "ERROR", "DUPLICATE" o "TRY_AGAIN_LATER", algo salió mal
    if (sendResponse.status !== "PENDING") {
        console.error("❌ Transacción rechazada o duplicada:", sendResponse);
        return NextResponse.json({ 
            error: `La transacción no pudo ser procesada: ${sendResponse.status}`,
            details: sendResponse 
        }, { status: 400 });
    }

    // Si llegamos aquí, status es "PENDING", lo cual es el "Happy Path" inicial
    return NextResponse.json({ 
        success: true, 
        hash: sendResponse.hash,
        status: sendResponse.status 
    });

  } catch (error: any) {
    console.error("💥 Error crítico en el servidor:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}