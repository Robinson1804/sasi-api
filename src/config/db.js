const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Helper: query(text, params) → result.rows
const query = (text, params) => pool.query(text, params)

// Helper: getClient() for transactions
const getClient = () => pool.connect()

module.exports = { pool, query, getClient }
