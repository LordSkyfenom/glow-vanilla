// ============================================================
// ОНЛАЙН — обновление с защитой от кеша
// ============================================================

async function updateOnline() {
    try {
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
// СТАТУС ДРУЗЕЙ (пока заглушка)
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
// ЗАПУСК
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    updateOnline();
    updateHeaderAvatar();
    setInterval(updateOnline, 15000);
    
    if (document.getElementById('friendList')) {
        setTimeout(updateFriendsStatus, 1000);
        setInterval(updateFriendsStatus, 15000);
    }
});