const { query } = require('./src/config/db');
async function run() {
  await query("ALTER TABLE solicitud_servicios ADD COLUMN IF NOT EXISTS datos_atencion JSONB DEFAULT '{}'::jsonb");
  console.log('OK: datos_atencion column added');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
