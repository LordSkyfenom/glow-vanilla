const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// ПОДКЛЮЧЕНИЕ К NEON
// ============================================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============================================================
// СЕКРЕТЫ (ОБНОВЛЕНЫ)
// ============================================================
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const SECRET_KEY = process.env.SECRET_KEY || 'JEBWG6627JekwkavJwkq';        // ← НОВЫЙ СЕКРЕТ
const BANK_SECRET = process.env.BANK_SECRET || 'Fjjx37GJSZ';                // ← НОВЫЙ СЕКРЕТ

// ============================================================
// СЕССИИ
// ============================================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.use(express.json());
app.use(express.static('.'));

// ============================================================
// 1. АВТОРИЗАЦИЯ ЧЕРЕЗ DISCORD
// ============================================================

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
});

app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');

    try {
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

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        let isAdmin = false;
        try {
            const memberRes = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}` }
            });
            if (memberRes.ok) {
                const memberData = await memberRes.json();
                const userRoles = memberData.roles || [];
                isAdmin = userRoles.includes(ADMIN_ROLE_ID);
            }
        } catch (e) {
            isAdmin = userData.id === ADMIN_ID;
        }

        req.session.user = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            isAdmin: isAdmin
        };

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

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ============================================================
// 2. MIDDLEWARE
// ============================================================

function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: 'Требуется авторизация' });
}

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.isAdmin) return next();
    res.status(403).json({ error: 'Только администратор' });
}

// ============================================================
// 3. API — ПОСТЫ И НОВОСТИ
// ============================================================

app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM forum_posts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

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

app.delete('/api/news/:id', isAdmin, async (req, res) => {
    const postId = parseInt(req.params.id);

    try {
        const post = await pool.query(
            'SELECT * FROM forum_posts WHERE id = $1 AND section = $2',
            [postId, 'news']
        );
        if (post.rows.length === 0) {
            return res.status(404).json({ error: 'Новость не найдена' });
        }

        await pool.query('DELETE FROM forum_posts WHERE id = $1', [postId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка удаления новости:', err);
        res.status(500).json({ error: 'Ошибка удаления новости' });
    }
});

// ============================================================
// 4. API — ГОРОДА
// ============================================================

app.get('/api/cities', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, u.username as owner_name 
            FROM cities c
            LEFT JOIN users u ON u.discord_id = c.owner
            ORDER BY c.created_at DESC
        `);
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

app.delete('/api/cities/:id', isAuth, async (req, res) => {
    const cityId = parseInt(req.params.id);
    const userId = req.session.user.id;

    try {
        const city = await pool.query('SELECT * FROM cities WHERE id = $1', [cityId]);
        if (city.rows.length === 0) {
            return res.status(404).json({ error: 'Город не найден' });
        }
        if (city.rows[0].owner !== userId) {
            return res.status(403).json({ error: 'Только владелец может удалить город' });
        }

        await pool.query('DELETE FROM cities WHERE id = $1', [cityId]);
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [`city_${cityId}`]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка удаления города' });
    }
});

app.post('/api/cities/:id/request', isAuth, async (req, res) => {
    const cityId = parseInt(req.params.id);
    const userId = req.session.user.id;

    try {
        const city = await pool.query('SELECT * FROM cities WHERE id = $1', [cityId]);
        if (city.rows.length === 0) return res.status(404).json({ error: 'Город не найден' });

        let requests = city.rows[0].requests || [];
        if (requests.includes(userId)) {
            return res.status(400).json({ error: 'Заявка уже отправлена' });
        }

        requests.push(userId);
        await pool.query('UPDATE cities SET requests = $1 WHERE id = $2', [requests, cityId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка отправки заявки' });
    }
});

app.post('/api/cities/:id/accept', isAuth, async (req, res) => {
    const cityId = parseInt(req.params.id);
    const userId = req.session.user.id;
    const { applicantId } = req.body;

    try {
        const city = await pool.query('SELECT * FROM cities WHERE id = $1', [cityId]);
        if (city.rows.length === 0) return res.status(404).json({ error: 'Город не найден' });
        if (city.rows[0].owner !== userId) {
            return res.status(403).json({ error: 'Только владелец может принимать заявки' });
        }

        let requests = city.rows[0].requests || [];
        if (!requests.includes(applicantId)) {
            return res.status(400).json({ error: 'Заявка не найдена' });
        }

        requests = requests.filter(id => id !== applicantId);
        let members = city.rows[0].members || [];
        if (!members.includes(applicantId)) members.push(applicantId);

        await pool.query('UPDATE cities SET requests = $1, members = $2 WHERE id = $3', [requests, members, cityId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка принятия заявки' });
    }
});

// ============================================================
// ПОКИНУТЬ ГОРОД
// ============================================================
app.post('/api/cities/:id/leave', isAuth, async (req, res) => {
    const cityId = parseInt(req.params.id);
    const userId = req.session.user.id;

    try {
        const city = await pool.query('SELECT * FROM cities WHERE id = $1', [cityId]);
        if (city.rows.length === 0) {
            return res.status(404).json({ error: 'Город не найден' });
        }

        const members = city.rows[0].members || [];
        if (!members.includes(userId)) {
            return res.status(400).json({ error: 'Вы не в этом городе' });
        }

        if (city.rows[0].owner === userId) {
            return res.status(400).json({ error: '👑 Владелец не может покинуть город' });
        }

        const newMembers = members.filter(id => id !== userId);
        await pool.query('UPDATE cities SET members = $1 WHERE id = $2', [newMembers, cityId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка выхода из города:', err);
        res.status(500).json({ error: 'Ошибка выхода из города' });
    }
});

// ============================================================
// 5. API — ДРУЗЬЯ
// ============================================================

app.get('/api/friends', isAuth, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const result = await pool.query(
            `SELECT f.*, u.username, u.avatar 
             FROM friends f 
             JOIN users u ON u.discord_id = f.friend_id 
             WHERE f.user_id = $1`,
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения друзей' });
    }
});

app.post('/api/friends', isAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { friendId } = req.body;

    if (!friendId) return res.status(400).json({ error: 'Укажите ID друга' });
    if (friendId === userId) return res.status(400).json({ error: 'Нельзя добавить себя' });

    try {
        const userCheck = await pool.query('SELECT * FROM users WHERE discord_id = $1', [friendId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const existCheck = await pool.query(
            'SELECT * FROM friends WHERE user_id = $1 AND friend_id = $2',
            [userId, friendId]
        );
        if (existCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Уже в друзьях' });
        }

        await pool.query(
            'INSERT INTO friends (user_id, friend_id) VALUES ($1, $2)',
            [userId, friendId]
        );
        await pool.query(
            'INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [friendId, userId]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка добавления друга' });
    }
});

app.delete('/api/friends/:friendId', isAuth, async (req, res) => {
    const userId = req.session.user.id;
    const friendId = req.params.friendId;

    try {
        await pool.query(
            'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2',
            [userId, friendId]
        );
        await pool.query(
            'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2',
            [friendId, userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка удаления друга' });
    }
});

// ============================================================
// 5.1 API — СТАТУС ДРУЗЕЙ
// ============================================================

app.get('/api/friends/status', isAuth, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const friendsRes = await pool.query(
            `SELECT f.friend_id, u.username, u.avatar 
             FROM friends f 
             JOIN users u ON u.discord_id = f.friend_id 
             WHERE f.user_id = $1`,
            [userId]
        );

        const onlineRes = await pool.query(
            'SELECT online_players FROM server_status ORDER BY updated_at DESC LIMIT 1'
        );
        
        let onlinePlayers = [];
        if (onlineRes.rows.length > 0 && onlineRes.rows[0].online_players) {
            onlinePlayers = onlineRes.rows[0].online_players || [];
        }

        const friendsWithStatus = friendsRes.rows.map(f => ({
            ...f,
            online: onlinePlayers.includes(f.username)
        }));

        res.json(friendsWithStatus);
    } catch (err) {
        console.error('Ошибка получения статуса друзей:', err);
        res.status(500).json({ error: 'Ошибка получения статуса друзей' });
    }
});

// ============================================================
// 6. API — ЧАТЫ
// ============================================================

app.get('/api/messages/:chatId', isAuth, async (req, res) => {
    const chatId = req.params.chatId;

    try {
        const result = await pool.query(
            `SELECT m.*, u.username, u.avatar 
             FROM messages m 
             LEFT JOIN users u ON u.discord_id = m.sender_id 
             WHERE m.chat_id = $1 
             ORDER BY m.created_at ASC`,
            [chatId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения сообщений' });
    }
});

app.post('/api/messages', isAuth, async (req, res) => {
    const { chatId, content, type } = req.body;
    const userId = req.session.user.id;

    if (!chatId || !content) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    try {
        if (type === 'city') {
            const cityId = parseInt(chatId.replace('city_', ''));
            const city = await pool.query(
                'SELECT * FROM cities WHERE id = $1 AND $2 = ANY(members)',
                [cityId, userId]
            );
            if (city.rows.length === 0) {
                return res.status(403).json({ error: 'Вы не в этом городе' });
            }
        } else {
            const friendId = chatId.replace('private_', '');
            const friendCheck = await pool.query(
                'SELECT * FROM friends WHERE user_id = $1 AND friend_id = $2',
                [userId, friendId]
            );
            if (friendCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Вы не друзья' });
            }
        }

        const result = await pool.query(
            `INSERT INTO messages (chat_id, sender_id, content, type) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [chatId, userId, content, type || 'private']
        );

        const user = await pool.query(
            'SELECT username, avatar FROM users WHERE discord_id = $1',
            [userId]
        );

        res.json({
            ...result.rows[0],
            username: user.rows[0]?.username || 'Unknown',
            avatar: user.rows[0]?.avatar || null
        });
    } catch (err) {
        console.error('Ошибка отправки сообщения:', err);
        res.status(500).json({ error: 'Ошибка отправки сообщения' });
    }
});

// ============================================================
// 6.1 API — УДАЛИТЬ СООБЩЕНИЕ
// ============================================================

app.delete('/api/messages/:messageId', isAuth, async (req, res) => {
    const messageId = parseInt(req.params.messageId);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.isAdmin || false;

    try {
        const msg = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
        if (msg.rows.length === 0) {
            return res.status(404).json({ error: 'Сообщение не найдено' });
        }

        if (msg.rows[0].sender_id !== userId && !isAdmin) {
            return res.status(403).json({ error: 'Нет прав на удаление' });
        }

        await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка удаления сообщения:', err);
        res.status(500).json({ error: 'Ошибка удаления сообщения' });
    }
});

// ============================================================
// 7. API — СТАТИСТИКА ПРОФИЛЯ
// ============================================================

app.get('/api/user/stats/:discordId', async (req, res) => {
    const discordId = req.params.discordId;

    try {
        const postsRes = await pool.query(
            'SELECT COUNT(*) FROM forum_posts WHERE discord_id = $1',
            [discordId]
        );
        const posts = parseInt(postsRes.rows[0].count);

        const citiesRes = await pool.query(
            'SELECT COUNT(*) FROM cities WHERE $1 = ANY(members)',
            [discordId]
        );
        const cities = parseInt(citiesRes.rows[0].count);

        const friendsRes = await pool.query(
            'SELECT COUNT(*) FROM friends WHERE user_id = $1',
            [discordId]
        );
        const friends = parseInt(friendsRes.rows[0].count);

        const balance = Math.floor(Math.random() * 5000) + 500;

        res.json({ posts, cities, friends, balance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// ============================================================
// 8. API — ОНЛАЙН
// ============================================================

app.get('/api/online', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
        const result = await pool.query('SELECT online FROM server_status ORDER BY updated_at DESC LIMIT 1');
        const online = result.rows[0]?.online ?? 0;
        console.log(`📊 Онлайн на сайте: ${online}`);
        res.json({ online });
    } catch (err) {
        console.error('Ошибка получения онлайна:', err);
        res.json({ online: 0 });
    }
});

// ============================================================
// 9. API — ОБНОВЛЕНИЕ ОНЛАЙНА (ОТ ПЛАГИНА)
// ============================================================

app.get('/api/online/update', async (req, res) => {
    const online = parseInt(req.query.online);
    const secret = req.query.secret;
    const players = req.query.players ? req.query.players.split(',') : [];

    if (secret !== SECRET_KEY) {
        return res.status(403).send('Неверный ключ');
    }

    if (isNaN(online) || online < 0) {
        return res.status(400).send('Некорректное значение онлайна');
    }

    try {
        await pool.query(
            'INSERT INTO server_status (id, online, online_players, updated_at) VALUES (1, $1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET online = $1, online_players = $2, updated_at = NOW()',
            [online, players]
        );
        console.log(`📊 Онлайн обновлён: ${online} игроков`);
        res.send(`OK: ${online}`);
    } catch (err) {
        console.error('Ошибка обновления онлайна:', err);
        res.status(500).send('Ошибка базы данных');
    }
});

// ============================================================
// 10. API — ПОИСК ПОЛЬЗОВАТЕЛЕЙ
// ============================================================

app.get('/api/users/search', isAuth, async (req, res) => {
    const query = req.query.q;
    if (!query || query.length < 2) {
        return res.json([]);
    }

    try {
        const result = await pool.query(
            `SELECT discord_id, username, avatar 
             FROM users 
             WHERE username ILIKE $1 
             LIMIT 10`,
            [`%${query}%`]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка поиска' });
    }
});

// ============================================================
// 11. API — ПОЛЬЗОВАТЕЛЬ ПО ID
// ============================================================

app.get('/api/users/:discordId', async (req, res) => {
    const discordId = req.params.discordId;

    try {
        const result = await pool.query(
            'SELECT discord_id, username, avatar FROM users WHERE discord_id = $1',
            [discordId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения пользователя' });
    }
});

// ============================================================
// 12. API — БАНКОВСКАЯ СИСТЕМА
// ============================================================

// 12.1 Получить баланс
app.get('/api/bank/balance/:discordId', async (req, res) => {
    const { discordId } = req.params;
    const { secret } = req.query;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    try {
        const result = await pool.query('SELECT balance FROM bank_accounts WHERE discord_id = $1', [discordId]);
        const balance = result.rows[0]?.balance || 0;
        res.json({ discordId, balance });
    } catch (err) {
        console.error('Ошибка получения баланса:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// 12.2 Пополнить баланс (deposit)
app.post('/api/bank/deposit', async (req, res) => {
    const { discordId, username, amount, secret } = req.body;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    if (!discordId || !username || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    try {
        await pool.query(
            `INSERT INTO bank_accounts (discord_id, username, balance) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (discord_id) 
             DO UPDATE SET balance = bank_accounts.balance + $3, username = $2`,
            [discordId, username, amount]
        );

        await pool.query(
            'INSERT INTO bank_transactions (player_id, type, amount) VALUES ($1, $2, $3)',
            [discordId, 'deposit', amount]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка пополнения:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// 12.3 Снять с баланса (withdraw)
app.post('/api/bank/withdraw', async (req, res) => {
    const { discordId, username, amount, secret } = req.body;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    if (!discordId || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    try {
        const result = await pool.query('SELECT balance FROM bank_accounts WHERE discord_id = $1', [discordId]);
        const currentBalance = result.rows[0]?.balance || 0;

        if (currentBalance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        await pool.query(
            'UPDATE bank_accounts SET balance = balance - $1 WHERE discord_id = $2',
            [amount, discordId]
        );

        await pool.query(
            'INSERT INTO bank_transactions (player_id, type, amount) VALUES ($1, $2, $3)',
            [discordId, 'withdraw', -amount]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка снятия:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// 12.4 Перевод (transfer)
app.post('/api/bank/transfer', async (req, res) => {
    const { fromId, toId, amount, secret } = req.body;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    if (!fromId || !toId || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    if (fromId === toId) {
        return res.status(400).json({ error: 'Нельзя перевести самому себе' });
    }

    try {
        const fromResult = await pool.query('SELECT balance FROM bank_accounts WHERE discord_id = $1', [fromId]);
        const fromBalance = fromResult.rows[0]?.balance || 0;

        if (fromBalance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        await pool.query('UPDATE bank_accounts SET balance = balance - $1 WHERE discord_id = $2', [amount, fromId]);

        await pool.query(
            `INSERT INTO bank_accounts (discord_id, username, balance) 
             VALUES ($1, (SELECT username FROM users WHERE discord_id = $1), $2)
             ON CONFLICT (discord_id) 
             DO UPDATE SET balance = bank_accounts.balance + $2`,
            [toId, amount]
        );

        await pool.query(
            'INSERT INTO bank_transactions (player_id, type, amount, target) VALUES ($1, $2, $3, $4)',
            [fromId, 'transfer', -amount, toId]
        );
        await pool.query(
            'INSERT INTO bank_transactions (player_id, type, amount, target) VALUES ($1, $2, $3, $4)',
            [toId, 'transfer', amount, fromId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка перевода:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// 12.5 Получить историю транзакций
app.get('/api/bank/history/:discordId', async (req, res) => {
    const { discordId } = req.params;
    const { secret, limit = 20 } = req.query;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM bank_transactions WHERE player_id = $1 ORDER BY created_at DESC LIMIT $2',
            [discordId, parseInt(limit)]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения истории:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// 12.6 Топ игроков по балансу
app.get('/api/bank/top', async (req, res) => {
    const { secret, limit = 10 } = req.query;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    try {
        const result = await pool.query(
            'SELECT discord_id, username, balance FROM bank_accounts ORDER BY balance DESC LIMIT $1',
            [parseInt(limit)]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения топа:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// ============================================================
// ЗАПУСК
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 Glow Vanilla запущен на порту ${PORT}`);
    console.log(`🤖 Бот токен: ${BOT_TOKEN ? '✅ Установлен' : '❌ НЕ УСТАНОВЛЕН'}`);
    console.log(`👑 Роль админа ID: ${ADMIN_ROLE_ID}`);
    console.log(`📊 База данных: ${process.env.DATABASE_URL ? '✅ Подключена' : '❌ НЕ ПОДКЛЮЧЕНА'}`);
    console.log(`🔑 Секретный ключ: ${SECRET_KEY ? '✅ Установлен' : '❌ НЕ УСТАНОВЛЕН'}`);
    console.log(`🏦 Банковский ключ: ${BANK_SECRET ? '✅ Установлен' : '❌ НЕ УСТАНОВЛЕН'}`);
});