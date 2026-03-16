const { query } = require('../src/config/db');

async function main() {
  // 1. Delete bad record and its dependencies
  await query('DELETE FROM historial WHERE id_solicitud = 5');
  await query('DELETE FROM solicitud_servicios WHERE id_solicitud = 5');
  await query('DELETE FROM solicitudes WHERE id = 5');
  console.log('Deleted bad record id=5');

  // 2. Drop and recreate
  await query('DROP FUNCTION IF EXISTS generar_numero_solicitud()');
  const sql = `
    CREATE OR REPLACE FUNCTION generar_numero_solicitud()
    RETURNS TEXT AS $$
    DECLARE
        anio TEXT;
        seq INT;
    BEGIN
        anio := EXTRACT(YEAR FROM NOW())::TEXT;
        SELECT COALESCE(MAX(
            CAST(REGEXP_REPLACE(numero, '^SASI-[0-9]{4}-', '') AS INT)
        ), 0) + 1
        INTO seq
        FROM solicitudes
        WHERE numero ~ ('^SASI-' || anio || '-[0-9]+$');

        RETURN 'SASI-' || anio || '-' || LPAD(seq::TEXT, 6, '0');
    END;
    $$ LANGUAGE plpgsql;
  `;
  await query(sql);
  console.log('Function updated');

  // 3. Test
  const t = await query('SELECT generar_numero_solicitud() AS n');
  console.log('Test generate:', t.rows[0].n);

  process.exit();
}

main().catch(e => { console.error(e); process.exit(1); });
