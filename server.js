// ============================================================
// БАНКОВСКАЯ СИСТЕМА — API
// ============================================================

const BANK_SECRET = process.env.BANK_SECRET || 'glowbank_secret_2024';

// ============================================================
// 1. ПОЛУЧИТЬ БАЛАНС
// ============================================================
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

// ============================================================
// 2. ПОПОЛНИТЬ БАЛАНС (DEPOSIT)
// ============================================================
app.post('/api/bank/deposit', async (req, res) => {
    const { discordId, username, amount, secret } = req.body;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    if (!discordId || !username || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    try {
        // Обновляем баланс
        await pool.query(
            `INSERT INTO bank_accounts (discord_id, username, balance) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (discord_id) 
             DO UPDATE SET balance = bank_accounts.balance + $3, username = $2`,
            [discordId, username, amount]
        );

        // Записываем транзакцию
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

// ============================================================
// 3. СНЯТЬ С БАЛАНСА (WITHDRAW)
// ============================================================
app.post('/api/bank/withdraw', async (req, res) => {
    const { discordId, username, amount, secret } = req.body;

    if (secret !== BANK_SECRET) {
        return res.status(403).json({ error: 'Неверный ключ' });
    }

    if (!discordId || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    try {
        // Проверяем баланс
        const result = await pool.query('SELECT balance FROM bank_accounts WHERE discord_id = $1', [discordId]);
        const currentBalance = result.rows[0]?.balance || 0;

        if (currentBalance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        // Снимаем
        await pool.query(
            'UPDATE bank_accounts SET balance = balance - $1 WHERE discord_id = $2',
            [amount, discordId]
        );

        // Записываем транзакцию
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

// ============================================================
// 4. ПЕРЕВОД (TRANSFER)
// ============================================================
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
        // Проверяем баланс отправителя
        const fromResult = await pool.query('SELECT balance FROM bank_accounts WHERE discord_id = $1', [fromId]);
        const fromBalance = fromResult.rows[0]?.balance || 0;

        if (fromBalance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        // Снимаем с отправителя
        await pool.query('UPDATE bank_accounts SET balance = balance - $1 WHERE discord_id = $2', [amount, fromId]);

        // Добавляем получателю (если нет записи — создаём)
        await pool.query(
            `INSERT INTO bank_accounts (discord_id, username, balance) 
             VALUES ($1, (SELECT username FROM users WHERE discord_id = $1), $2)
             ON CONFLICT (discord_id) 
             DO UPDATE SET balance = bank_accounts.balance + $2`,
            [toId, amount]
        );

        // Записываем транзакции
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

// ============================================================
// 5. ПОЛУЧИТЬ ИСТОРИЮ ТРАНЗАКЦИЙ
// ============================================================
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

// ============================================================
// 6. ТОП ИГРОКОВ ПО БАЛАНСУ
// ============================================================
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