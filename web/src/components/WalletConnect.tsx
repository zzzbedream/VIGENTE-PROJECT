'use client';

import { useEffect, useState } from 'react';
import { isConnected as freighterIsConnected } from '@stellar/freighter-api';
import { useWallet } from '../contexts/WalletContext';

export default function WalletConnect() {
    const { isConnected, publicKey, connect, disconnect } = useWallet();
    const [isLoading, setIsLoading] = useState(false);
    const [freighterInstalled, setFreighterInstalled] = useState(true);

    useEffect(() => {
        checkFreighterInstallation();
    }, []);

    const checkFreighterInstallation = async () => {
        try {
            // Use Freighter API to check if installed
            const result = await freighterIsConnected();

            // If we get a valid response (even if not connected), Freighter is installed
            if (result && !result.error) {
                setFreighterInstalled(true);
            } else if (result && result.error) {
                // If there's an error, Freighter might not be installed
                setFreighterInstalled(false);
            }
        } catch (error) {
            console.error('Error checking Freighter:', error);
            // Assume installed to avoid false negatives
            setFreighterInstalled(true);
        }
    };

    const handleConnect = async () => {
        setIsLoading(true);
        try {
            await connect();
        } catch (error: any) {
            console.error('Failed to connect wallet:', error);
            alert('Failed to connect wallet. Please make sure Freighter is installed and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const truncateAddress = (address: string): string => {
        if (address.length <= 10) return address;
        return `${address.slice(0, 4)}...${address.slice(-4)}`;
    };

    // If Freighter is not installed
    if (!freighterInstalled) {
        return (
            <a
                href="https://www.freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
            >
                Install Freighter
            </a>
        );
    }

    // If loading
    if (isLoading) {
        return (
            <button
                disabled
                className="px-4 py-2 bg-cyan-600/50 text-white font-medium rounded-lg cursor-not-allowed flex items-center gap-2"
            >
                <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                    />
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                </svg>
                Connecting...
            </button>
        );
    }

    // If connected
    if (isConnected && publicKey) {
        return (
            <div className="flex items-center gap-2">
                <div className="px-4 py-2 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/50 text-cyan-400 font-mono font-medium rounded-lg shadow-lg backdrop-blur-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    {truncateAddress(publicKey)}
                </div>
                <button
                    onClick={() => {
                        if (confirm('¿Desconectar wallet?')) {
                            disconnect();
                        }
                    }}
                    className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-400 rounded-lg transition-all duration-200"
                    title="Disconnect Wallet"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                </button>
            </div>
        );
    }

    // Default: Not connected
    return (
        <button
            onClick={handleConnect}
            className="px-6 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-medium rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
        >
            Connect Wallet
        </button>
    );
}
