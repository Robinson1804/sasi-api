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
      valor: Number(r.sla_vencidos) || 0,
      label: 'SLA Vencidos',
      color: '#d97706',
      subtexto: 'Requieren atención urgente',
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

module.exports = { getKPIs, getServiciosStats, getAlertasSLA };
