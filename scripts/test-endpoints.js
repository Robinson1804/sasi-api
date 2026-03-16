const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3001, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function log(label, r) {
  const icon = r.status >= 200 && r.status < 300 ? 'OK' : r.status === 403 ? 'FORBIDDEN' : 'FAIL';
  console.log(`  [${r.status} ${icon}] ${label}`, JSON.stringify(r.body).substring(0, 200));
}

async function test() {
  // ==================== SOLICITANTE (DNI 12345678) ====================
  console.log('========== SOLICITANTE (12345678) ==========');
  const loginSol = await request('POST', '/api/auth/login', { dni: '12345678', password: 'sasi2026' });
  if (loginSol.status !== 200 || !loginSol.body.token) {
    console.log('LOGIN SOLICITANTE FAILED:', loginSol.status, JSON.stringify(loginSol.body));
    return;
  }
  const tSol = loginSol.body.token;
  console.log('  Login OK - rol:', loginSol.body.rol);

  log('GET /api/catalogos/servicios', await request('GET', '/api/catalogos/servicios', null, tSol));
  log('GET /api/catalogos/sedes', await request('GET', '/api/catalogos/sedes', null, tSol));
  log('GET /api/solicitudes', await request('GET', '/api/solicitudes', null, tSol));
  log('GET /api/solicitudes/1', await request('GET', '/api/solicitudes/1', null, tSol));

  // Crear solicitud
  log('POST /api/solicitudes (crear)', await request('POST', '/api/solicitudes', {
    tipo: 'individual',
    servicios: [{ codigoServicio: 'c1', datos: { tipo_cuenta: 'nueva', requiere_internet: true, requiere_correo: false } }]
  }, tSol));

  // Documentos
  log('POST /api/documentos/generar-pdf', await request('POST', '/api/documentos/generar-pdf', { solicitudId: 1 }, tSol));

  // ==================== ADMIN (DNI 99999999) ====================
  console.log('\n========== ADMIN (99999999) ==========');
  const loginAdmin = await request('POST', '/api/auth/login', { dni: '99999999', password: 'sasi2026' });
  if (loginAdmin.status !== 200 || !loginAdmin.body.token) {
    console.log('LOGIN ADMIN FAILED:', loginAdmin.status, JSON.stringify(loginAdmin.body));
    return;
  }
  const tAdmin = loginAdmin.body.token;
  console.log('  Login OK - roles:', loginAdmin.body.roles);

  log('GET /api/dashboard/kpis', await request('GET', '/api/dashboard/kpis', null, tAdmin));
  log('GET /api/dashboard/servicios', await request('GET', '/api/dashboard/servicios', null, tAdmin));
  log('GET /api/dashboard/alertas-sla', await request('GET', '/api/dashboard/alertas-sla', null, tAdmin));
  log('GET /api/personal', await request('GET', '/api/personal', null, tAdmin));
  log('GET /api/solicitudes (admin)', await request('GET', '/api/solicitudes', null, tAdmin));

  // ==================== SEGURIDAD (DNI 88888888) ====================
  console.log('\n========== SEGURIDAD (88888888) ==========');
  const loginSeg = await request('POST', '/api/auth/login', { dni: '88888888', password: 'sasi2026' });
  if (loginSeg.status !== 200 || !loginSeg.body.token) {
    console.log('LOGIN SEGURIDAD FAILED:', loginSeg.status, JSON.stringify(loginSeg.body));
    return;
  }
  const tSeg = loginSeg.body.token;
  console.log('  Login OK - roles:', loginSeg.body.roles);

  log('GET /api/bandeja', await request('GET', '/api/bandeja', null, tSeg));

  console.log('\n========== DONE ==========');
}

test().catch(e => console.error('FATAL:', e));
