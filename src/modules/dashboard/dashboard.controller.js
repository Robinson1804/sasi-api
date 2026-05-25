const { ok, error } = require('../../utils/response');
const { getKPIs, getServiciosStats, getAlertasSLA, getBandejaResumen } = require('./dashboard.queries');

async function kpis(req, res) {
  try {
    const data = await getKPIs();
    return ok(res, data);
  } catch (err) {
    console.error('dashboard.kpis:', err.message);
    return error(res, 500, 'Error al obtener KPIs');
  }
}

async function serviciosStats(req, res) {
  try {
    const data = await getServiciosStats();
    return ok(res, data);
  } catch (err) {
    console.error('dashboard.serviciosStats:', err.message);
    return error(res, 500, 'Error al obtener estadísticas de servicios');
  }
}

async function alertasSla(req, res) {
  try {
    const data = await getAlertasSLA();
    return ok(res, data);
  } catch (err) {
    console.error('dashboard.alertasSla:', err.message);
    return error(res, 500, 'Error al obtener alertas SLA');
  }
}

async function bandejaResumen(req, res) {
  try {
    const data = await getBandejaResumen()
    return ok(res, data)
  } catch (err) {
    console.error('dashboard.bandejaResumen:', err.message)
    return error(res, 500, 'Error al obtener resumen de bandeja')
  }
}

module.exports = { kpis, serviciosStats, alertasSla, bandejaResumen, };
