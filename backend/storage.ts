import type { Store, Chunk } from "./store.js";
type AsyncCompatible<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : never;
};
export type Storage = AsyncCompatible<
  Pick<
    Store,
    | "owner"
    | "createOwner"
    | "cleanup"
    | "list"
    | "add"
    | "file"
    | "remove"
    | "nextJob"
    | "mark"
    | "saveChunks"
    | "chunks"
    | "record"
    | "close"
    | "health"
  >
> & {
  claimJob?(
    owner: string,
  ): Promise<
    { id: string; name: string; bytes: Buffer; lease: string } | undefined
  >;
  finishJob?(
    id: string,
    lease: string,
    result:
      | {
          pages: number;
          chunks: Array<{ page: number; text: string }>;
          vectors: number[][] | null;
          model: string | null;
          warning: string | null;
        }
      | { error: string },
  ): Promise<void>;
  consume?(key: string, limit: number, windowMs: number): Promise<boolean>;
  acquire?(key: string, ttlMs: number): Promise<string | null>;
  release?(key: string, token: string): Promise<void>;
  search?(
    owner: string,
    ids: string[] | undefined,
    query: string,
    vector: number[] | null,
    model: string,
  ): Promise<Chunk[]>;
};
