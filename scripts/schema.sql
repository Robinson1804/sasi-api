--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

-- Started on 2026-06-08 09:17:41

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 19347)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 251 (class 1255 OID 18973)
-- Name: actualizar_horas_etapas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_horas_etapas() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE etapas_aprobacion
    SET horas_transcurridas = ROUND(
            EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600, 2
        ),
        vencio_sla = CASE
            WHEN sla_horas IS NOT NULL
             AND EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600 > sla_horas
            THEN true
            ELSE vencio_sla
        END
    WHERE estado IN ('pendiente', 'en_revision')
      AND fecha_accion IS NULL;
END;
$$;


--
-- TOC entry 300 (class 1255 OID 20128)
-- Name: generar_numero_solicitud(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_numero_solicitud() RETURNS character varying
    LANGUAGE plpgsql
    AS $_$
    DECLARE
      anio TEXT;
      seq INT;
    BEGIN
      anio := EXTRACT(YEAR FROM NOW())::TEXT;
      SELECT COALESCE(MAX(
        CAST(SUBSTRING(numero FROM 11) AS INT)
      ), 0) + 1
      INTO seq
      FROM solicitudes
      WHERE numero ~ ('^SASI-' || anio || '-[0-9]+$');
      RETURN 'SASI-' || anio || '-' || LPAD(seq::TEXT, 6, '0');
    END;
    $_$;


--
-- TOC entry 252 (class 1255 OID 18975)
-- Name: trigger_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 218 (class 1259 OID 18976)
-- Name: auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria (
    id bigint NOT NULL,
    id_usuario integer,
    accion character varying(100) NOT NULL,
    tabla_afectada character varying(100),
    id_registro character varying(50),
    datos_antes jsonb,
    datos_despues jsonb,
    ip character varying(45),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 219 (class 1259 OID 18982)
-- Name: auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auditoria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5202 (class 0 OID 0)
-- Dependencies: 219
-- Name: auditoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auditoria_id_seq OWNED BY public.auditoria.id;


--
-- TOC entry 220 (class 1259 OID 18983)
-- Name: config_flujo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_flujo (
    id integer NOT NULL,
    id_servicio integer NOT NULL,
    orden smallint NOT NULL,
    id_rol integer NOT NULL,
    nombre_etapa character varying(100),
    sla_horas numeric(5,2) NOT NULL,
    sla_alerta numeric(5,2) NOT NULL,
    activo boolean DEFAULT true NOT NULL
);


--
-- TOC entry 221 (class 1259 OID 18987)
-- Name: config_flujo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.config_flujo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5203 (class 0 OID 0)
-- Dependencies: 221
-- Name: config_flujo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.config_flujo_id_seq OWNED BY public.config_flujo.id;


--
-- TOC entry 222 (class 1259 OID 18988)
-- Name: documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos (
    id integer NOT NULL,
    id_solicitud integer NOT NULL,
    tipo character varying(30) NOT NULL,
    nombre_archivo character varying(255) NOT NULL,
    url character varying(500) NOT NULL,
    tamano_bytes bigint,
    id_usuario_subio integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT documentos_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('solicitud_pdf'::character varying)::text, ('firmado_usuario'::character varying)::text])))
);


--
-- TOC entry 223 (class 1259 OID 18995)
-- Name: documentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5204 (class 0 OID 0)
-- Dependencies: 223
-- Name: documentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documentos_id_seq OWNED BY public.documentos.id;


--
-- TOC entry 224 (class 1259 OID 18996)
-- Name: etapas_aprobacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etapas_aprobacion (
    id integer NOT NULL,
    id_solicitud_servicio integer,
    id_config integer,
    orden smallint NOT NULL,
    id_rol integer NOT NULL,
    id_aprobador integer,
    estado character varying(30) DEFAULT 'pendiente'::character varying NOT NULL,
    comentario text,
    fecha_inicio timestamp without time zone DEFAULT now() NOT NULL,
    fecha_accion timestamp without time zone,
    horas_transcurridas numeric(6,2),
    sla_horas numeric(5,2),
    vencio_sla boolean DEFAULT false NOT NULL,
    alerta_enviada boolean DEFAULT false NOT NULL,
    id_solicitud integer,
    CONSTRAINT etapas_aprobacion_estado_check CHECK (((estado)::text = ANY (ARRAY[('pendiente'::character varying)::text, ('en_revision'::character varying)::text, ('aprobado'::character varying)::text, ('observado'::character varying)::text, ('rechazado'::character varying)::text, ('atendido'::character varying)::text])))
);


--
-- TOC entry 225 (class 1259 OID 19006)
-- Name: etapas_aprobacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.etapas_aprobacion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5205 (class 0 OID 0)
-- Dependencies: 225
-- Name: etapas_aprobacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.etapas_aprobacion_id_seq OWNED BY public.etapas_aprobacion.id;


--
-- TOC entry 226 (class 1259 OID 19007)
-- Name: historial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial (
    id bigint NOT NULL,
    id_solicitud integer NOT NULL,
    id_solicitud_servicio integer,
    tipo_evento character varying(50) NOT NULL,
    estado_nuevo character varying(30) NOT NULL,
    comentario text,
    id_usuario integer,
    usuario_nombre character varying(200),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 227 (class 1259 OID 19013)
-- Name: historial_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.historial_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5206 (class 0 OID 0)
-- Dependencies: 227
-- Name: historial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.historial_id_seq OWNED BY public.historial.id;


--
-- TOC entry 228 (class 1259 OID 19014)
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones (
    id bigint NOT NULL,
    id_solicitud integer,
    id_personal_destino integer NOT NULL,
    tipo character varying(50) NOT NULL,
    asunto character varying(200),
    cuerpo text,
    leida boolean DEFAULT false NOT NULL,
    fecha_lectura timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 229 (class 1259 OID 19021)
-- Name: notificaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notificaciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5207 (class 0 OID 0)
-- Dependencies: 229
-- Name: notificaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificaciones_id_seq OWNED BY public.notificaciones.id;


--
-- TOC entry 230 (class 1259 OID 19022)
-- Name: personal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal (
    id integer NOT NULL,
    dni character(8) NOT NULL,
    apellidos character varying(100) NOT NULL,
    nombres character varying(100) NOT NULL,
    tipo_vinculo character varying(30) NOT NULL,
    cargo character varying(150),
    correo character varying(100),
    telefono character varying(20),
    oficina character varying(200),
    id_sede integer,
    num_orden_servicio character varying(50),
    fecha_inicio_contrato date,
    fecha_fin_contrato date,
    estado character varying(20) DEFAULT 'ACTIVO'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    correo_personal character varying(150),
    CONSTRAINT personal_estado_check CHECK (((estado)::text = ANY (ARRAY[('ACTIVO'::character varying)::text, ('INACTIVO'::character varying)::text, ('SUSPENDIDO'::character varying)::text]))),
    CONSTRAINT personal_tipo_vinculo_check CHECK (((tipo_vinculo)::text = ANY (ARRAY[('Nombrado'::character varying)::text, ('CAS'::character varying)::text, ('Locador'::character varying)::text, ('Orden de Servicio'::character varying)::text, ('Practicante'::character varying)::text])))
);


--
-- TOC entry 231 (class 1259 OID 19032)
-- Name: personal_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.personal_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5208 (class 0 OID 0)
-- Dependencies: 231
-- Name: personal_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.personal_id_seq OWNED BY public.personal.id;


--
-- TOC entry 232 (class 1259 OID 19033)
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL
);


--
-- TOC entry 233 (class 1259 OID 19037)
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5209 (class 0 OID 0)
-- Dependencies: 233
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- TOC entry 234 (class 1259 OID 19038)
-- Name: sedes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sedes (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    region character varying(50),
    activo boolean DEFAULT true NOT NULL
);


--
-- TOC entry 235 (class 1259 OID 19042)
-- Name: sedes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sedes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5210 (class 0 OID 0)
-- Dependencies: 235
-- Name: sedes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sedes_id_seq OWNED BY public.sedes.id;


--
-- TOC entry 236 (class 1259 OID 19043)
-- Name: servicios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servicios (
    id integer NOT NULL,
    codigo character varying(10) NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion text,
    icono character varying(10),
    color character varying(20),
    orden smallint DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL
);


--
-- TOC entry 237 (class 1259 OID 19050)
-- Name: servicios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.servicios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5211 (class 0 OID 0)
-- Dependencies: 237
-- Name: servicios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.servicios_id_seq OWNED BY public.servicios.id;


--
-- TOC entry 238 (class 1259 OID 19051)
-- Name: solicitud_servicios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitud_servicios (
    id integer NOT NULL,
    id_solicitud integer NOT NULL,
    id_servicio integer NOT NULL,
    estado character varying(30) DEFAULT 'pendiente'::character varying NOT NULL,
    datos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    datos_atencion jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT solicitud_servicios_estado_check CHECK (((estado)::text = ANY (ARRAY[('pendiente'::character varying)::text, ('en_revision'::character varying)::text, ('aprobado'::character varying)::text, ('observado'::character varying)::text, ('rechazado'::character varying)::text, ('atendido'::character varying)::text])))
);


--
-- TOC entry 239 (class 1259 OID 19062)
-- Name: solicitud_servicios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitud_servicios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5212 (class 0 OID 0)
-- Dependencies: 239
-- Name: solicitud_servicios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitud_servicios_id_seq OWNED BY public.solicitud_servicios.id;


--
-- TOC entry 240 (class 1259 OID 19063)
-- Name: solicitudes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitudes (
    id integer NOT NULL,
    numero character varying(20) NOT NULL,
    id_solicitante integer NOT NULL,
    id_usuario_creador integer,
    estado character varying(30) DEFAULT 'borrador'::character varying NOT NULL,
    tipo character varying(20) DEFAULT 'individual'::character varying NOT NULL,
    id_solicitud_padre integer,
    snap_nombres character varying(200),
    snap_dni character(8),
    snap_cargo character varying(150),
    snap_vinculo character varying(50),
    snap_correo character varying(100),
    snap_oficina character varying(200),
    snap_sede character varying(100),
    compromiso_aceptado boolean DEFAULT false NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_envio timestamp without time zone,
    fecha_cierre timestamp without time zone,
    motivo_cancelacion text,
    pdf_url character varying(500),
    firmado_url character varying(500),
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    snap_telefono character varying(20),
    CONSTRAINT solicitudes_estado_check CHECK (((estado)::text = ANY (ARRAY[('borrador'::character varying)::text, ('enviada'::character varying)::text, ('en_proceso'::character varying)::text, ('completada'::character varying)::text, ('rechazada'::character varying)::text, ('observada'::character varying)::text, ('cancelada'::character varying)::text]))),
    CONSTRAINT solicitudes_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('individual'::character varying)::text, ('masiva'::character varying)::text])))
);


--
-- TOC entry 241 (class 1259 OID 19075)
-- Name: solicitudes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitudes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5213 (class 0 OID 0)
-- Dependencies: 241
-- Name: solicitudes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitudes_id_seq OWNED BY public.solicitudes.id;


--
-- TOC entry 242 (class 1259 OID 19076)
-- Name: usuario_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuario_roles (
    id integer NOT NULL,
    id_usuario integer NOT NULL,
    id_rol integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    fecha_asignacion timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 243 (class 1259 OID 19081)
-- Name: usuario_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuario_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5214 (class 0 OID 0)
-- Dependencies: 243
-- Name: usuario_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuario_roles_id_seq OWNED BY public.usuario_roles.id;


--
-- TOC entry 244 (class 1259 OID 19082)
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    id_personal integer NOT NULL,
    password_hash character varying(255) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    ultimo_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 245 (class 1259 OID 19088)
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5215 (class 0 OID 0)
-- Dependencies: 245
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- TOC entry 246 (class 1259 OID 19089)
-- Name: usuarios_masivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios_masivos (
    id integer NOT NULL,
    id_solicitud integer NOT NULL,
    dni character(8) NOT NULL,
    nombres character varying(100) NOT NULL,
    apellidos character varying(100) NOT NULL,
    cargo character varying(150),
    internet_perfil character varying(5),
    correo_personal character varying(100),
    telefono_contacto character varying(20),
    nombre_host character varying(100),
    id_solicitud_hija integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    tipo_cuenta character varying(20) DEFAULT 'personal'::character varying,
    correo_institucional boolean DEFAULT false,
    servicios_solicitados jsonb DEFAULT '[]'::jsonb,
    datos_servicios jsonb DEFAULT '{}'::jsonb
);


--
-- TOC entry 247 (class 1259 OID 19097)
-- Name: usuarios_masivos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuarios_masivos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 5216 (class 0 OID 0)
-- Dependencies: 247
-- Name: usuarios_masivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_masivos_id_seq OWNED BY public.usuarios_masivos.id;


--
-- TOC entry 248 (class 1259 OID 19098)
-- Name: v_bandeja_aprobacion; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_bandeja_aprobacion AS
SELECT
    NULL::integer AS etapa_id,
    NULL::integer AS solicitud_id,
    NULL::character varying(20) AS numero,
    NULL::character varying(200) AS solicitante,
    NULL::character varying(100) AS sede,
    NULL::character varying(20) AS tipo,
    NULL::integer AS id_rol,
    NULL::character varying(50) AS rol_codigo,
    NULL::character varying(100) AS rol_nombre,
    NULL::character varying(30) AS etapa_estado,
    NULL::timestamp without time zone AS fecha_inicio,
    NULL::numeric(5,2) AS sla_horas,
    NULL::numeric(6,2) AS horas_transcurridas,
    NULL::boolean AS vencio_sla,
    NULL::character varying[] AS servicios_codigos,
    NULL::numeric AS horas_restantes_sla;


--
-- TOC entry 249 (class 1259 OID 19102)
-- Name: v_dashboard_kpis; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_dashboard_kpis AS
 SELECT count(*) FILTER (WHERE ((estado)::text = ANY (ARRAY[('enviada'::character varying)::text, ('en_proceso'::character varying)::text]))) AS solicitudes_activas,
    count(*) FILTER (WHERE (((estado)::text = 'completada'::text) AND (fecha_cierre >= date_trunc('month'::text, now())))) AS completadas_mes,
    count(*) FILTER (WHERE (((estado)::text = 'rechazada'::text) AND (fecha_cierre >= date_trunc('month'::text, now())))) AS rechazadas_mes,
    ( SELECT count(*) AS count
           FROM public.etapas_aprobacion
          WHERE ((etapas_aprobacion.vencio_sla = true) AND ((etapas_aprobacion.estado)::text = ANY (ARRAY[('pendiente'::character varying)::text, ('en_revision'::character varying)::text])))) AS sla_vencidos,
    round(((100.0 * (count(*) FILTER (WHERE ((estado)::text = 'completada'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE ((estado)::text = ANY (ARRAY[('completada'::character varying)::text, ('rechazada'::character varying)::text]))), 0))::numeric), 1) AS tasa_aprobacion,
    ( SELECT round(avg((EXTRACT(epoch FROM (solicitudes_1.fecha_cierre - solicitudes_1.fecha_envio)) / (3600)::numeric)), 1) AS round
           FROM public.solicitudes solicitudes_1
          WHERE ((solicitudes_1.fecha_cierre IS NOT NULL) AND (solicitudes_1.fecha_envio IS NOT NULL) AND (solicitudes_1.fecha_cierre >= date_trunc('month'::text, now())))) AS tiempo_promedio_horas
   FROM public.solicitudes
  WHERE (id_solicitud_padre IS NULL);


--
-- TOC entry 250 (class 1259 OID 19107)
-- Name: v_mis_solicitudes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_mis_solicitudes AS
SELECT
    NULL::integer AS id,
    NULL::character varying(20) AS numero,
    NULL::character varying(30) AS estado,
    NULL::character varying(20) AS tipo,
    NULL::timestamp without time zone AS fecha_creacion,
    NULL::timestamp without time zone AS fecha_envio,
    NULL::timestamp without time zone AS fecha_cierre,
    NULL::integer AS id_solicitante,
    NULL::character varying(200) AS snap_nombres,
    NULL::character(8) AS snap_dni,
    NULL::character varying(200) AS snap_oficina,
    NULL::character varying(100) AS snap_sede,
    NULL::character varying[] AS servicios_codigos,
    NULL::character varying[] AS servicios_nombres,
    NULL::json AS etapa_activa;


--
-- TOC entry 4859 (class 2604 OID 19111)
-- Name: auditoria id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria ALTER COLUMN id SET DEFAULT nextval('public.auditoria_id_seq'::regclass);


--
-- TOC entry 4861 (class 2604 OID 19112)
-- Name: config_flujo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_flujo ALTER COLUMN id SET DEFAULT nextval('public.config_flujo_id_seq'::regclass);


--
-- TOC entry 4863 (class 2604 OID 19113)
-- Name: documentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos ALTER COLUMN id SET DEFAULT nextval('public.documentos_id_seq'::regclass);


--
-- TOC entry 4865 (class 2604 OID 19114)
-- Name: etapas_aprobacion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas_aprobacion ALTER COLUMN id SET DEFAULT nextval('public.etapas_aprobacion_id_seq'::regclass);


--
-- TOC entry 4870 (class 2604 OID 19115)
-- Name: historial id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial ALTER COLUMN id SET DEFAULT nextval('public.historial_id_seq'::regclass);


--
-- TOC entry 4872 (class 2604 OID 19116)
-- Name: notificaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones ALTER COLUMN id SET DEFAULT nextval('public.notificaciones_id_seq'::regclass);


--
-- TOC entry 4875 (class 2604 OID 19117)
-- Name: personal id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal ALTER COLUMN id SET DEFAULT nextval('public.personal_id_seq'::regclass);


--
-- TOC entry 4879 (class 2604 OID 19118)
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- TOC entry 4881 (class 2604 OID 19119)
-- Name: sedes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sedes ALTER COLUMN id SET DEFAULT nextval('public.sedes_id_seq'::regclass);


--
-- TOC entry 4883 (class 2604 OID 19120)
-- Name: servicios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios ALTER COLUMN id SET DEFAULT nextval('public.servicios_id_seq'::regclass);


--
-- TOC entry 4886 (class 2604 OID 19121)
-- Name: solicitud_servicios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_servicios ALTER COLUMN id SET DEFAULT nextval('public.solicitud_servicios_id_seq'::regclass);


--
-- TOC entry 4892 (class 2604 OID 19122)
-- Name: solicitudes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes ALTER COLUMN id SET DEFAULT nextval('public.solicitudes_id_seq'::regclass);


--
-- TOC entry 4898 (class 2604 OID 19123)
-- Name: usuario_roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario_roles ALTER COLUMN id SET DEFAULT nextval('public.usuario_roles_id_seq'::regclass);


--
-- TOC entry 4901 (class 2604 OID 19124)
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- TOC entry 4905 (class 2604 OID 19125)
-- Name: usuarios_masivos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios_masivos ALTER COLUMN id SET DEFAULT nextval('public.usuarios_masivos_id_seq'::regclass);


--
-- TOC entry 4919 (class 2606 OID 19127)
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);


--
-- TOC entry 4922 (class 2606 OID 19129)
-- Name: config_flujo config_flujo_id_servicio_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_flujo
    ADD CONSTRAINT config_flujo_id_servicio_orden_key UNIQUE (id_servicio, orden);


--
-- TOC entry 4924 (class 2606 OID 19131)
-- Name: config_flujo config_flujo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_flujo
    ADD CONSTRAINT config_flujo_pkey PRIMARY KEY (id);


--
-- TOC entry 4926 (class 2606 OID 19133)
-- Name: documentos documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_pkey PRIMARY KEY (id);


--
-- TOC entry 4929 (class 2606 OID 19135)
-- Name: etapas_aprobacion etapas_aprobacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas_aprobacion
    ADD CONSTRAINT etapas_aprobacion_pkey PRIMARY KEY (id);


--
-- TOC entry 4935 (class 2606 OID 19137)
-- Name: historial historial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial
    ADD CONSTRAINT historial_pkey PRIMARY KEY (id);


--
-- TOC entry 4940 (class 2606 OID 19139)
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- TOC entry 4945 (class 2606 OID 19141)
-- Name: personal personal_dni_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal
    ADD CONSTRAINT personal_dni_key UNIQUE (dni);


--
-- TOC entry 4947 (class 2606 OID 19143)
-- Name: personal personal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal
    ADD CONSTRAINT personal_pkey PRIMARY KEY (id);


--
-- TOC entry 4949 (class 2606 OID 19145)
-- Name: roles roles_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_codigo_key UNIQUE (codigo);


--
-- TOC entry 4951 (class 2606 OID 19147)
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- TOC entry 4953 (class 2606 OID 19149)
-- Name: sedes sedes_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sedes
    ADD CONSTRAINT sedes_nombre_key UNIQUE (nombre);


--
-- TOC entry 4955 (class 2606 OID 19151)
-- Name: sedes sedes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sedes
    ADD CONSTRAINT sedes_pkey PRIMARY KEY (id);


--
-- TOC entry 4957 (class 2606 OID 19153)
-- Name: servicios servicios_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_codigo_key UNIQUE (codigo);


--
-- TOC entry 4959 (class 2606 OID 19155)
-- Name: servicios servicios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_pkey PRIMARY KEY (id);


--
-- TOC entry 4963 (class 2606 OID 19157)
-- Name: solicitud_servicios solicitud_servicios_id_solicitud_id_servicio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_servicios
    ADD CONSTRAINT solicitud_servicios_id_solicitud_id_servicio_key UNIQUE (id_solicitud, id_servicio);


--
-- TOC entry 4965 (class 2606 OID 19159)
-- Name: solicitud_servicios solicitud_servicios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_servicios
    ADD CONSTRAINT solicitud_servicios_pkey PRIMARY KEY (id);


--
-- TOC entry 4972 (class 2606 OID 19161)
-- Name: solicitudes solicitudes_numero_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_numero_key UNIQUE (numero);


--
-- TOC entry 4974 (class 2606 OID 19163)
-- Name: solicitudes solicitudes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_pkey PRIMARY KEY (id);


--
-- TOC entry 4978 (class 2606 OID 19165)
-- Name: usuario_roles usuario_roles_id_usuario_id_rol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario_roles
    ADD CONSTRAINT usuario_roles_id_usuario_id_rol_key UNIQUE (id_usuario, id_rol);


--
-- TOC entry 4980 (class 2606 OID 19167)
-- Name: usuario_roles usuario_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario_roles
    ADD CONSTRAINT usuario_roles_pkey PRIMARY KEY (id);


--
-- TOC entry 4983 (class 2606 OID 19169)
-- Name: usuarios usuarios_id_personal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_id_personal_key UNIQUE (id_personal);


--
-- TOC entry 4988 (class 2606 OID 19171)
-- Name: usuarios_masivos usuarios_masivos_id_solicitud_dni_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios_masivos
    ADD CONSTRAINT usuarios_masivos_id_solicitud_dni_key UNIQUE (id_solicitud, dni);


--
-- TOC entry 4990 (class 2606 OID 19173)
-- Name: usuarios_masivos usuarios_masivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios_masivos
    ADD CONSTRAINT usuarios_masivos_pkey PRIMARY KEY (id);


--
-- TOC entry 4985 (class 2606 OID 19175)
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- TOC entry 4920 (class 1259 OID 19176)
-- Name: idx_audit_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_usuario ON public.auditoria USING btree (id_usuario, created_at DESC);


--
-- TOC entry 4927 (class 1259 OID 19177)
-- Name: idx_docs_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_solicitud ON public.documentos USING btree (id_solicitud);


--
-- TOC entry 4930 (class 1259 OID 19178)
-- Name: idx_etapas_aprobador; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etapas_aprobador ON public.etapas_aprobacion USING btree (id_aprobador) WHERE (id_aprobador IS NOT NULL);


--
-- TOC entry 4931 (class 1259 OID 19179)
-- Name: idx_etapas_rol_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etapas_rol_estado ON public.etapas_aprobacion USING btree (id_rol, estado);


--
-- TOC entry 4932 (class 1259 OID 19180)
-- Name: idx_etapas_sla_vencido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etapas_sla_vencido ON public.etapas_aprobacion USING btree (vencio_sla) WHERE (vencio_sla = true);


--
-- TOC entry 4933 (class 1259 OID 19181)
-- Name: idx_etapas_ss; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etapas_ss ON public.etapas_aprobacion USING btree (id_solicitud_servicio);


--
-- TOC entry 4936 (class 1259 OID 19182)
-- Name: idx_historial_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_solicitud ON public.historial USING btree (id_solicitud, created_at DESC);


--
-- TOC entry 4937 (class 1259 OID 19183)
-- Name: idx_notif_destino_leida; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_destino_leida ON public.notificaciones USING btree (id_personal_destino, leida);


--
-- TOC entry 4938 (class 1259 OID 19184)
-- Name: idx_notif_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_solicitud ON public.notificaciones USING btree (id_solicitud);


--
-- TOC entry 4941 (class 1259 OID 19185)
-- Name: idx_personal_dni; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personal_dni ON public.personal USING btree (dni);


--
-- TOC entry 4942 (class 1259 OID 19186)
-- Name: idx_personal_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personal_estado ON public.personal USING btree (estado);


--
-- TOC entry 4943 (class 1259 OID 19187)
-- Name: idx_personal_sede; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personal_sede ON public.personal USING btree (id_sede);


--
-- TOC entry 4966 (class 1259 OID 19188)
-- Name: idx_sol_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sol_estado ON public.solicitudes USING btree (estado);


--
-- TOC entry 4967 (class 1259 OID 19189)
-- Name: idx_sol_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sol_fecha ON public.solicitudes USING btree (fecha_creacion DESC);


--
-- TOC entry 4968 (class 1259 OID 19190)
-- Name: idx_sol_padre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sol_padre ON public.solicitudes USING btree (id_solicitud_padre) WHERE (id_solicitud_padre IS NOT NULL);


--
-- TOC entry 4969 (class 1259 OID 19191)
-- Name: idx_sol_solicitante; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sol_solicitante ON public.solicitudes USING btree (id_solicitante);


--
-- TOC entry 4970 (class 1259 OID 19192)
-- Name: idx_sol_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sol_tipo ON public.solicitudes USING btree (tipo);


--
-- TOC entry 4960 (class 1259 OID 19193)
-- Name: idx_ss_servicio_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ss_servicio_estado ON public.solicitud_servicios USING btree (id_servicio, estado);


--
-- TOC entry 4961 (class 1259 OID 19194)
-- Name: idx_ss_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ss_solicitud ON public.solicitud_servicios USING btree (id_solicitud);


--
-- TOC entry 4986 (class 1259 OID 19195)
-- Name: idx_umasivos_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_umasivos_solicitud ON public.usuarios_masivos USING btree (id_solicitud);


--
-- TOC entry 4975 (class 1259 OID 19196)
-- Name: idx_uroles_rol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uroles_rol ON public.usuario_roles USING btree (id_rol);


--
-- TOC entry 4976 (class 1259 OID 19197)
-- Name: idx_uroles_usuario_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uroles_usuario_activo ON public.usuario_roles USING btree (id_usuario, activo);


--
-- TOC entry 4981 (class 1259 OID 19198)
-- Name: idx_usuarios_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_activo ON public.usuarios USING btree (activo);


--
-- TOC entry 5164 (class 2618 OID 19101)
-- Name: v_bandeja_aprobacion _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_bandeja_aprobacion AS
 SELECT ea.id AS etapa_id,
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
    ( SELECT array_agg(DISTINCT sv2.codigo) AS array_agg
           FROM (public.solicitud_servicios ss2
             JOIN public.servicios sv2 ON ((sv2.id = ss2.id_servicio)))
          WHERE (ss2.id_solicitud = s.id)) AS servicios_codigos,
    GREATEST((0)::numeric, (ea.sla_horas - COALESCE(ea.horas_transcurridas, (EXTRACT(epoch FROM (now() - (ea.fecha_inicio)::timestamp with time zone)) / (3600)::numeric)))) AS horas_restantes_sla
   FROM ((public.etapas_aprobacion ea
     JOIN public.solicitudes s ON ((ea.id_solicitud = s.id)))
     JOIN public.roles r ON ((ea.id_rol = r.id)))
  WHERE ((ea.estado)::text = 'en_revision'::text)
  GROUP BY ea.id, s.id, r.id;


--
-- TOC entry 5166 (class 2618 OID 19110)
-- Name: v_mis_solicitudes _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_mis_solicitudes AS
 SELECT s.id,
    s.numero,
    s.estado,
    s.tipo,
    s.fecha_creacion,
    s.fecha_envio,
    s.fecha_cierre,
    s.id_solicitante,
    s.snap_nombres,
    s.snap_dni,
    s.snap_oficina,
    s.snap_sede,
    array_agg(DISTINCT sv.codigo ORDER BY sv.codigo) AS servicios_codigos,
    array_agg(DISTINCT sv.nombre ORDER BY sv.nombre) AS servicios_nombres,
    ( SELECT json_build_object('rol', r.nombre, 'aprobador', (((pa.nombres)::text || ' '::text) || (pa.apellidos)::text), 'horas', ea.horas_transcurridas) AS json_build_object
           FROM ((((public.etapas_aprobacion ea
             JOIN public.solicitud_servicios ss2 ON ((ea.id_solicitud_servicio = ss2.id)))
             JOIN public.roles r ON ((ea.id_rol = r.id)))
             LEFT JOIN public.usuarios ua ON ((ea.id_aprobador = ua.id)))
             LEFT JOIN public.personal pa ON ((ua.id_personal = pa.id)))
          WHERE ((ss2.id_solicitud = s.id) AND ((ea.estado)::text = 'en_revision'::text))
          ORDER BY ea.orden
         LIMIT 1) AS etapa_activa
   FROM ((public.solicitudes s
     JOIN public.solicitud_servicios ss ON ((ss.id_solicitud = s.id)))
     JOIN public.servicios sv ON ((ss.id_servicio = sv.id)))
  WHERE (s.id_solicitud_padre IS NULL)
  GROUP BY s.id;


--
-- TOC entry 5017 (class 2620 OID 19201)
-- Name: personal trg_personal_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_personal_updated BEFORE UPDATE ON public.personal FOR EACH ROW EXECUTE FUNCTION public.trigger_updated_at();


--
-- TOC entry 5018 (class 2620 OID 19202)
-- Name: solicitud_servicios trg_sol_serv_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sol_serv_updated BEFORE UPDATE ON public.solicitud_servicios FOR EACH ROW EXECUTE FUNCTION public.trigger_updated_at();


--
-- TOC entry 5019 (class 2620 OID 19203)
-- Name: solicitudes trg_solicitudes_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_solicitudes_updated BEFORE UPDATE ON public.solicitudes FOR EACH ROW EXECUTE FUNCTION public.trigger_updated_at();


--
-- TOC entry 5020 (class 2620 OID 19204)
-- Name: usuarios trg_usuarios_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_usuarios_updated BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.trigger_updated_at();


--
-- TOC entry 4991 (class 2606 OID 19205)
-- Name: auditoria auditoria_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id);


--
-- TOC entry 4992 (class 2606 OID 19210)
-- Name: config_flujo config_flujo_id_rol_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_flujo
    ADD CONSTRAINT config_flujo_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.roles(id);


--
-- TOC entry 4993 (class 2606 OID 19215)
-- Name: config_flujo config_flujo_id_servicio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_flujo
    ADD CONSTRAINT config_flujo_id_servicio_fkey FOREIGN KEY (id_servicio) REFERENCES public.servicios(id);


--
-- TOC entry 4994 (class 2606 OID 19220)
-- Name: documentos documentos_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitudes(id);


--
-- TOC entry 4995 (class 2606 OID 19225)
-- Name: documentos documentos_id_usuario_subio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_id_usuario_subio_fkey FOREIGN KEY (id_usuario_subio) REFERENCES public.usuarios(id);


--
-- TOC entry 4996 (class 2606 OID 19230)
-- Name: etapas_aprobacion etapas_aprobacion_id_aprobador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas_aprobacion
    ADD CONSTRAINT etapas_aprobacion_id_aprobador_fkey FOREIGN KEY (id_aprobador) REFERENCES public.usuarios(id);


--
-- TOC entry 4997 (class 2606 OID 19235)
-- Name: etapas_aprobacion etapas_aprobacion_id_config_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas_aprobacion
    ADD CONSTRAINT etapas_aprobacion_id_config_fkey FOREIGN KEY (id_config) REFERENCES public.config_flujo(id);


--
-- TOC entry 4998 (class 2606 OID 19240)
-- Name: etapas_aprobacion etapas_aprobacion_id_rol_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas_aprobacion
    ADD CONSTRAINT etapas_aprobacion_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.roles(id);


--
-- TOC entry 4999 (class 2606 OID 19245)
-- Name: etapas_aprobacion etapas_aprobacion_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas_aprobacion
    ADD CONSTRAINT etapas_aprobacion_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitudes(id);


--
-- TOC entry 5000 (class 2606 OID 19250)
-- Name: etapas_aprobacion etapas_aprobacion_id_solicitud_servicio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas_aprobacion
    ADD CONSTRAINT etapas_aprobacion_id_solicitud_servicio_fkey FOREIGN KEY (id_solicitud_servicio) REFERENCES public.solicitud_servicios(id) ON DELETE CASCADE;


--
-- TOC entry 5001 (class 2606 OID 19255)
-- Name: historial historial_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial
    ADD CONSTRAINT historial_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitudes(id);


--
-- TOC entry 5002 (class 2606 OID 19260)
-- Name: historial historial_id_solicitud_servicio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial
    ADD CONSTRAINT historial_id_solicitud_servicio_fkey FOREIGN KEY (id_solicitud_servicio) REFERENCES public.solicitud_servicios(id);


--
-- TOC entry 5003 (class 2606 OID 19265)
-- Name: historial historial_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial
    ADD CONSTRAINT historial_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id);


--
-- TOC entry 5004 (class 2606 OID 19270)
-- Name: notificaciones notificaciones_id_personal_destino_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_id_personal_destino_fkey FOREIGN KEY (id_personal_destino) REFERENCES public.personal(id);


--
-- TOC entry 5005 (class 2606 OID 19275)
-- Name: notificaciones notificaciones_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitudes(id);


--
-- TOC entry 5006 (class 2606 OID 19280)
-- Name: personal personal_id_sede_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal
    ADD CONSTRAINT personal_id_sede_fkey FOREIGN KEY (id_sede) REFERENCES public.sedes(id);


--
-- TOC entry 5007 (class 2606 OID 19285)
-- Name: solicitud_servicios solicitud_servicios_id_servicio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_servicios
    ADD CONSTRAINT solicitud_servicios_id_servicio_fkey FOREIGN KEY (id_servicio) REFERENCES public.servicios(id);


--
-- TOC entry 5008 (class 2606 OID 19290)
-- Name: solicitud_servicios solicitud_servicios_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_servicios
    ADD CONSTRAINT solicitud_servicios_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitudes(id) ON DELETE CASCADE;


--
-- TOC entry 5009 (class 2606 OID 19295)
-- Name: solicitudes solicitudes_id_solicitante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_id_solicitante_fkey FOREIGN KEY (id_solicitante) REFERENCES public.personal(id);


--
-- TOC entry 5010 (class 2606 OID 19300)
-- Name: solicitudes solicitudes_id_solicitud_padre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_id_solicitud_padre_fkey FOREIGN KEY (id_solicitud_padre) REFERENCES public.solicitudes(id);


--
-- TOC entry 5011 (class 2606 OID 19305)
-- Name: solicitudes solicitudes_id_usuario_creador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_id_usuario_creador_fkey FOREIGN KEY (id_usuario_creador) REFERENCES public.usuarios(id);


--
-- TOC entry 5012 (class 2606 OID 19310)
-- Name: usuario_roles usuario_roles_id_rol_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario_roles
    ADD CONSTRAINT usuario_roles_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.roles(id);


--
-- TOC entry 5013 (class 2606 OID 19315)
-- Name: usuario_roles usuario_roles_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario_roles
    ADD CONSTRAINT usuario_roles_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id);


--
-- TOC entry 5014 (class 2606 OID 19320)
-- Name: usuarios usuarios_id_personal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_id_personal_fkey FOREIGN KEY (id_personal) REFERENCES public.personal(id);


--
-- TOC entry 5015 (class 2606 OID 19325)
-- Name: usuarios_masivos usuarios_masivos_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios_masivos
    ADD CONSTRAINT usuarios_masivos_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitudes(id) ON DELETE CASCADE;


--
-- TOC entry 5016 (class 2606 OID 19330)
-- Name: usuarios_masivos usuarios_masivos_id_solicitud_hija_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios_masivos
    ADD CONSTRAINT usuarios_masivos_id_solicitud_hija_fkey FOREIGN KEY (id_solicitud_hija) REFERENCES public.solicitudes(id);


-- Completed on 2026-06-08 09:17:42

--
-- PostgreSQL database dump complete
--


