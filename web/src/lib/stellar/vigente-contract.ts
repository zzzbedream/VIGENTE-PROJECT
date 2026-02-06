// Freighter wallet integration temporarily disabled for build compatibility
// TODO: Fix Freighter API imports in next deployment

export async function connectWallet(): Promise<string> {
    throw new Error("Freighter integration temporarily disabled. Use API minting instead.");
}

export async function mintCreditBadge(
    tier: number,
    score: number,
    rut: string
): Promise<string> {
    throw new Error("Freighter integration temporarily disabled. Use /api/mint instead.");
}

export async function verifyBadge(userAddress: string): Promise<any | null> {
    return null;
}

export async function isFreighterInstalled(): Promise<boolean> {
    return false;
}
