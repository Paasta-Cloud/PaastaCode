export function mountBilling(root?: Document | HTMLElement, options?: { signal?: AbortSignal; standalone?: boolean; onBalanceChange?: (balance: number) => void }): () => void;
