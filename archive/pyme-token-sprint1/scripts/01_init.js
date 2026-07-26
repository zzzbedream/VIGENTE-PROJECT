require('dotenv').config({ path: '../.env' }); // Busca el .env en la carpeta de atrás
const { Keypair, Contract, SorobanRpc, TransactionBuilder, Networks, nativeToScVal } = require('@stellar/stellar-sdk');

async function main() {
    try {
        const contractId = process.env.CONTRACT_ID;
        const secret = process.env.ADMIN_SECRET;
        
        if (!secret || !contractId) {
            throw new Error("❌ Faltan datos en el archivo .env");
        }

        const server = new SorobanRpc.Server(process.env.RPC_URL);
        const adminKeys = Keypair.fromSecret(secret);
        const account = await server.getAccount(adminKeys.publicKey());
        const contract = new Contract(contractId);

        console.log(`🔑 Admin: ${adminKeys.publicKey()}`);
        console.log("⏳ Enviando inicialización...");

        const tx = new TransactionBuilder(account, { fee: "100000" })
            .addOperation(contract.call("init", nativeToScVal(adminKeys.publicKey(), { type: 'address' })))
            .setTimeout(30)
            .setNetworkPassphrase(Networks.TESTNET)
            .build();

        tx.sign(adminKeys);
        const sendResponse = await server.sendTransaction(tx);

        if (sendResponse.status !== "PENDING") {
            console.error("❌ Falló el envío inicial:", sendResponse);
            return;
        }

        let statusResponse = await server.getTransaction(sendResponse.hash);
        while (statusResponse.status === "NOT_FOUND") {
            await new Promise(r => setTimeout(r, 1000));
            statusResponse = await server.getTransaction(sendResponse.hash);
        }

        if (statusResponse.status === "SUCCESS") {
            console.log("✅ Contrato Inicializado Correctamente!");
        } else {
            console.log("⚠️ El contrato probablemente ya estaba inicializado (Esto es normal).");
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
}
main();