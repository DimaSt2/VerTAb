// background.js

// 1. Открывать панель по клику
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

// 2. ЖЕСТКАЯ ЗАЧИСТКА ПРИ СТАРТЕ БРАУЗЕРА
// Это гарантирует, что проекты живут только пока жива сессия расширения.
chrome.runtime.onStartup.addListener(async () => {
    try {
        const windows = await chrome.windows.getAll({ populate: true });
        
        for (const window of windows) {
            if (chrome.tabGroups) {
                // Получаем все группы
                const groups = await chrome.tabGroups.query({ windowId: window.id });
                
                for (const group of groups) {
                    // Удаляем ВСЕ группы, включая свернутый General, если он остался
                    // Это вернет браузер в "чистое" состояние
                    const tabs = await chrome.tabs.query({ groupId: group.id });
                    const tabIds = tabs.map(t => t.id);
                    if (tabIds.length > 0) {
                        await chrome.tabs.remove(tabIds);
                    }
                }
            }
        }
        
        // Сбрасываем указатель активного проекта на General
        await chrome.storage.local.set({ activeWorkspaceId: 'ws_default' });
        
    } catch (e) {
        console.error("Cleanup error:", e);
    }
});