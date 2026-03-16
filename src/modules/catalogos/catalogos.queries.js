const { query } = require('../../config/db');

const SQL_SERVICIOS = `
  SELECT id, codigo, nombre, descripcion, icono, color
    FROM servicios
   WHERE activo = true
   ORDER BY orden
`;

const SQL_SEDES = `
  SELECT id, nombre
    FROM sedes
   WHERE activo = true
   ORDER BY nombre
`;

const SQL_ROLES = `
  SELECT id, codigo, nombre
    FROM roles
   WHERE activo = true
   ORDER BY nombre
`;

async function getServicios() {
  const { rows } = await query(SQL_SERVICIOS);
  return rows;
}

async function getSedes() {
  const { rows } = await query(SQL_SEDES);
  return rows;
}

async function getRoles() {
  const { rows } = await query(SQL_ROLES);
  return rows;
}

module.exports = { getServicios, getSedes, getRoles };
