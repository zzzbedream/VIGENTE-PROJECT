require('dotenv').config({ path: '../.env' });
const { Keypair, Contract, rpc, TransactionBuilder, Networks, nativeToScVal } = require('@stellar/stellar-sdk');

async function main() {
    console.log("?? [PRUEBA 1] Inicializando Contrato...");
    try {
        const server = new rpc.Server(process.env.RPC_URL);
        const adminKeys = Keypair.fromSecret(process.env.ADMIN_SECRET);
        const contract = new Contract(process.env.CONTRACT_ID);
        const account = await server.getAccount(adminKeys.publicKey());

        const tx = new TransactionBuilder(account, { fee: "100000" })
            .addOperation(contract.call("init", nativeToScVal(adminKeys.publicKey(), { type: 'address' })))
            .setTimeout(30)
            .setNetworkPassphrase(Networks.TESTNET)
            .build();

        tx.sign(adminKeys);
        const sendResponse = await server.sendTransaction(tx);

        if (sendResponse.status !== "PENDING") {
            console.log("?? (Probablemente ya inicializado o error de red). Seguimos...");
            return;
        }

        let statusResponse = await server.getTransaction(sendResponse.hash);
        while (statusResponse.status === "NOT_FOUND") {
            await new Promise(r => setTimeout(r, 1000));
            statusResponse = await server.getTransaction(sendResponse.hash);
        }
        
        if (statusResponse.status === "SUCCESS") console.log("? Contrato Inicializado.");
        else console.log("?? Estado: " + statusResponse.status);

    } catch (e) { console.log("?? Nota: " + e.message); }
}
main();
