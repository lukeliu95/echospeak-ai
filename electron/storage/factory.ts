// Storage factory — Main process picks an adapter by config. Default: LocalAdapter.
//
// To switch to Supabase: set backend='supabase' and supply { url, key } (from
// Settings → 数据后端, or env SUPABASE_URL / SUPABASE_KEY). The Supabase adapter is
// fully implemented but not yet tested against a live project.

import type { StorageAdapter } from './types';
import { LocalAdapter } from './localAdapter';
import { SupabaseAdapter } from './supabaseAdapter';

export type BackendName = 'local' | 'supabase';

export interface StorageFactoryOptions {
  backend?: BackendName; // default 'local'
  dataDir: string; // Electron userData dir (or a temp dir in tests)
  supabase?: { url: string; key: string };
}

export async function createStorage(opts: StorageFactoryOptions): Promise<StorageAdapter> {
  const backend = opts.backend ?? 'local';
  let adapter: StorageAdapter;
  if (backend === 'supabase') {
    adapter = new SupabaseAdapter(opts.supabase);
  } else {
    adapter = new LocalAdapter(opts.dataDir);
  }
  await adapter.init();
  return adapter;
}
