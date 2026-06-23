// ===== ОНЛАЙН =====
async function updateOnline() {
    try {
        const res = await fetch('/api/online');
        const data = await res.json();
        document.getElementById('online-count').textContent = data.online || 42;
    } catch {
        document.getElementById('online-count').textContent = '42';
    }
}

// Запускаем при загрузке
document.addEventListener('DOMContentLoaded', () => {
    updateOnline();
    // Обновляем каждые 30 секунд
    setInterval(updateOnline, 30000);
});
