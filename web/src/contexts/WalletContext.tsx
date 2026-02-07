'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
    isConnected as freighterIsConnected,
    isAllowed as freighterIsAllowed,
    setAllowed as freighterSetAllowed,
    getAddress,
    getNetwork,
} from '@stellar/freighter-api';

interface WalletContextType {
    isConnected: boolean;
    publicKey: string | null;
    network: string | null;
    connect: () => Promise<void>;
    disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
    const [isConnected, setIsConnected] = useState(false);
    const [publicKey, setPublicKey] = useState<string | null>(null);
    const [network, setNetwork] = useState<string | null>(null);

    // Check if wallet is already connected on mount
    useEffect(() => {
        checkConnection();
    }, []);

    const checkConnection = async () => {
        try {
            console.log('🔍 WALLET DEBUG: Checking existing connection...');
            const allowedResult = await freighterIsAllowed();
            console.log('🔍 WALLET DEBUG: isAllowed result:', allowedResult);

            if (allowedResult.error || !allowedResult.isAllowed) {
                console.log('ℹ️ WALLET DEBUG: Not previously allowed');
                return;
            }

            const addressResult = await getAddress();
            console.log('🔍 WALLET DEBUG: Auto-reconnect getAddress result:', addressResult);

            if (addressResult && addressResult.address && !addressResult.error) {
                setPublicKey(addressResult.address);
                setIsConnected(true);
                console.log('✅ WALLET DEBUG: Auto-reconnected! PublicKey:', addressResult.address);

                const networkResult = await getNetwork();
                if (networkResult && !networkResult.error) {
                    setNetwork(networkResult.network);
                }
            }
        } catch (error) {
            console.error('❌ WALLET DEBUG: Error checking wallet connection:', error);
        }
    };

    const connect = async () => {
        try {
            console.log('🔌 WALLET DEBUG: Starting connection...');

            await freighterSetAllowed();
            console.log('✅ WALLET DEBUG: freighterSetAllowed() succeeded');

            const addressResult = await getAddress();
            console.log('📍 WALLET DEBUG: getAddress() result:', addressResult);

            if (!addressResult || !addressResult.address || addressResult.error) {
                console.error('❌ WALLET DEBUG: Address result failed:', addressResult);
                throw new Error(addressResult.error || 'Failed to get address');
            }

            const networkResult = await getNetwork();
            console.log('🌐 WALLET DEBUG: getNetwork() result:', networkResult);

            if (networkResult && !networkResult.error) {
                setNetwork(networkResult.network);

                if (networkResult.network !== 'TESTNET') {
                    console.warn('⚠️ Please switch to TESTNET in Freighter');
                }
            }

            setPublicKey(addressResult.address);
            setIsConnected(true);
            console.log('✅ WALLET DEBUG: Connection successful! PublicKey:', addressResult.address);
        } catch (error) {
            console.error('❌ WALLET DEBUG: Connection failed with error:', error);
            throw error;
        }
    };

    const disconnect = () => {
        setIsConnected(false);
        setPublicKey(null);
        setNetwork(null);
    };

    return (
        <WalletContext.Provider value={{ isConnected, publicKey, network, connect, disconnect }}>
            {children}
        </WalletContext.Provider>
    );
}

export function useWallet() {
    const context = useContext(WalletContext);
    if (context === undefined) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
}
