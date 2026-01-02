import { NextResponse } from "next/server";
import { Keypair, Contract, rpc, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { RutValidator } from "../../lib/rut-validator";

export async function POST(req: Request) {
  try {
    // Verificamos que el cuerpo no venga vacío
    const body = await req.json().catch(() => null);
    
    if (!body || !body.rut) {
      return NextResponse.json({ error: "No se recibieron datos (RUT faltante)" }, { status: 400 });
    }

    const { rut, amount } = body;
    
    // 1. VALIDACIÓN DE IDENTIDAD (Backend Guard)
    const rutValidation = RutValidator.validateWithError(rut);
    if (!rutValidation.valid) {
        return NextResponse.json({ error: rutValidation.error }, { status: 400 });
    }

    // 1.a Verificar RUT autorizado
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

    // 3. PREPARAR PARÁMETROS PARA CONTRATO V1
    // Firma del contrato v1: mint_deal(rut: String, amount: i128) -> u64
    const cleanRut = RutValidator.clean(rut);
    const mintAmount = BigInt(amount || 5000000);

    // 4. CONSTRUCCIÓN DE LA TRANSACCIÓN
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
    const networkPassphrase = process.env.NETWORK_PASSPHRASE?.trim();
    
    if (!contractId || !networkPassphrase) {
      console.error("❌ CONTRACT_ID o NETWORK_PASSPHRASE no configuradas");
      return NextResponse.json({ error: "Configuración del servidor incompleta" }, { status: 500 });
    }

    const tx = new TransactionBuilder(account, { fee: "100000" })
      .addOperation(new Contract(contractId).call(
        "mint_deal", 
        nativeToScVal(cleanRut, { type: 'string' }),   // rut: String
        nativeToScVal(mintAmount, { type: 'i128' })    // amount: i128
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
    if (sendResponse.status !== "PENDING") {
        console.error("❌ Transacción rechazada:", sendResponse);
        return NextResponse.json({ 
            error: `La transacción no pudo ser procesada: ${sendResponse.status}`,
            details: sendResponse 
        }, { status: 400 });
    }

    // Happy Path - transacción enviada
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