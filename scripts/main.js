// ============================================================
// ОНЛАЙН — обновление с защитой от кеша
// ============================================================

async function updateOnline() {
    try {
        // Добавляем _=Date.now() чтобы браузер не кешировал ответ
        const res = await fetch('/api/online?_=' + Date.now(), {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        const data = await res.json();
        
        const onlineCount = document.getElementById('online-count');
        if (onlineCount) {
            const online = data.online || 0;
            onlineCount.textContent = online;
            console.log(`📊 Онлайн обновлён: ${online} игроков`);
        }
    } catch (e) {
        console.warn('❌ Ошибка получения онлайна:', e);
        const onlineCount = document.getElementById('online-count');
        if (onlineCount) {
            onlineCount.textContent = '0';
        }
    }
}

// ============================================================
// АВАТАР ИЗ DISCORD В ХЕДЕРЕ
// ============================================================

async function updateHeaderAvatar() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            const user = await res.json();
            const avatarUrl = user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.id) % 5}.png`;
            
            const headerImg = document.querySelector('.profile-icon img');
            if (headerImg) {
                headerImg.src = avatarUrl;
            }
        }
    } catch (e) {
        console.log('Не удалось загрузить аватар');
    }
}

// ============================================================
// ЗАПУСК ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Обновляем онлайн сразу
    updateOnline();
    
    // Обновляем аватар
    updateHeaderAvatar();
    
    // Запускаем автообновление каждые 15 секунд
    setInterval(updateOnline, 15000);
});