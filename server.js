const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Подключение к Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Статика
app.use(express.static(path.join(__dirname)));

// API: онлайн
app.get('/api/online', async (req, res) => {
    try {
        const result = await pool.query('SELECT online FROM server_status ORDER BY id DESC LIMIT 1');
        res.json({ online: result.rows[0]?.online || 42 });
    } catch (err) {
        res.json({ online: 42 });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Glow Vanilla запущен на порту ${PORT}`);
});