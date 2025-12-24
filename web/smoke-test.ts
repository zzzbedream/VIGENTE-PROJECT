// TEST DE INTEGRACION - Smoke Test en Testnet
import {
    Keypair,
    Contract,
    rpc,
    TransactionBuilder,
    Networks,
    nativeToScVal,
    TimeoutInfinite
} from "@stellar/stellar-sdk";
import { createHmac } from "crypto";

const SECRET = "SB7G3OJIVJR2MUJT6WCGPMFJPASEF5KDBG2CMOUCLDNRLPNLSK5JCDDT";
const CONTRACT_ID = "CBBHQMIATELVVIFMRCIOQJHHSZJOGWH3PQNX7WOKGHK4FLZEWZUOMJKN";
const RPC_URL = "https://soroban-testnet.stellar.org";
const ADMIN_SECRET_FOR_HASH = "mi-secreto-para-hash";

async function main() {
    console.log("========================================");
    console.log("  SMOKE TEST - PymeToken v2.0");
    console.log("========================================\n");

    try {
        const server = new rpc.Server(RPC_URL);
        const keypair = Keypair.fromSecret(SECRET);

        console.log("Config:");
        console.log("  RPC: " + RPC_URL);
        console.log("  Contract: " + CONTRACT_ID);
        console.log("  Admin: " + keypair.publicKey() + "\n");

        console.log("Obteniendo cuenta...");
        const account = await server.getAccount(keypair.publicKey());
        console.log("  Cuenta OK. Sequence: " + account.sequenceNumber() + "\n");

        const rutPrueba = "12345678-9";
        const hash = createHmac('sha256', ADMIN_SECRET_FOR_HASH).update(rutPrueba).digest();
        console.log("Hash generado:");
        console.log("  RUT: " + rutPrueba);
        console.log("  Hash: " + hash.toString('hex').substring(0, 32) + "...\n");

        const monto = BigInt(5_000_000);
        const nonce = BigInt(Date.now());

        console.log("Construyendo tx...");
        console.log("  Funcion: mint_deal");
        console.log("  Monto: " + monto + " stroops");
        console.log("  Nonce: " + nonce + "\n");

        const tx = new TransactionBuilder(account, {
            fee: "100000",
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(
                new Contract(CONTRACT_ID).call(
                    "mint_deal",
                    nativeToScVal(hash, { type: 'bytes' }),
                    nativeToScVal(keypair.publicKey(), { type: 'address' }),
                    nativeToScVal(monto, { type: 'i128' }),
                    nativeToScVal(nonce, { type: 'i128' })
                )
            )
            .setTimeout(TimeoutInfinite)
            .build();

        console.log("Preparando tx (simulacion)...");
        const preparedTx = await server.prepareTransaction(tx);
        preparedTx.sign(keypair);
        console.log("  Tx firmada\n");

        console.log("Enviando a Testnet...");
        const response = await server.sendTransaction(preparedTx);

        if (response.status === "PENDING") {
            console.log("  Status: PENDING");
            console.log("  Hash: " + response.hash + "\n");

            console.log("Esperando confirmacion...");
            let getResponse = await server.getTransaction(response.hash);

            while (getResponse.status === "NOT_FOUND") {
                await new Promise(resolve => setTimeout(resolve, 1000));
                process.stdout.write(".");
                getResponse = await server.getTransaction(response.hash);
            }
            console.log("\n");

            if (getResponse.status === "SUCCESS") {
                console.log("========================================");
                console.log("  TRANSACCION EXITOSA!");
                console.log("========================================\n");
                console.log("Ver en Stellar Expert:");
                console.log("  https://stellar.expert/explorer/testnet/tx/" + response.hash);
            } else {
                console.error("Tx fallida: " + getResponse.status);
            }
        } else {
            console.error("Error al enviar: " + response.status);
        }

    } catch (error: any) {
        console.error("\nERROR: " + (error.message || error));
        if (error.message?.includes("Account not found")) {
            console.error("Usa Friendbot: https://friendbot.stellar.org?addr=" + Keypair.fromSecret(SECRET).publicKey());
        }
    }
}

main();
