/**
 * Vigente Protocol — Endpoint: /api/evaluate-and-fund
 * 
 * Happy Path completo para demo con Payku:
 *   1. Lee historial transaccional del comercio desde Payku Oracle
 *   2. Ejecuta Scoring Engine → Tier + Score
 *   3. Minte SBT (Credit Badge) en Soroban si Tier >= Bronze
 *   4. Ordena Payout (dispersión fiat) via Payku Payout API
 * 
 * Query params:
 *   ?rut=76.543.210-K          (RUT del comercio)
 *   &userAddress=GABC...       (dirección Stellar del usuario, opcional para mint)
 */

import { NextResponse } from "next/server";
import { fetchPaykuData, calculateTransactionStats } from "@/services/payku-oracle";
import { calculateCreditScore } from "@/services/scoring-engine";
import { createPayout, formatCLP } from "@/services/payku-payout";
import { Keypair, Contract, rpc, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { createHmac } from "crypto";
import { guardApiRequest, genericErrorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // G.2: combined evaluate + mint + payout — strict limit because it
  // triggers a Soroban tx via the admin keypair.
  const blocked = guardApiRequest(req, { limit: 3 });
  if (blocked) return blocked;

  const startTime = Date.now();
  const steps: { step: string; status: string; detail?: string }[] = [];

  try {
    const { searchParams } = new URL(req.url);
    const rut = searchParams.get("rut");
    const userAddress = searchParams.get("userAddress");

    if (!rut) {
      return NextResponse.json({ error: "RUT requerido (?rut=76.543.210-K)" }, { status: 400 });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Payku Oracle — Obtener historial transaccional
    // ═══════════════════════════════════════════════════════════════════════════
    const oracleData = await fetchPaykuData(rut);
    steps.push({
      step: "1_payku_oracle",
      status: "ok",
      detail: `${oracleData.transactions.length} transacciones obtenidas para ${oracleData.merchant.name}`,
    });

    if (!oracleData.transactions || oracleData.transactions.length === 0) {
      return NextResponse.json({
        found: false,
        message: "Sin historial transaccional en Payku",
        steps,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Scoring Engine — Calcular score y tier
    // ═══════════════════════════════════════════════════════════════════════════
    const scoreResult = calculateCreditScore(oracleData.transactions);
    const stats = calculateTransactionStats(oracleData.transactions);

    steps.push({
      step: "2_scoring_engine",
      status: "ok",
      detail: `Score: ${scoreResult.totalScore}/100 → Tier ${scoreResult.badgeType} (max ${formatCLP(scoreResult.maxLoanAmount)})`,
    });

    // Si no aprueba (Tier 4 = None), retornar sin mint ni payout
    if (scoreResult.tier === 4) {
      return NextResponse.json({
        found: true,
        approved: false,
        merchant: {
          id: oracleData.merchant.id,
          name: oracleData.merchant.name,
          rut: oracleData.merchant.rut,
        },
        scoring: {
          score: scoreResult.totalScore,
          tier: scoreResult.tier,
          badgeType: scoreResult.badgeType,
          breakdown: scoreResult.breakdown,
          capability: "INSUFFICIENT",
        },
        stats: {
          totalVolumeUSD: stats.totalVolumeUSD,
          avgPerMonthUSD: stats.avgPerMonth,
          transactionCount: stats.transactionCount,
        },
        steps,
        elapsedMs: Date.now() - startTime,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Mint SBT (Credit Badge) en Soroban
    // ═══════════════════════════════════════════════════════════════════════════
    let mintResult: { hash?: string; status?: string; mintedTo?: string; error?: string } = {};

    const adminSecret = process.env.ADMIN_SECRET?.trim();
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
    const networkPassphrase = process.env.NETWORK_PASSPHRASE?.trim();
    const rpcUrl = process.env.RPC_URL?.trim();

    if (adminSecret && contractId && networkPassphrase && rpcUrl) {
      try {
        const server = new rpc.Server(rpcUrl);
        const adminKey = Keypair.fromSecret(adminSecret);
        const adminAccount = await server.getAccount(adminKey.publicKey());

        // Generar keypair para el usuario destino (demo: determinístico o aleatorio)
        const userKey = userAddress ? Keypair.fromPublicKey(userAddress) : Keypair.random();

        const rutClean = rut.replace(/[^0-9kK]/g, "").toUpperCase();
        const dataHash = createHmac("sha256", adminSecret).update(rutClean).digest();

        const args = [
          nativeToScVal(userKey.publicKey(), { type: "address" }),
          nativeToScVal(scoreResult.tier, { type: "u32" }),
          nativeToScVal(scoreResult.totalScore, { type: "u32" }),
          xdr.ScVal.scvBytes(dataHash),
        ];

        const tx = new TransactionBuilder(adminAccount, { fee: "100000" })
          .addOperation(new Contract(contractId).call("mint_badge", ...args))
          .setTimeout(30)
          .setNetworkPassphrase(networkPassphrase)
          .build();

        const preparedTx = await server.prepareTransaction(tx);
        preparedTx.sign(adminKey);
        const sendResponse = await server.sendTransaction(preparedTx);

        mintResult = {
          hash: sendResponse.hash,
          status: sendResponse.status,
          mintedTo: userKey.publicKey(),
        };

        steps.push({
          step: "3_mint_sbt",
          status: "ok",
          detail: `SBT minteado → ${userKey.publicKey().slice(0, 10)}... (tx: ${sendResponse.hash?.slice(0, 12)}...)`,
        });
      } catch (mintErr: any) {
        mintResult = { error: mintErr.message };
        steps.push({
          step: "3_mint_sbt",
          status: "error",
          detail: mintErr.message,
        });
      }
    } else {
      // Sin credenciales Soroban → simular mint exitoso para demo
      mintResult = {
        hash: "simulated_" + Date.now().toString(16),
        status: "SIMULATED",
        mintedTo: userAddress || "G_SIMULATED_DEMO_ADDRESS",
      };
      steps.push({
        step: "3_mint_sbt",
        status: "simulated",
        detail: "Mint simulado (sin credenciales Soroban en env)",
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Payku Payout — Dispersar fondos fiat al comercio
    // ═══════════════════════════════════════════════════════════════════════════
    // Solo dispersar si el mint fue exitoso (real o simulado)
    const mintSuccess = mintResult.status === "PENDING" || mintResult.status === "SIMULATED";

    let payoutResult = null;
    if (mintSuccess && scoreResult.maxLoanAmount > 0) {
      try {
        payoutResult = await createPayout({
          merchantId: oracleData.merchant.id,
          amountCLP: scoreResult.maxLoanAmount,
          bankAccount: "123456789",      // Demo: cuenta ficticia
          bankCode: "001",                // Demo: Banco de Chile
          rut: oracleData.merchant.rut,
          reference: `VIGENTE-${scoreResult.badgeType}-${Date.now()}`,
          description: `Crédito Vigente Protocol - Tier ${scoreResult.badgeType}`,
        });

        steps.push({
          step: "4_payku_payout",
          status: payoutResult.success ? "ok" : "failed",
          detail: payoutResult.success
            ? `Payout ${formatCLP(payoutResult.netAmountCLP)} → ${oracleData.merchant.rut} (${payoutResult.payoutId})`
            : "Payout rechazado",
        });
      } catch (payoutErr: any) {
        steps.push({
          step: "4_payku_payout",
          status: "error",
          detail: payoutErr.message,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RESPONSE: Resultado consolidado
    // ═══════════════════════════════════════════════════════════════════════════
    return NextResponse.json({
      found: true,
      approved: true,
      merchant: {
        id: oracleData.merchant.id,
        name: oracleData.merchant.name,
        rut: oracleData.merchant.rut,
        kycLevel: oracleData.merchant.kycLevel,
      },
      scoring: {
        score: scoreResult.totalScore,
        tier: scoreResult.tier,
        badgeType: scoreResult.badgeType,
        maxLoanAmount: scoreResult.maxLoanAmount,
        maxLoanAmountFormatted: formatCLP(scoreResult.maxLoanAmount),
        breakdown: scoreResult.breakdown,
        capability:
          scoreResult.tier === 1 ? "EXCELLENT" :
          scoreResult.tier === 2 ? "GOOD" :
          "FAIR",
      },
      stats: {
        totalVolumeUSD: stats.totalVolumeUSD,
        avgPerMonthUSD: stats.avgPerMonth,
        transactionCount: stats.transactionCount,
        historyMonths: Number((stats.oldestTransactionDays / 30).toFixed(1)),
      },
      mint: mintResult,
      payout: payoutResult,
      steps,
      elapsedMs: Date.now() - startTime,
    });

  } catch (error: unknown) {
    // G.2: drop steps/message/elapsedMs from the public error body — those
    // leak partial-execution state and internal pipeline structure. The
    // server log keeps everything; the client only sees a generic 500.
    return genericErrorResponse("evaluate-and-fund", error, 500);
  }
}