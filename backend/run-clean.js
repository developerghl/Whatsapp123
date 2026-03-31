require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function cleanDBNow() {
  try {
    console.log('🧹 Starting Instant Database Auto-Clean...');
    const supabaseTracker = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    const date24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const date15DaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    
    // 1. Delete abandoned QR scans
    console.log(`🗑️ Deleting abandoned QR ghosts (NULL numbers) older than ${date24hAgo}...`);
    const { count: count1, error: err1 } = await supabaseTracker.from('sessions')
      .delete({ count: 'exact' })
      .eq('status', 'disconnected')
      .is('phone_number', null)
      .lt('created_at', date24hAgo);
      
    if (err1) throw err1;
    console.log(`✅ Deleted abandoned sessions: ${count1 || 0} rows`);

    // 2. Delete disconnected sessions older than 15 days (aligns with daily reminder window)
    console.log(`🗑️ Deleting disconnected sessions older than ${date15DaysAgo}...`);
    const { count: count2, error: err2 } = await supabaseTracker.from('sessions')
      .delete({ count: 'exact' })
      .eq('status', 'disconnected')
      .lt('created_at', date15DaysAgo);
      
    if (err2) throw err2;
    console.log(`✅ Deleted 15-day-old disconnected sessions: ${count2 || 0} rows`);

    console.log('🎉 Database Cleanup Complete!');
    process.exit(0);
  } catch(e) {
    console.error('❌ Error cleaning DB:', e.message);
    process.exit(1);
  }
}

cleanDBNow();
