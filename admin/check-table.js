const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('admin_users').select('*').limit(1);
  if (error) {
    if (error.code === '42P01' || error.message.includes('relation "public.admin_users" does not exist')) {
      console.log('TABLE_MISSING');
    } else {
      console.error('ERROR:', error);
    }
  } else {
    console.log('TABLE_EXISTS', data);
  }
}
check();
