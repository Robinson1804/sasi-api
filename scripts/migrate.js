/**
 * Railway migration script — runs schema.sql against DATABASE_URL
 * Usage: node scripts/migrate.js
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Connecting to database...');
  console.log('Running schema.sql...');

  try {
    await pool.query(sql);
    console.log('Schema applied successfully!');

    // Also apply the datos_atencion column and unified flow changes
    await pool.query(`
      ALTER TABLE etapas_aprobacion ADD COLUMN IF NOT EXISTS id_solicitud INT REFERENCES solicitudes(id);
      ALTER TABLE etapas_aprobacion ALTER COLUMN id_solicitud_servicio DROP NOT NULL;
    `);
    console.log('Migration patches applied!');

    // Recreate view for unified flow
    await pool.query(`
      CREATE OR REPLACE VIEW v_bandeja_aprobacion AS
      SELECT
        ea.id AS etapa_id,
        s.id AS solicitud_id,
        s.numero,
        s.snap_nombres AS solicitante,
        s.snap_sede AS sede,
        s.tipo,
        ea.id_rol,
        r.codigo AS rol_codigo,
        r.nombre AS rol_nombre,
        ea.estado AS etapa_estado,
        ea.fecha_inicio,
        ea.sla_horas,
        ea.horas_transcurridas,
        ea.vencio_sla,
        (SELECT ARRAY_AGG(DISTINCT sv2.codigo)
           FROM solicitud_servicios ss2
           JOIN servicios sv2 ON sv2.id = ss2.id_servicio
          WHERE ss2.id_solicitud = s.id
        ) AS servicios_codigos,
        GREATEST(0, ea.sla_horas - COALESCE(ea.horas_transcurridas,
          EXTRACT(EPOCH FROM (NOW() - ea.fecha_inicio)) / 3600
        )) AS horas_restantes_sla
      FROM etapas_aprobacion ea
      JOIN solicitudes s ON ea.id_solicitud = s.id
      JOIN roles r ON ea.id_rol = r.id
      WHERE ea.estado = 'en_revision'
      GROUP BY ea.id, s.id, r.id
    `);
    console.log('View v_bandeja_aprobacion updated for unified flow!');

  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
