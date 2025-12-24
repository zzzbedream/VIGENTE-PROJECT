require('dotenv').config({ path: '../.env' });
// Actualizado para usar 'rpc' (nueva versi?n SDK)
const { Keypair, Contract, rpc, TransactionBuilder, Networks, nativeToScVal } = require('@stellar/stellar-sdk');

async function main() {
    const server = new rpc.Server(process.env.RPC_URL);
    const adminKeys = Keypair.fromSecret(process.env.ADMIN_SECRET);
    const contract = new Contract(process.env.CONTRACT_ID);
    const rutEjemplo = "78.043.412-0"; 

    console.log(`?? Iniciando Flujo de Negocio en contrato: ${process.env.CONTRACT_ID}`);

    try {
        const account = await server.getAccount(adminKeys.publicKey());

        // --- PASO 1: Verificar Pyme (verify_pyme) ---
        console.log(`\n1??  Verificando Pyme RUT: ${rutEjemplo}...`);
        
        const tx1 = new TransactionBuilder(account, { fee: "100000" })
            .addOperation(contract.call("verify_pyme", 
                nativeToScVal(rutEjemplo, {type: 'string'}), 
                nativeToScVal("APROBADO", {type: 'string'})
            ))
            .setTimeout(30)
            .setNetworkPassphrase(Networks.TESTNET)
            .build();
        
        tx1.sign(adminKeys);
        let resp1 = await server.sendTransaction(tx1);
        
        if (resp1.status !== "PENDING") {
            console.error("? Fall? verificaci?n:", resp1);
            return;
        }
        await waitForTransaction(server, resp1.hash);
        console.log("? Pyme verificada exitosamente.");

        // --- PASO 2: Crear Financiamiento (mint_deal) ---
        // Refrescamos la cuenta para obtener el nuevo n?mero de secuencia
        const account2 = await server.getAccount(adminKeys.publicKey());

        console.log(`\n2??  Creando Deal de $5.000.000 CLP...`);
        const tx2 = new TransactionBuilder(account2, { fee: "100000" })
            .addOperation(contract.call("mint_deal", 
                nativeToScVal(rutEjemplo, {type: 'string'}),
                nativeToScVal(5000000, {type: 'i128'}) // Monto
            ))
            .setTimeout(30)
            .setNetworkPassphrase(Networks.TESTNET)
            .build();

        tx2.sign(adminKeys);
        let resp2 = await server.sendTransaction(tx2);
        
        if (resp2.status !== "PENDING") {
            console.error("? Fall? creaci?n de Deal:", resp2);
            return;
        }

        console.log(`? Esperando confirmaci?n de Deal...`);
        let result = await waitForTransaction(server, resp2.hash);
        
        if (result === "SUCCESS") {
            console.log("?? ?SISTEMA FUNCIONANDO! Deal creado y registrado en Blockchain.");
            console.log(`?? Hash: ${resp2.hash}`);
        }

    } catch (e) {
        console.error("? Error en el flujo:", e.message);
    }
}

async function waitForTransaction(server, hash) {
    let status;
    process.stdout.write("? Procesando");
    do {
        process.stdout.write(".");
        await new Promise(r => setTimeout(r, 2000));
        let tx = await server.getTransaction(hash);
        status = tx.status;
        if (status === "FAILED") {
            console.error("\n?? Transacci?n fall? en la red.");
            throw new Error(JSON.stringify(tx));
        }
    } while (status === "NOT_FOUND" || status === "PENDING");
    console.log(" OK");
    return status;
}

main();
