import { createClient } from '@supabase/supabase-js';

const clientEnv = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (process.env as Record<string, string | undefined>);
const configuredSupabaseUrl = clientEnv.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = clientEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

function resolveSupabaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    // Supabase Dashboard project links are sometimes pasted instead of the
    // project's API URL. Convert only the canonical dashboard project URL.
    if (url.hostname === 'supabase.com' && url.pathname.startsWith('/dashboard/project/')) {
      const projectRef = url.pathname.split('/')[3];
      if (projectRef && /^[a-z0-9-]+$/.test(projectRef)) {
        return `https://${projectRef}.supabase.co`;
      }
    }

    if (url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) {
      return url.origin;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

const supabaseUrl = resolveSupabaseUrl(configuredSupabaseUrl);
const hasPublishableKey = Boolean(
  supabasePublishableKey &&
    (supabasePublishableKey.startsWith('sb_publishable_') || supabasePublishableKey.startsWith('eyJ')),
);

export const isSupabaseConfigured = Boolean(supabaseUrl && hasPublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('SUPABASE_CONFIGURATION_MISSING');
  }
  return supabase;
}

export function logSupabaseDiagnostic(operation: string, error: unknown) {
  if (typeof import.meta !== 'undefined' && import.meta.env && !import.meta.env.DEV) return;
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown } | null;
  console.error('[supabase]', {
    operation,
    code: typeof candidate?.code === 'string' ? candidate.code : undefined,
    status: typeof candidate?.status === 'number' || typeof candidate?.status === 'string'
      ? candidate.status
      : typeof candidate?.statusCode === 'number' || typeof candidate?.statusCode === 'string'
        ? candidate.statusCode
        : undefined,
  });
}
