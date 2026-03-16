const { ok, error } = require('../../utils/response');
const { getServicios, getSedes, getRoles } = require('./catalogos.queries');

async function listarServicios(req, res) {
  try {
    const rows = await getServicios();
    return ok(res, rows);
  } catch (err) {
    console.error('catalogos.listarServicios:', err);
    return error(res, 500, 'Error al obtener servicios');
  }
}

async function listarSedes(req, res) {
  try {
    const rows = await getSedes();
    return ok(res, rows);
  } catch (err) {
    console.error('catalogos.listarSedes:', err);
    return error(res, 500, 'Error al obtener sedes');
  }
}

async function listarRoles(req, res) {
  try {
    const rows = await getRoles();
    return ok(res, rows);
  } catch (err) {
    console.error('catalogos.listarRoles:', err);
    return error(res, 500, 'Error al obtener roles');
  }
}

module.exports = { listarServicios, listarSedes, listarRoles };
