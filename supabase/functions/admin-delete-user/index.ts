import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Permanently deletes an account (auth user + profile). Admin only.
// Accounts that own bookings are refused: bookings.teacher_id is ON DELETE
// RESTRICT so booking history is never lost.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'AUTHENTICATION_REQUIRED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'FUNCTION_CONFIGURATION_MISSING' });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const accessToken = authorization.slice('Bearer '.length);
    const { data: userResult, error: userError } = await adminClient.auth.getUser(accessToken);
    if (userError || !userResult.user) return json(401, { error: 'INVALID_SESSION' });

    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', userResult.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!callerProfile?.is_active || callerProfile.role !== 'admin') {
      return json(403, { error: 'ADMIN_REQUIRED' });
    }

    const payload = await request.json();
    const targetId = typeof payload.userId === 'string' ? payload.userId : '';
    if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json(400, { error: 'INVALID_USER' });
    if (targetId === userResult.user.id) return json(400, { error: 'CANNOT_DELETE_SELF' });

    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', targetId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return json(404, { error: 'USER_NOT_FOUND' });

    const { count, error: countError } = await adminClient
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', targetId);
    if (countError) throw countError;
    if ((count ?? 0) > 0) return json(409, { error: 'USER_HAS_BOOKINGS' });

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId);
    if (deleteError) throw deleteError;

    return json(200, { id: targetId, deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DELETE_FAILED';
    const code = (error as { code?: string } | null)?.code;
    const status = (error as { status?: number } | null)?.status;
    console.error('admin-delete-user failed', { message, code, status });
    return json(500, { error: 'DELETE_FAILED' });
  }
});
