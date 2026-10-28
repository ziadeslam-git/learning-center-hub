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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'AUTHENTICATION_REQUIRED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL');
  if (!supabaseUrl || !serviceRoleKey || !appUrl) {
    return json(500, { error: 'FUNCTION_CONFIGURATION_MISSING' });
  }

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
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
    const role = payload.role;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 160) {
      return json(400, { error: 'INVALID_USER_DETAILS' });
    }
    if (role !== 'teacher' && role !== 'principal') {
      return json(400, { error: 'INVALID_ROLE' });
    }

    const appOrigin = new URL(appUrl).origin;
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      // Invitees have no password yet; the app's set-password page needs the
      // session that the invite link establishes.
      redirectTo: `${appOrigin}/reset-password`,
    });
    if (inviteError) throw inviteError;
    if (!invited.user) throw new Error('INVITED_USER_MISSING');

    const { error: updateError } = await adminClient
      .from('profiles')
      .update({ full_name: fullName, role, is_active: false })
      .eq('id', invited.user.id);
    if (updateError) throw updateError;

    return json(200, { id: invited.user.id, email: invited.user.email, active: false });
  } catch (error) {
    console.error('admin-invite-user failed');
    const message = error instanceof Error ? error.message : 'INVITATION_FAILED';
    if (message.toLowerCase().includes('already')) return json(409, { error: 'USER_ALREADY_EXISTS' });
    return json(500, { error: 'INVITATION_FAILED' });
  }
});
