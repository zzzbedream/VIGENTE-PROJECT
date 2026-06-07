"use client";

/**
 * Stellar Wallets Kit context (Phase D — wallet integration).
 *
 * Wraps @creit-tech/stellar-wallets-kit (v2.x static API) so any client
 * component can:
 *
 *   const { address, connect, disconnect, signTransaction } = useWalletKit();
 *
 * Supports xBull (PWA + extension), Albedo, Freighter, Rabet, WalletConnect,
 * Lobstr, Hana, Hot Wallet, Klever Wallet — all through one modal.
 *
 * The kit's static `init` runs lazily on first client-side use to avoid SSR
 * and Node-crypto polyfill issues. Address persists in sessionStorage so a
 * reload doesn't push the user back through the modal.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { logger } from "@/lib/logger";

interface WalletKitContextType {
  address: string | null;
  network: string;
  connecting: boolean;
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string) => Promise<{ signedTxXdr: string } | null>;
}

const STORAGE_KEY = "vigente:wallet:address";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ||
  "Test SDF Network ; September 2015";

const WalletKitContext = createContext<WalletKitContextType | undefined>(
  undefined,
);

export function WalletKitProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const initialised = useRef(false);

  // Restore last-connected address from sessionStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (saved) setAddress(saved);
  }, []);

  const ensureKit = useCallback(async () => {
    if (typeof window === "undefined") return null;
    const [mod, utils] = await Promise.all([
      import("@creit-tech/stellar-wallets-kit"),
      import("@creit-tech/stellar-wallets-kit/modules/utils"),
    ]);
    if (!initialised.current) {
      const isMainnet = NETWORK_PASSPHRASE.includes("Public");
      mod.StellarWalletsKit.init({
        network: isMainnet ? mod.Networks.PUBLIC : mod.Networks.TESTNET,
        modules: utils.defaultModules(),
      });
      initialised.current = true;
    }
    return mod;
  }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    setConnecting(true);
    try {
      const mod = await ensureKit();
      if (!mod) return null;
      const { address: addr } = await mod.StellarWalletsKit.authModal();
      if (!addr) return null;
      setAddress(addr);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(STORAGE_KEY, addr);
      }
      return addr;
    } catch (err) {
      logger.error("wallet-kit", "connect failed:", err);
      return null;
    } finally {
      setConnecting(false);
    }
  }, [ensureKit]);

  const disconnect = useCallback(async () => {
    try {
      const mod = await ensureKit();
      if (mod) await mod.StellarWalletsKit.disconnect();
    } catch (err) {
      logger.warn("wallet-kit", "disconnect failed:", err);
    } finally {
      setAddress(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [ensureKit]);

  const signTransaction = useCallback(
    async (xdr: string) => {
      const mod = await ensureKit();
      if (!mod) return null;
      try {
        const result = await mod.StellarWalletsKit.signTransaction(xdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: address ?? undefined,
        });
        return { signedTxXdr: result.signedTxXdr };
      } catch (err) {
        logger.error("wallet-kit", "signTransaction failed:", err);
        return null;
      }
    },
    [ensureKit, address],
  );

  const value = useMemo(
    () => ({
      address,
      network: NETWORK_PASSPHRASE.includes("Public") ? "PUBLIC" : "TESTNET",
      connecting,
      connect,
      disconnect,
      signTransaction,
    }),
    [address, connecting, connect, disconnect, signTransaction],
  );

  return (
    <WalletKitContext.Provider value={value}>
      {children}
    </WalletKitContext.Provider>
  );
}

export function useWalletKit() {
  const ctx = useContext(WalletKitContext);
  if (!ctx) {
    throw new Error("useWalletKit must be used inside <WalletKitProvider>");
  }
  return ctx;
}
