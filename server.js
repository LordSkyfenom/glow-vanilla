const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ПОДКЛЮЧЕНИЕ К NEON =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ===== СЕКРЕТЫ =====
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const PLAYER_ROLE_ID = process.env.PLAYER_ROLE_ID;

// ===== СЕССИИ (для хранения пользователя) =====
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // true если HTTPS
}));

app.use(express.json());
app.use(express.static('.'));

// ============================================================
// 1. АВТОРИЗАЦИЯ ЧЕРЕЗ DISCORD
// ============================================================

// Главная страница — проверяем, авторизован ли пользователь
app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
});

// Вход через Discord
app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds%20guilds.members.read`;
    res.redirect(url);
});

// Callback после входа
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');

    try {
        // 1. Обмениваем код на токен
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            return res.redirect('/');
        }

        // 2. Получаем данные пользователя
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        // 3. Получаем роли пользователя на сервере (Guild)
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const guilds = await guildsRes.json();

        // Находим сервер Glow Vanilla (по названию или ID)
        const guild = guilds.find(g => g.name === 'Glow Vanilla' || g.id === process.env.GUILD_ID);
        if (!guild) {
            return res.redirect('/');
        }

        // 4. Получаем роли пользователя на сервере
        const memberRes = await fetch(`https://discord.com/api/guilds/${guild.id}/members/${userData.id}`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const memberData = await memberRes.json();
        const userRoles = memberData.roles || [];

        // 5. Проверяем, есть ли роль администратора
        const isAdmin = userRoles.includes(ADMIN_ROLE_ID);
        const isPlayer = userRoles.includes(PLAYER_ROLE_ID) || userRoles.length > 0;

        if (!isPlayer) {
            return res.send('⛔ У вас нет роли игрока на сервере Glow Vanilla');
        }

        // 6. Сохраняем пользователя в сессию
        req.session.user = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            isAdmin: isAdmin,
            roles: userRoles
        };

        // 7. Сохраняем пользователя в БД (если ещё нет)
        await pool.query(
            'INSERT INTO users (discord_id, username, avatar) VALUES ($1, $2, $3) ON CONFLICT (discord_id) DO UPDATE SET username = $2, avatar = $3',
            [userData.id, userData.username, userData.avatar]
        );

        res.redirect('/forum.html');
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

// Выход
app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ============================================================
// 2. API ДЛЯ ФОРУМА
// ============================================================

// Проверка прав (middleware)
function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: 'Требуется авторизация' });
}

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.isAdmin) return next();
    res.status(403).json({ error: 'Только администратор' });
}

// Получить все посты
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM forum_posts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// Создать пост (только авторизованные)
app.post('/api/posts', isAuth, async (req, res) => {
    const { title, content, section } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Заполните все поля' });

    try {
        const result = await pool.query(
            'INSERT INTO forum_posts (author, title, content, section, discord_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.session.user.username, title, content, section || 'general', req.session.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка создания поста' });
    }
});

// Создать новость (только админ)
app.post('/api/news', isAdmin, async (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Заполните все поля' });

    try {
        const result = await pool.query(
            'INSERT INTO forum_posts (author, title, content, section, discord_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            ['Администрация', title, content, 'news', req.session.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка создания новости' });
    }
});

// Города
app.get('/api/cities', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM cities ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

app.post('/api/cities', isAuth, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Введите название' });

    try {
        const result = await pool.query(
            'INSERT INTO cities (name, owner, members) VALUES ($1, $2, $3) RETURNING *',
            [name, req.session.user.id, [req.session.user.id]]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка создания города' });
    }
});

// Онлайн
app.get('/api/online', async (req, res) => {
    try {
        const result = await pool.query('SELECT online FROM server_status ORDER BY id DESC LIMIT 1');
        res.json({ online: result.rows[0]?.online || 42 });
    } catch (err) {
        res.json({ online: 42 });
    }
});

// ============================================================
// ЗАПУСК
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 Glow Vanilla запущен на порту ${PORT}`);
    console.log(`👑 Админ роль ID: ${ADMIN_ROLE_ID}`);
});