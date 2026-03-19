const path = require('path');
const fs = require('fs');

// Load logo as base64 once at startup
const LOGO_PATH = path.join(__dirname, 'inei-logo.png');
const LOGO_B64 = fs.existsSync(LOGO_PATH)
  ? `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`
  : '';

/**
 * Generates an HTML document that looks like an official INEI solicitud PDF.
 * @param {object} sol - Solicitud data from obtenerDatosSolicitud()
 * @returns {string} HTML string
 */
function generarHtmlSolicitud(sol) {
  const fecha = new Date(sol.fecha_creacion).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const nombreCompleto = (sol.snap_nombres || '').trim();

  // Usuarios masivos (solo para solicitudes masivas)
  const usuariosMasivosHtml = (sol.usuarios_masivos && sol.usuarios_masivos.length > 0)
    ? (() => {
        const um = sol.usuarios_masivos;
        const perfilMap = { '1': 'Avanzado', '2': 'Intermedio', '3': 'Básico' };
        // Detect which optional columns have data
        const hasPerfilInternet = um.some(u => u.internet_perfil);
        const hasTipoCuenta = um.some(u => u.tipo_cuenta);
        const hasCorreoInst = um.some(u => u.correo_institucional);
        const hasCorreoPersonal = um.some(u => u.correo_personal);
        const hasTelefono = um.some(u => u.telefono_contacto);
        const hasHost = um.some(u => u.nombre_host);
        const th = (label) => `<td style="font-weight:600; padding:4px 6px; font-size:7.5pt;">${label}</td>`;
        const td = (val) => `<td style="padding:3px 6px; font-size:7.5pt;">${escapeHtml(val || '—')}</td>`;

        return `<div class="seccion">
        <div class="seccion-titulo">Usuarios Incluidos (${um.length})</div>
        <div class="seccion-body" style="padding:6px 8px;">
          <table class="datos-tabla" style="font-size:7.5pt;">
            <tr style="background:#1e3a6e; color:#fff;">
              ${th('N°')}${th('DNI')}${th('Apellidos y Nombres')}${th('Cargo')}
              ${hasTipoCuenta ? th('Tipo Cuenta') : ''}
              ${hasPerfilInternet ? th('Perfil Internet') : ''}
              ${hasCorreoInst ? th('Correo Inst.') : ''}
              ${hasCorreoPersonal ? th('Correo Personal') : ''}
              ${hasTelefono ? th('Teléfono') : ''}
              ${hasHost ? th('Host/Equipo') : ''}
            </tr>
            ${um.map((u, i) => `<tr${i % 2 === 1 ? ' style="background:#f7f9fc;"' : ''}>
                ${td(String(i + 1))}
                <td style="padding:3px 6px; font-size:7.5pt; font-family:monospace;">${escapeHtml(u.dni || '')}</td>
                ${td(`${u.apellidos || ''} ${u.nombres || ''}`)}
                ${td(u.cargo)}
                ${hasTipoCuenta ? td(u.tipo_cuenta === 'generica' ? 'Genérica' : 'Personal') : ''}
                ${hasPerfilInternet ? td(perfilMap[u.internet_perfil] || u.internet_perfil || '—') : ''}
                ${hasCorreoInst ? td(u.correo_institucional ? 'Sí' : 'No') : ''}
                ${hasCorreoPersonal ? td(u.correo_personal) : ''}
                ${hasTelefono ? td(u.telefono_contacto) : ''}
                ${hasHost ? td(u.nombre_host) : ''}
              </tr>`).join('')}
          </table>
        </div>
      </div>`;
      })()
    : '';

  // Fields that are per-user in masiva (shown in users table, not in service section)
  const MASIVA_PER_USER_FIELDS = [
    'correoPersonal', 'telefonoContacto', 'nombreHost',
    'internetPerfil', 'redTipoCuenta', 'redNombreGenerico',
    'correoInstitucional', 'correoCapacidad',
    'redSolicitar', 'internetSolicitar', 'correoSolicitar',
    'tipoOperacion', 'correoTipo', 'internetRedesSociales',
  ];
  const isMasiva = sol.tipo === 'masiva';

  const serviciosHtml = (sol.servicios || [])
    .filter(s => s.codigo)
    .map((s, i) => {
      const datos = s.datos || {};
      // Build formatted entries, skipping empty/null values and per-user fields for masiva
      let formattedEntries = Object.entries(datos)
        .filter(([k, v]) => {
          if (EXCLUDE_FIELDS.has(k)) return false;
          if (isMasiva && MASIVA_PER_USER_FIELDS.includes(k)) return false;
          // Hide null, undefined, empty string fields
          if (v === null || v === undefined || v === '') return false;
          return true;
        })
        .map(([k, v]) => {
          const formatted = formatValue(k, v);
          // formatValue returns null for false booleans / empty arrays/objects → skip
          if (formatted === null || formatted === '—') return null;
          return [k, formatted];
        })
        .filter(Boolean);

      // Apply service-specific field order if defined
      const fieldOrder = SERVICE_FIELD_ORDER[s.codigo];
      if (fieldOrder) {
        formattedEntries = formattedEntries.sort(([a], [b]) => {
          const ai = fieldOrder.indexOf(a);
          const bi = fieldOrder.indexOf(b);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }

      const datosHtml = formattedEntries.length > 0
        ? `<table class="datos-servicio">
            ${formattedEntries.map(([k, v]) => {
              // If value starts with __HTML__ marker, render as raw HTML (for lists)
              const isRawHtml = typeof v === 'string' && v.startsWith('__HTML__');
              const displayVal = isRawHtml ? v.slice(8) : escapeHtml(v);
              return `
              <tr>
                <td class="dato-label">${formatLabel(k)}</td>
                <td class="dato-value">${displayVal}</td>
              </tr>`;
            }).join('')}
           </table>`
        : '<p class="sin-datos">Sin datos adicionales</p>';

      return `
        <div class="servicio-item">
          <div class="servicio-header">
            <span class="servicio-num">${i + 1}.</span>
            <span class="servicio-icono">${s.icono || ''}</span>
            <span class="servicio-nombre">${escapeHtml(s.nombre)}</span>
          </div>
          ${datosHtml}
        </div>`;
    }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solicitud ${sol.numero}</title>
  <style>
    @page { size: A4; margin: 12mm 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 10pt;
      color: #1a1a2e;
      line-height: 1.4;
      background: #fff;
      padding: 20px 30px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* ─── HEADER ─── */
    .header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding-bottom: 8px;
      border-bottom: 3px solid #1e3a6e;
      margin-bottom: 4px;
    }
    .header-logo { width: 64px; height: auto; }
    .header-text { flex: 1; }
    .header-institucion {
      font-size: 12pt;
      font-weight: 700;
      color: #1e3a6e;
      letter-spacing: 0.5px;
    }
    .header-otin {
      font-size: 9pt;
      color: #4a4a4a;
      margin-top: 1px;
    }
    /* ─── TÍTULO ─── */
    .titulo {
      text-align: center;
      margin: 10px 0 12px;
    }
    .titulo h1 {
      font-size: 12pt;
      font-weight: 700;
      color: #1e3a6e;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 2px;
    }
    .titulo .numero {
      font-size: 14pt;
      font-weight: 800;
      color: #1e3a6e;
      font-family: 'Courier New', monospace;
    }
    .titulo .fecha {
      font-size: 8pt;
      color: #666;
      margin-top: 2px;
    }

    /* ─── SECCIONES ─── */
    .seccion {
      margin-bottom: 10px;
      border: 1px solid #ddd;
      border-radius: 5px;
      overflow: hidden;
    }
    .seccion-titulo {
      background: #1e3a6e;
      color: #fff;
      font-size: 9pt;
      font-weight: 600;
      padding: 4px 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .seccion-body { padding: 8px 12px; }

    /* ─── TABLA DATOS ─── */
    .datos-tabla {
      width: 100%;
      border-collapse: collapse;
    }
    .datos-tabla td {
      padding: 3px 8px;
      vertical-align: top;
      font-size: 9pt;
    }
    .datos-tabla .label {
      width: 140px;
      font-weight: 600;
      color: #333;
      white-space: nowrap;
    }
    .datos-tabla .value { color: #1a1a2e; }
    .datos-tabla tr:nth-child(even) { background: #f7f9fc; }

    /* ─── SERVICIOS ─── */
    .servicio-item {
      margin-bottom: 8px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .servicio-item:last-child { margin-bottom: 0; }
    .servicio-header {
      background: #f0f4fa;
      padding: 5px 10px;
      font-weight: 600;
      font-size: 9pt;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .servicio-num { color: #1e3a6e; font-weight: 700; }
    .servicio-codigo {
      background: #1e3a6e;
      color: #fff;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 8pt;
      font-family: 'Courier New', monospace;
    }
    .servicio-icono { font-size: 12pt; }
    .servicio-nombre { color: #333; }
    .datos-servicio {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    .datos-servicio td { padding: 2px 10px; }
    .datos-servicio .dato-label {
      width: 150px;
      font-weight: 600;
      color: #555;
    }
    .datos-servicio .dato-value { color: #1a1a2e; }
    .datos-servicio tr:nth-child(even) { background: #fafbfd; }
    .sin-datos { padding: 6px 10px; color: #999; font-size: 8pt; font-style: italic; }

    /* ─── COMPROMISOS ─── */
    .compromisos-texto {
      font-size: 8.5pt;
      color: #444;
      line-height: 1.5;
    }
    .compromisos-texto li { margin-bottom: 2px; }

    /* ─── FIRMA ─── */
    .firma-section {
      margin-top: 10px;
      page-break-inside: avoid;
    }
    .firma-box {
      border: 1px dashed #aaa;
      border-radius: 5px;
      padding: 12px;
      text-align: center;
      max-width: 300px;
      margin: 0 auto;
    }
    .firma-linea {
      border-top: 1px solid #333;
      width: 200px;
      margin: 20px auto 4px;
    }
    .firma-cargo { font-size: 8.5pt; font-weight: 600; color: #333; }
    .firma-nota {
      font-size: 7.5pt;
      color: #888;
      margin-top: 2px;
    }
    .firma-onpe {
      margin-top: 4px;
      font-size: 7.5pt;
      color: #1e3a6e;
      font-weight: 600;
      font-style: italic;
    }

    /* ─── PIE ─── */
    .pie {
      margin-top: 14px;
      padding-top: 6px;
      border-top: 1px solid #ddd;
      font-size: 7pt;
      color: #999;
      text-align: center;
      line-height: 1.3;
    }

    @media print {
      body { padding: 0; }
      .seccion { break-inside: avoid; }
    }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    ${LOGO_B64 ? `<img src="${LOGO_B64}" alt="INEI" class="header-logo">` : ''}
    <div class="header-text">
      <div class="header-institucion">Instituto Nacional de Estadística e Informática</div>
      <div class="header-otin">Oficina Técnica de Informática — OTIN</div>
    </div>
  </div>
  <!-- TÍTULO -->
  <div class="titulo">
    <h1>Solicitud de Acceso a Servicios Informáticos</h1>
    <div class="numero">${escapeHtml(sol.numero)}</div>
    <div class="fecha">${fecha}</div>
  </div>

  <!-- DATOS DEL SOLICITANTE -->
  <div class="seccion">
    <div class="seccion-titulo">Datos del Solicitante</div>
    <div class="seccion-body">
      <table class="datos-tabla">
        <tr><td class="label">Nombres y Apellidos</td><td class="value">${escapeHtml(nombreCompleto)}</td></tr>
        <tr><td class="label">DNI</td><td class="value">${escapeHtml(sol.snap_dni || '—')}</td></tr>
        <tr><td class="label">Cargo</td><td class="value">${escapeHtml(sol.snap_cargo || '—')}</td></tr>
        <tr><td class="label">Vínculo Laboral</td><td class="value">${escapeHtml(sol.snap_vinculo || '—')}</td></tr>
        <tr><td class="label">Oficina</td><td class="value">${escapeHtml(sol.snap_oficina || '—')}</td></tr>
        <tr><td class="label">Sede</td><td class="value">${escapeHtml(sol.snap_sede || '—')}</td></tr>
        <tr><td class="label">Correo Institucional</td><td class="value">${escapeHtml(sol.snap_correo || '—')}</td></tr>
      </table>
    </div>
  </div>

  <!-- USUARIOS MASIVOS (si aplica) -->
  ${usuariosMasivosHtml}

  <!-- SERVICIOS SOLICITADOS -->
  <div class="seccion">
    <div class="seccion-titulo">Servicios Solicitados</div>
    <div class="seccion-body">
      ${serviciosHtml || '<p class="sin-datos">No se registraron servicios</p>'}
    </div>
  </div>

  <!-- COMPROMISOS -->
  <div class="seccion">
    <div class="seccion-titulo">Declaración del Solicitante</div>
    <div class="seccion-body">
      <div class="compromisos-texto">
        <p>El solicitante <strong>${escapeHtml(nombreCompleto)}</strong>, identificado con DNI <strong>${escapeHtml(sol.snap_dni || '')}</strong>, declara bajo responsabilidad que:</p>
        <ul style="margin-top: 4px; padding-left: 18px;">
          <li>Utilizará los accesos y recursos solicitados exclusivamente para fines institucionales del INEI.</li>
          <li>Cumplirá las políticas de seguridad de la información establecidas por la OTIN.</li>
          <li>Asume plena responsabilidad por el uso de los servicios otorgados.</li>
          <li>Notificará inmediatamente cualquier incidente de seguridad o uso indebido detectado.</li>
          <li>Acepta que los accesos serán revocados al término de su vínculo laboral o por incumplimiento.</li>
        </ul>
        <p style="margin-top: 4px; font-style: italic; color: #666;">
          Al generar este documento, el solicitante acepta las condiciones y compromisos descritos.
        </p>
      </div>
    </div>
  </div>

  <!-- FIRMA DIGITAL DEL JEFE INMEDIATO -->
  <div class="firma-section">
    <div class="seccion">
      <div class="seccion-titulo">Aprobación del Jefe Inmediato</div>
      <div class="seccion-body">
        <div class="firma-box">
          <div class="firma-linea"></div>
          <div class="firma-cargo">Jefe Inmediato / Supervisor</div>
          <div class="firma-nota">Firma Digital</div>
          <div class="firma-onpe">Validar mediante Firma Digital ONPE — Reniec</div>
        </div>
      </div>
    </div>
  </div>

  <!-- PIE DE PÁGINA -->
  <div class="pie">
    Documento generado automáticamente por el Sistema SASI — ${fecha}<br>
    Este documento es válido únicamente con la firma digital del jefe inmediato a través de la plataforma ONPE.<br>
    Instituto Nacional de Estadística e Informática — Oficina Técnica de Informática
  </div>

</body>
</html>`;
}

// Fields that should never appear in the PDF (UI state, not business data)
const EXCLUDE_FIELDS = new Set(['mostrarUsuarios']);

// Display order per service code (unlisted fields appear at end)
const SERVICE_FIELD_ORDER = {
  c6: ['tipoSolicitud', 'jefeArea', 'proposito', 'usuarios', 'tipoAcceso', 'servidor', 'carpeta', 'permiso', 'justificacion'],
  c7: ['tipoSolicitud', 'servidor', 'carpeta', 'nivelPermiso', 'justificacion'],
  c8: ['servidor', 'nombreBD', 'ambiente', 'tipoAcceso', 'fechaInicio', 'fechaFin', 'permisoLectura', 'permisoEscritura', 'permisoEjecucion', 'permisoDDL', 'objetosEspecificos', 'justificacion'],
  c9: ['nombreSistema', 'modulo', 'fechaAlta', 'fechaBaja', 'tipoAcceso', 'especificar', 'sustento', 'usuarios'],
};

/** Known label mappings for service data keys */
const LABEL_MAP = {
  tipoOperacion: 'Tipo de Operación',
  tipoSolicitud: 'Tipo de Solicitud',
  correoTipo: 'Tipo de Correo',
  redTipoCuenta: 'Tipo de Cuenta de Red',
  internetPerfil: 'Perfil de Internet',
  nombreHost: 'Nombre del Equipo',
  ipEquipo: 'IP del Equipo',
  macEquipo: 'MAC del Equipo',
  sistemaOperativo: 'Sistema Operativo',
  nombreBaseDatos: 'Nombre de Base de Datos',
  motor: 'Motor de BD',
  tipoAcceso: 'Tipo de Acceso',
  carpetaRuta: 'Ruta de Carpeta',
  permisos: 'Permisos',
  servidor: 'Servidor',
  justificacion: 'Justificación',
  periodoDesde: 'Período Desde',
  periodoHasta: 'Período Hasta',
  fechaInicio: 'Fecha de Inicio',
  fechaTermino: 'Fecha Término',
  fechaFin: 'Fecha de Fin',
  usuarioRed: 'Usuario Red',
  direccionIP: 'Dirección IP',
  correoPersonal: 'Correo Personal',
  telefonoContacto: 'Teléfono Contacto',
  internetRedesSociales: 'Redes Sociales',
  internetJustificacion: 'Justificación Internet',
  // C6 - Carpeta FTP
  jefeArea: 'Jefe de Área',
  proposito: 'Propósito',
  usuarios: 'Usuarios',
  permiso: 'Permiso',
  carpeta: 'Carpeta',
  // C7 - Recursos Compartidos
  nivelPermiso: 'Nivel de Permiso',
  // C8 - Base de Datos
  ambiente: 'Ambiente',
  nombreBD: 'Nombre de Base de Datos',
  permisoDDL: 'Permiso DDL',
  permisoLectura: 'Permiso Lectura',
  permisoEscritura: 'Permiso Escritura',
  permisoEjecucion: 'Permiso Ejecución',
  objetosEspecificos: 'Objetos Específicos',
  // C9 - Sistemas/Aplicativos
  nombreSistema: 'Nombre del Sistema',
  modulo: 'Módulo',
  fechaAlta: 'Fecha de Alta',
  fechaBaja: 'Fecha de Baja',
  sustento: 'Sustento de Uso',
  especificar: 'Especificar',
};

/** Convert camelCase key to readable label */
function formatLabel(key) {
  if (LABEL_MAP[key]) return LABEL_MAP[key];
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

/** Format value for display — map coded values to human-readable text */
const VALUE_MAP = {
  // C1 tipoOperacion
  creacion: 'Creación',
  modificacion: 'Modificación',
  baja: 'Baja',
  personal: 'Personal',
  generica: 'Genérica',
  funcional: 'Funcional',
  '1': 'Avanzado',
  '2': 'Intermedio',
  '3': 'Básico',
  con: 'Con Redes Sociales',
  sin: 'Sin Redes Sociales',
  // C6 - Carpeta FTP
  generacion: 'Generación de carpeta FTP',
  acceso: 'Acceso',
  quitar: 'Quitar permiso',
  lectura: 'Lectura',
  escritura: 'Escritura',
  control_total: 'Control Total',
  // C9 - Sistemas/Aplicativos
  desactivacion: 'Desactivación',
  actualizacion: 'Actualización',
  consulta: 'Consulta',
  otro: 'Otro',
  // C8 - Base de Datos
  desarrollo: 'Desarrollo',
  produccion: 'Producción',
  permanente: 'Permanente',
  temporal: 'Temporal',
};

/** Default values for fields that shouldn't show "—" */
const DEFAULT_MAP = {
  correoCapacidad: '100 MB (por defecto)',
  redNombreGenerico: 'Generado por la OTIN',
};

function formatValue(key, val) {
  if (val === null || val === undefined || val === '') {
    return DEFAULT_MAP[key] || '—';
  }
  // Boolean handling
  if (val === true) return 'Sí';
  if (val === false) return null; // signal to skip this field

  // Array handling — render as HTML table or list
  if (Array.isArray(val)) {
    if (val.length === 0) return null;
    const firstItem = val[0];

    // If array of objects → render as mini-table
    if (typeof firstItem === 'object' && firstItem !== null) {
      // Collect columns: all keys present in ANY item with at least one non-empty value
      const allKeys = new Set();
      val.forEach(item => {
        if (typeof item === 'object' && item !== null) {
          Object.keys(item).forEach(k => { if (!EXCLUDE_FIELDS.has(k)) allKeys.add(k); });
        }
      });
      const cols = [...allKeys].filter(k =>
        val.some(item => {
          const v = item[k];
          return v !== null && v !== undefined && v !== '' && v !== false;
        })
      );
      if (cols.length > 0) {
        // Wide arrays (> 5 cols): render as cards to avoid overflow in PDF
        if (cols.length > 5) {
          const [hk1, hk2, ...bodyKeys] = cols;
          const cards = val.map((item, idx) => {
            const h1 = item[hk1];
            const h2 = item[hk2];
            const headerParts = [h1, h2]
              .filter(v => v !== null && v !== undefined && v !== '')
              .map(v => VALUE_MAP[String(v)] || escapeHtml(String(v)));
            const headerText = headerParts.join(' — ') || `Usuario ${idx + 1}`;
            const cells = bodyKeys.map(k => {
              const v = item[k];
              if (v === null || v === undefined || v === '') return '';
              let display;
              if (v === true) display = 'Sí';
              else if (v === false) display = '';
              else display = VALUE_MAP[String(v)] || escapeHtml(String(v));
              if (!display) return '';
              return `<div style="font-size:7pt; margin-bottom:2px;"><span style="color:#555;">${formatLabel(k)}: </span><strong>${display}</strong></div>`;
            }).join('');
            return `<div style="border:1px solid #ddd; border-radius:4px; margin-bottom:5px; overflow:hidden; page-break-inside:avoid;">
              <div style="background:#e8eef7; padding:3px 8px; font-weight:700; font-size:8pt; color:#1e3a6e;">${idx + 1}. ${headerText}</div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 12px; padding:5px 8px;">${cells}</div>
            </div>`;
          }).join('');
          return `__HTML__<div style="margin-top:2px;">${cards}</div>`;
        }

        // Narrow arrays (≤ 5 cols): compact table
        const thStyle = 'background:#1e3a6e; color:#fff; font-weight:600; padding:3px 6px; font-size:7pt; white-space:nowrap;';
        const tdStyle = 'padding:2px 6px; font-size:7pt; border-bottom:1px solid #eee; vertical-align:top;';
        const rows = val.map((item, rowIdx) => {
          const bg = rowIdx % 2 === 1 ? 'background:#f7f9fc;' : '';
          const cells = cols.map(k => {
            const v = item[k];
            let display;
            if (v === null || v === undefined || v === '') display = '—';
            else if (v === true) display = 'Sí';
            else if (v === false) display = 'No';
            else display = VALUE_MAP[String(v)] || escapeHtml(String(v));
            return `<td style="${tdStyle}">${display}</td>`;
          }).join('');
          return `<tr style="${bg}">${cells}</tr>`;
        }).join('');
        const headers = cols.map(k => `<td style="${thStyle}">${formatLabel(k)}</td>`).join('');
        return `__HTML__<div style="overflow-x:auto; margin-top:2px;"><table style="width:100%; border-collapse:collapse; font-size:7pt;"><tr>${headers}</tr>${rows}</table></div>`;
      }
    }

    // Fallback: bullet list for simple values or objects without good columns
    const items = val.map(item => {
      if (typeof item === 'object' && item !== null) {
        const parts = Object.entries(item)
          .filter(([k, v]) => !EXCLUDE_FIELDS.has(k) && v !== null && v !== undefined && v !== '' && v !== false)
          .map(([k, v]) => `<strong>${formatLabel(k)}:</strong> ${v === true ? 'Sí' : escapeHtml(VALUE_MAP[String(v)] || String(v))}`);
        return parts.join(' &nbsp;·&nbsp; ');
      }
      return escapeHtml(String(item));
    });
    return `__HTML__<ul style="margin:2px 0; padding-left:18px; list-style:disc;">${items.map(i => `<li style="font-size:8pt; margin-bottom:2px;">${i}</li>`).join('')}</ul>`;
  }

  // Object handling — render key-value pairs
  if (typeof val === 'object' && val !== null) {
    const parts = Object.entries(val)
      .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
      .map(([k, v]) => `${formatLabel(k)}: ${v === true ? 'Sí' : (VALUE_MAP[String(v)] || String(v))}`);
    if (parts.length === 0) return null; // skip empty objects
    return parts.join(' | ');
  }

  const str = String(val);
  if (VALUE_MAP[str]) return VALUE_MAP[str];
  if (key === 'internetPerfil' && VALUE_MAP[str]) return VALUE_MAP[str];
  return str;
}

/** Escape HTML entities */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { generarHtmlSolicitud };
