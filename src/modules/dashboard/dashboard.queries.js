const { query } = require('../../config/db');

/* ---------- KPIs ---------- */
async function getKPIs() {
  const { rows } = await query('SELECT * FROM v_dashboard_kpis');
  const r = rows[0] || {};

  return [
    {
      valor: Number(r.solicitudes_activas) || 0,
      label: 'Solicitudes Activas',
      color: '#6c8aff',
      subtexto: 'En proceso actualmente',
    },
    {
      valor: Number(r.completadas_mes) || 0,
      label: 'Completadas este mes',
      color: '#059669',
      subtexto: 'Finalizadas con éxito',
    },
    {
      valor: Number(r.rechazadas_mes) || 0,
      label: 'Rechazadas este mes',
      color: '#dc2626',
      subtexto: 'Solicitudes denegadas',
    },
    {
      valor: Number(r.solicitudes_activas) || 0,
      label: 'Pendientes en Bandeja',
      color: '#d97706',
      subtexto: 'Esperan acción de un área',
    },
    {
      valor: r.tasa_aprobacion != null ? `${Number(r.tasa_aprobacion)}%` : '0%',
      label: 'Tasa de Aprobación',
      color: '#4a90d9',
      subtexto: 'Del total procesadas',
    },
    {
      valor: r.tiempo_promedio_horas != null ? `${Number(r.tiempo_promedio_horas)}h` : '0h',
      label: 'Tiempo Promedio',
      color: '#1e3a6e',
      subtexto: 'Horas por solicitud',
    },
  ];
}

/* ---------- Servicios breakdown ---------- */
async function getServiciosStats() {
  const sql = `
    SELECT sv.codigo, sv.nombre, sv.color,
      COUNT(*) FILTER (WHERE ss.estado = 'atendido')                    AS completadas,
      COUNT(*) FILTER (WHERE ss.estado IN ('pendiente','en_revision'))   AS pendientes,
      COUNT(*) FILTER (WHERE ss.estado = 'rechazado')                   AS rechazadas
    FROM solicitud_servicios ss
    JOIN servicios sv ON ss.id_servicio = sv.id
    GROUP BY sv.id
    ORDER BY sv.orden`;

  const { rows } = await query(sql);

  return rows.map((r) => ({
    codigo: r.codigo,
    nombre: r.nombre,
    color: r.color,
    completadas: Number(r.completadas),
    pendientes: Number(r.pendientes),
    rechazadas: Number(r.rechazadas),
  }));
}

/* ---------- Resumen Bandeja de Aprobación ---------- */
async function getBandejaResumen() {
  const sql = `
    WITH max_etapas AS (
      SELECT id_solicitud, MAX(orden) AS max_orden
        FROM etapas_aprobacion
       GROUP BY id_solicitud
    ),
    activas AS (
      SELECT
        CASE
          WHEN r.codigo = 'soporte_tecnico' AND ea.orden = 0 THEN 'validacion'
          WHEN r.codigo = 'soporte_tecnico' AND ea.orden = me.max_orden THEN 'cierre'
          ELSE 'revision'
        END AS categoria,
        COUNT(*) AS total
      FROM etapas_aprobacion ea
      JOIN roles r ON r.id = ea.id_rol
      JOIN max_etapas me ON me.id_solicitud = ea.id_solicitud
      WHERE ea.estado IN ('pendiente', 'en_revision')
      GROUP BY categoria
    ),
    observadas AS (
      SELECT 'observadas' AS categoria, COUNT(*) AS total
        FROM solicitudes
       WHERE estado = 'observada'
         AND id_solicitud_padre IS NULL
    )
    SELECT categoria, total FROM activas
    UNION ALL
    SELECT categoria, total FROM observadas
  `

  const { rows } = await query(sql)

  const resumen = {
    total: 0,
    validacion: 0,
    revision: 0,
    observadas: 0,
    cierre: 0,
  }

  for (const row of rows) {
    const categoria = row.categoria
    const total = Number(row.total) || 0

    if (categoria === 'validacion') resumen.validacion += total
    if (categoria === 'revision') resumen.revision += total
    if (categoria === 'observadas') resumen.observadas += total
    if (categoria === 'cierre') resumen.cierre += total
  }

  resumen.total =
    resumen.validacion +
    resumen.revision +
    resumen.observadas +
    resumen.cierre

  return resumen
}


/* ---------- Alertas SLA ---------- */
async function getAlertasSLA() {
  const sql = `
    SELECT solicitud_id, numero, solicitante, servicios_codigos, sede,
           horas_restantes_sla, sla_horas, vencio_sla
    FROM v_bandeja_aprobacion
    WHERE horas_restantes_sla <= 12 OR vencio_sla = true
    ORDER BY horas_restantes_sla ASC`;

  const { rows } = await query(sql);

  return rows.map((r) => {
    const horas = Number(r.horas_restantes_sla);
    let prioridad = 'ok';
    if (horas <= 4) prioridad = 'critica';
    else if (horas <= 12) prioridad = 'alerta';

    return {
      id: r.solicitud_id,
      numero: r.numero,
      solicitante: r.solicitante,
      servicios: Array.isArray(r.servicios_codigos)
        ? r.servicios_codigos.join(', ')
        : String(r.servicios_codigos || ''),
      sede: r.sede,
      horasRestantes: horas,
      slaHoras: Number(r.sla_horas),
      prioridad,
    };
  });
}

module.exports = { getKPIs, getServiciosStats, getAlertasSLA, getBandejaResumen };
