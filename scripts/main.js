// ============================================================
// ОНЛАЙН — обновление с защитой от кеша (максимальная)
// ============================================================

async function updateOnline() {
    try {
        // Добавляем уникальные параметры КАЖДЫЙ РАЗ
        const res = await fetch('/api/online?_=' + Date.now() + '&r=' + Math.random(), {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            cache: 'no-store'
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
// СТАТУС ДРУЗЕЙ (онлайн/офлайн)
// ============================================================

async function updateFriendsStatus() {
    try {
        const res = await fetch('/api/friends/status?_=' + Date.now(), {
            headers: { 'Cache-Control': 'no-cache' }
        });
        if (!res.ok) return;
        
        const friends = await res.json();
        
        document.querySelectorAll('.friend-item').forEach(item => {
            const friendId = item.dataset.friendId;
            const friend = friends.find(f => f.friend_id === friendId);
            if (friend) {
                const statusEl = item.querySelector('.friend-status');
                if (statusEl) {
                    statusEl.textContent = friend.online ? '🟢 онлайн' : '⚫ офлайн';
                    statusEl.style.color = friend.online ? '#00FF88' : '#666';
                }
            }
        });
    } catch (e) {
        console.warn('Ошибка обновления статуса друзей:', e);
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
    
    // Запускаем автообновление каждые 10 секунд (чаще, чтобы точно обновить)
    setInterval(updateOnline, 10000);
    
    // Если мы на странице форума — обновляем статус друзей
    if (document.getElementById('friendList')) {
        setTimeout(updateFriendsStatus, 1500);
        setInterval(updateFriendsStatus, 15000);
    }
});