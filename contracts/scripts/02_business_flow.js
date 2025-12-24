require('dotenv').config({ path: '../.env' });
const { Keypair, Contract, rpc, TransactionBuilder, Networks, nativeToScVal } = require('@stellar/stellar-sdk');

async function main() {
    console.log("\n?? [PRUEBA 2] Flujo de Negocio...");
    const server = new rpc.Server(process.env.RPC_URL);
    const adminKeys = Keypair.fromSecret(process.env.ADMIN_SECRET);
    const contract = new Contract(process.env.CONTRACT_ID);
    const rutEjemplo = "78.043.412-0"; 

    try {
        const account = await server.getAccount(adminKeys.publicKey());
        
        // 1. Verificar
        process.stdout.write("   Verificando Pyme... ");
        const tx1 = new TransactionBuilder(account, { fee: "100000" })
            .addOperation(contract.call("verify_pyme", nativeToScVal(rutEjemplo, {type: 'string'}), nativeToScVal("APROBADO", {type: 'string'})))
            .setTimeout(30).setNetworkPassphrase(Networks.TESTNET).build();
        tx1.sign(adminKeys);
        let r1 = await server.sendTransaction(tx1);
        if(r1.status === "PENDING") await waitForTransaction(server, r1.hash);
        console.log("? HECHO");

        // 2. Mint Deal
        process.stdout.write("   Creando Deal... ");
        const account2 = await server.getAccount(adminKeys.publicKey());
        const tx2 = new TransactionBuilder(account2, { fee: "100000" })
            .addOperation(contract.call("mint_deal", nativeToScVal(rutEjemplo, {type: 'string'}), nativeToScVal(5000000, {type: 'i128'})))
            .setTimeout(30).setNetworkPassphrase(Networks.TESTNET).build();
        tx2.sign(adminKeys);
        let r2 = await server.sendTransaction(tx2);
        
        if(r2.status === "PENDING") {
            let final = await waitForTransaction(server, r2.hash);
            if(final === "SUCCESS") {
                console.log("? HECHO");
                console.log("\n?? ?SISTEMA FUNCIONANDO! Deal creado y registrado en Blockchain.");
            }
        } else {
            console.log("? Error al enviar Deal: ", r2);
        }

    } catch (e) { console.error("\n? Error:", e.message); }
}

async function waitForTransaction(server, hash) {
    let status;
    do {
        await new Promise(r => setTimeout(r, 1500));
        let tx = await server.getTransaction(hash);
        status = tx.status;
    } while (status === "NOT_FOUND" || status === "PENDING");
    return status;
}

main();
