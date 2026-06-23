const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ПОДКЛЮЧЕНИЕ К NEON =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ===== СЕКРЕТЫ ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====
const ADMIN_ID = process.env.ADMIN_ID || 'Игрок';
const PLAYER_ROLE_ID = process.env.PLAYER_ROLE_ID || 'default';
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || 'admin';

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ===== API: ОНЛАЙН =====
app.get('/api/online', async (req, res) => {
    try {
        const result = await pool.query('SELECT online FROM server_status ORDER BY id DESC LIMIT 1');
        res.json({ online: result.rows[0]?.online || 42 });
    } catch (err) {
        res.json({ online: 42 });
    }
});

// ===== ЗАПУСК =====
app.listen(PORT, () => {
    console.log(`🚀 Glow Vanilla запущен на порту ${PORT}`);
    console.log(`👑 Админ ID: ${ADMIN_ID}`);
});