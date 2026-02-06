import { NextResponse } from "next/server";
import { Keypair, Contract, rpc, TransactionBuilder, nativeToScVal, xdr, TimeoutInfinite } from "@stellar/stellar-sdk";
import { createHmac } from "crypto";

export const dynamic = 'force-dynamic';

// Simple RUT cleaner (removed dependency on RutValidator)
function cleanRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.rut) {
      return NextResponse.json({ error: "RUT faltante" }, { status: 400 });
    }

    const { rut, tier, score } = body;

    // 1. Limpiar RUT (skip validation for demo)
    const rutClean = cleanRut(rut);
    if (rutClean.length < 8) {
      return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
    }

    // 2. Configurar Admin (Signer)
    const server = new rpc.Server(process.env.RPC_URL!);
    const adminSecret = process.env.ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return NextResponse.json({ error: "Server misconfiguration (ADMIN_SECRET)" }, { status: 500 });
    }
    const adminKey = Keypair.fromSecret(adminSecret);
    const adminAccount = await server.getAccount(adminKey.publicKey());

    // 3. Definir Usuario Destino
    // Para esta demo, generamos una keypair determinística basada en el RUT
    // En producción, esto vendría de la wallet conectada del usuario (Freighter)
    const userKey = Keypair.random();

    // 4. Preparar Argumentos para mint_badge
    // fn mint_badge(env, user: Address, tier: u32, score: u32, data_hash: BytesN<32>)

    const dataHash = createHmac('sha256', adminSecret).update(rutClean).digest();

    const args = [
      nativeToScVal(userKey.publicKey(), { type: 'address' }), // user
      nativeToScVal(Number(tier || 4), { type: 'u32' }),       // tier (default 4=D)
      nativeToScVal(Number(score || 0), { type: 'u32' }),      // score
      xdr.ScVal.scvBytes(dataHash)                             // data_hash
    ];

    // 5. Construir Transacción
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
    const networkPassphrase = process.env.NETWORK_PASSPHRASE?.trim();

    if (!contractId || !networkPassphrase) {
      return NextResponse.json({ error: "Server misconfiguration (CONTRACT_ID)" }, { status: 500 });
    }

    const tx = new TransactionBuilder(adminAccount, { fee: "100000" })
      .addOperation(new Contract(contractId).call("mint_badge", ...args))
      .setTimeout(30)
      .setNetworkPassphrase(networkPassphrase)
      .build();

    // 6. Simular
    const preparedTx = await server.prepareTransaction(tx);

    // 7. Firmar (Admin Auth Required)
    preparedTx.sign(adminKey);

    // 8. Enviar
    const sendResponse = await server.sendTransaction(preparedTx);

    if (sendResponse.status !== "PENDING") {
      console.error("TX Rejected:", sendResponse);
      return NextResponse.json({
        error: `Transaction failed: ${sendResponse.status}`,
        details: sendResponse
      }, { status: 400 });
    }

    // 9. Retornar Éxito
    return NextResponse.json({
      success: true,
      hash: sendResponse.hash,
      status: sendResponse.status,
      mintedTo: userKey.publicKey() // Informamos al frontend a quién se le minteó
    });

  } catch (error: any) {
    console.error("Mint API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}