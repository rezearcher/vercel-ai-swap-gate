// Minimal ambient declarations for offline typechecking only.
// At real build time the installed `ai`, `zod`, `@x402/*` and `viem` packages
// provide the authoritative types; this file is excluded from the npm build
// (it is referenced solely by tsconfig.check.json).

declare module "ai" {
  export interface Tool {
    description?: string;
    inputSchema?: unknown;
    execute?: (args: any) => Promise<unknown> | unknown;
    [k: string]: unknown;
  }
  export function tool<T extends Tool>(t: T): T;
}

declare module "zod" {
  interface ZodType {
    describe(description: string): this;
    default(value: unknown): this;
    optional(): this;
    positive(): this;
    min(n: number): this;
    max(n: number): this;
  }
  interface ZodString extends ZodType {}
  interface ZodNumber extends ZodType {}
  interface ZodEnum extends ZodType {}
  interface ZodObject extends ZodType {}
  export const z: {
    object(shape: Record<string, ZodType>): ZodObject;
    string(): ZodString;
    number(): ZodNumber;
    enum(values: readonly string[]): ZodEnum;
  };
}

// `process` is provided by @types/node at real build time; this minimal shim
// only satisfies the offline typecheck (no node_modules installed).
declare const process: { env?: Record<string, string | undefined> } | undefined;

declare module "@x402/fetch" {
  export function wrapFetchWithPayment(f: typeof fetch, client: unknown): typeof fetch;
}
declare module "@x402/core/client" {
  export class x402Client {}
}
declare module "@x402/evm/exact/client" {
  export function registerExactEvmScheme(client: unknown, opts: { signer: unknown }): void;
}
declare module "viem/accounts" {
  export function privateKeyToAccount(key: `0x${string}`): unknown;
}
