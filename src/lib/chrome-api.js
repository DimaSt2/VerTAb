// --- КОНСТАНТЫ И НАСТРОЙКИ ---
const DEBUG = true; // Выключаем в проде
const LOG_PREFIX = '[ChromeAPI]';

// Определяем версию Chrome
const chromeVersion = (() => {
    try {
        const match = navigator.userAgent.match(/Chrome\/(\d+)/);
        return match ? parseInt(match[1]) : 0;
    } catch {
        return 0;
    }
})();

const HAS_GROUP_TITLE_BUG = chromeVersion >= 133 && chromeVersion <= 145; // Баг в этих версиях

// --- УТИЛИТЫ ДЛЯ ЛОГИРОВАНИЯ ---
const log = {
    info: (...args) => DEBUG && console.log(LOG_PREFIX, ...args),
    warn: (...args) => DEBUG && console.warn(LOG_PREFIX, ...args),
    error: (...args) => console.error(LOG_PREFIX, ...args), // Ошибки логируем всегда
};

// --- RETRY MECHANISM С EXPONENTIAL BACKOFF ---
async function retry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 100,
        maxDelay = 1000,
        onRetry = null,
        context = 'operation'
    } = options;

    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            if (attempt > 1) {
                log.info(`${context} succeeded after ${attempt} attempts`);
            }
            return { success: true, result, attempts: attempt };
        } catch (error) {
            lastError = error;
            
            if (attempt === maxRetries) {
                log.error(`${context} failed after ${maxRetries} attempts:`, error);
                break;
            }
            
            // Exponential backoff с jitter
            const delay = Math.min(
                baseDelay * Math.pow(2, attempt - 1) + Math.random() * 50,
                maxDelay
            );
            
            log.warn(`${context} attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
            onRetry?.(attempt, error, delay);
            
            await new Promise(r => setTimeout(r, delay));
        }
    }
    
    return { success: false, error: lastError, attempts: maxRetries };
}

// --- GROUP TITLE FIX ДЛЯ ПРОБЛЕМНЫХ ВЕРСИЙ ---
async function ensureGroupTitle(groupId, expectedTitle, options = {}) {
    const {
        force = HAS_GROUP_TITLE_BUG, // Применяем фикс только для проблемных версий
        maxRetries = 3,
    } = options;

    try {
        // Сначала проверяем текущее состояние
        const group = await chrome.tabGroups.get(groupId);
        
        if (group.title === expectedTitle && !force) {
            return { success: true, needed: false };
        }

        log.info(`Fixing group title: "${group.title}" -> "${expectedTitle}" (force: ${force})`);

        // Обновляем заголовок с retry
        const result = await retry(
            async () => {
                await chrome.tabGroups.update(groupId, { title: expectedTitle });
                // Проверяем, что применилось
                const updated = await chrome.tabGroups.get(groupId);
                if (updated.title !== expectedTitle) {
                    throw new Error(`Title mismatch: expected "${expectedTitle}", got "${updated.title}"`);
                }
                return updated;
            },
            {
                maxRetries,
                context: `updateGroupTitle(${groupId}, ${expectedTitle})`,
                onRetry: (attempt) => {
                    log.warn(`Retry ${attempt} for group ${groupId}`);
                }
            }
        );

        return { success: result.success, group: result.result, needed: true };
    } catch (error) {
        log.error(`Failed to ensure group title:`, error);
        return { success: false, error };
    }
}

// --- BASIC TABS С ПРАВИЛЬНОЙ ОБРАБОТКОЙ ---
export const getTabs = async () => {
    try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        return tabs.map(tab => ({
            id: tab.id,
            title: tab.title || '',
            url: tab.url || '',
            favIconUrl: tab.favIconUrl || '',
            isActive: tab.active || false,
            isPinned: tab.pinned || false,
            index: tab.index || 0,
            audible: tab.audible || false,
            mutedInfo: tab.mutedInfo || { muted: false },
            lastAccessed: tab.lastAccessed || Date.now(),
            groupId: tab.groupId !== undefined ? tab.groupId : -1,
            windowId: tab.windowId
        }));
    } catch (error) {
        log.error('Failed to get tabs:', error);
        return [];
    }
};

export const activateTab = async (tabId) => {
    try {
        await chrome.tabs.update(tabId, { active: true });
        log.info(`Activated tab ${tabId}`);
    } catch (error) {
        log.error(`Failed to activate tab ${tabId}:`, error);
        throw error; // Пробрасываем для UI
    }
};

export const openInIncognito = async (tabIds) => {
    try {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const tabs = await Promise.all(
            ids.map(id => chrome.tabs.get(Number(id)).catch(() => null))
        );
        
        const urls = tabs
            .filter(t => t?.url)
            .map(t => t.url)
            .filter(url => url && !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:'));
        
        if (urls.length === 0) {
            throw new Error('No valid URLs to open in incognito');
        }
        
        await chrome.windows.create({ url: urls, incognito: true });
        log.info(`Opened ${urls.length} tabs in incognito`);
    } catch (error) {
        log.error('Incognito error:', error);
        throw error;
    }
};

// --- GROUPING LOGIC С PROPER ERROR HANDLING ---

export const findGroup = async (title) => {
    if (!chrome.tabGroups || !title) return null;
    
    try {
        const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
        const cleanTitle = title.trim().toLowerCase();
        return groups.find(g => (g.title || '').trim().toLowerCase() === cleanTitle) || null;
    } catch (error) {
        log.error(`Failed to find group "${title}":`, error);
        return null;
    }
};

export const renameGroup = async (oldName, newName) => {
    try {
        const group = await findGroup(oldName);
        if (!group) {
            throw new Error(`Group "${oldName}" not found`);
        }
        
        const result = await ensureGroupTitle(group.id, newName);
        
        if (result.success) {
            log.info(`Renamed group "${oldName}" -> "${newName}"`);
        }
        
        return result.success;
    } catch (error) {
        log.error(`Failed to rename group:`, error);
        throw error;
    }
};

export const enforceGeneralGroup = async () => {
    try {
        const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
        const ungroupedIds = tabs.filter(t => t.groupId === -1).map(t => t.id);
        
        let group = await findGroup("General");
        let groupId = group?.id;

        if (ungroupedIds.length > 0) {
            if (groupId) {
                await chrome.tabs.group({ tabIds: ungroupedIds, groupId });
            } else {
                groupId = await chrome.tabs.group({ tabIds: ungroupedIds });
            }
        }
        
        if (groupId) {
            await ensureGroupTitle(groupId, "General", { force: true });
        }
        
        return groupId;
    } catch (error) {
        log.error('Failed to enforce General group:', error);
        throw error;
    }
};

export const createNewProjectGroup = async (name) => {
    try {
        // Проверяем существование
        const existing = await findGroup(name);
        if (existing) {
            log.info(`Group "${name}" already exists, activating`);
            await chrome.tabGroups.update(existing.id, { collapsed: false });
            return existing.id;
        }
        
        // Создаем новую группу
        const tab = await chrome.tabs.create({ active: true });
        const groupId = await chrome.tabs.group({ tabIds: tab.id });
        
        // Устанавливаем заголовок с гарантией
        const result = await ensureGroupTitle(groupId, name, { maxRetries: 5 });
        
        if (!result.success) {
            throw new Error(`Failed to set group title after multiple attempts`);
        }
        
        log.info(`Created new project group: "${name}" (${groupId})`);
        return groupId;
    } catch (error) {
        log.error('Failed to create project group:', error);
        throw error;
    }
};

export const activateWorkspace = async (workspaceName) => {
    try {
        const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
        const safeName = workspaceName?.trim() || "Workspace";
        
        let targetGroup = await findGroup(safeName);
        let targetGroupId;

        if (targetGroup) {
            targetGroupId = targetGroup.id;
            
            // 1. Активируем первую вкладку
            const targetTabs = await chrome.tabs.query({ groupId: targetGroupId });
            if (targetTabs.length > 0) {
                targetTabs.sort((a, b) => a.index - b.index);
                await chrome.tabs.update(targetTabs[0].id, { active: true });
            }

            // 2. Обновляем группу
            await ensureGroupTitle(targetGroupId, safeName);
            
        } else {
            // Создаем новую
            targetGroupId = await createNewProjectGroup(safeName);
        }

        // Сворачиваем остальные группы
        for (const g of groups) {
            if (g.id !== targetGroupId) {
                try {
                    await chrome.tabGroups.update(g.id, { collapsed: true });
                    
                    // Выгружаем неактивные вкладки
                    const tabsInGroup = await chrome.tabs.query({ groupId: g.id });
                    const idsToDiscard = tabsInGroup
                        .filter(t => !t.active)
                        .map(t => t.id);
                    
                    if (idsToDiscard.length > 0) {
                        // Discard с retry
                        for (const id of idsToDiscard) {
                            try {
                                await chrome.tabs.discard(id);
                            } catch (e) {
                                log.warn(`Failed to discard tab ${id}:`, e);
                            }
                        }
                    }
                } catch (error) {
                    log.warn(`Failed to collapse group ${g.id}:`, error);
                }
            }
        }

        log.info(`Activated workspace: "${safeName}"`);
        return targetGroupId;
    } catch (error) {
        log.error('Failed to activate workspace:', error);
        throw error;
    }
};

// --- BULK OPERATIONS С VALIDATION ---

export const addTabToGroupByName = async (tabId, groupName) => {
    try {
        if (!tabId || !groupName) {
            throw new Error('Invalid parameters');
        }

        const group = await findGroup(groupName);
        
        if (group) {
            await chrome.tabs.group({ tabIds: tabId, groupId: group.id });
            await ensureGroupTitle(group.id, groupName);
        } else {
            const newGroupId = await chrome.tabs.group({ tabIds: tabId });
            await ensureGroupTitle(newGroupId, groupName);
        }
        
        log.info(`Added tab ${tabId} to group "${groupName}"`);
    } catch (error) {
        log.error(`Failed to add tab to group:`, error);
        throw error;
    }
};

export const moveTabsToGroup = async (tabIds, groupName) => {
    try {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        if (ids.length === 0) return;

        const group = await findGroup(groupName);
        
        if (group) {
            await chrome.tabs.group({ tabIds: ids.map(Number), groupId: group.id });
            await ensureGroupTitle(group.id, groupName);
        } else {
            const newGroupId = await chrome.tabs.group({ tabIds: ids.map(Number) });
            await ensureGroupTitle(newGroupId, groupName);
        }
        
        log.info(`Moved ${ids.length} tabs to group "${groupName}"`);
    } catch (error) {
        log.error(`Failed to move tabs to group:`, error);
        throw error;
    }
};

export const copyTabsToGroup = async (tabIds, groupName) => {
    try {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        if (ids.length === 0) return;

        const newIds = [];
        for (const id of ids) {
            try {
                const newTab = await chrome.tabs.duplicate(Number(id));
                newIds.push(newTab.id);
            } catch (error) {
                log.warn(`Failed to duplicate tab ${id}:`, error);
            }
        }

        if (newIds.length === 0) {
            throw new Error('No tabs were duplicated successfully');
        }

        const group = await findGroup(groupName);
        
        if (group) {
            await chrome.tabs.group({ tabIds: newIds, groupId: group.id });
            await ensureGroupTitle(group.id, groupName);
        } else {
            const newGroupId = await chrome.tabs.group({ tabIds: newIds });
            await ensureGroupTitle(newGroupId, groupName);
        }
        
        log.info(`Copied ${newIds.length} tabs to group "${groupName}"`);
    } catch (error) {
        log.error(`Failed to copy tabs to group:`, error);
        throw error;
    }
};

// --- SUBSCRIPTIONS С CLEANUP ---

export const subscribeToUpdates = (callback) => {
    const events = [
        chrome.tabs.onCreated,
        chrome.tabs.onUpdated,
        chrome.tabs.onRemoved,
        chrome.tabs.onMoved,
        chrome.tabs.onAttached,
        chrome.tabs.onDetached,
    ];

    if (chrome.tabGroups) {
        events.push(
            chrome.tabGroups.onCreated,
            chrome.tabGroups.onUpdated,
            chrome.tabGroups.onRemoved
        );
    }

    let timeoutId;
    const handler = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            try {
                callback();
            } catch (error) {
                log.error('Update callback failed:', error);
            }
        }, 200);
    };

    // Добавляем слушатели
    events.forEach(event => {
        try {
            event.addListener(handler);
        } catch (error) {
            log.warn('Failed to add listener:', error);
        }
    });

    // Возвращаем функцию cleanup
    return () => {
        clearTimeout(timeoutId);
        events.forEach(event => {
            try {
                event.removeListener(handler);
            } catch (error) {
                // Игнорируем ошибки при удалении
            }
        });
    };
};

export const subscribeToActivation = (callback) => {
    const handler = async (activeInfo) => {
        try {
            await callback(activeInfo);
        } catch (error) {
            log.error('Activation callback failed:', error);
        }
    };

    chrome.tabs.onActivated.addListener(handler);
    
    return () => {
        chrome.tabs.onActivated.removeListener(handler);
    };
};

// --- УТИЛИТЫ ДЛЯ ДИАГНОСТИКИ ---

export const getChromeInfo = () => ({
    version: chromeVersion,
    hasGroupBug: HAS_GROUP_TITLE_BUG,
    hasTabGroups: !!chrome.tabGroups,
    userAgent: navigator.userAgent
});

export const diagnoseGroup = async (groupId) => {
    try {
        const group = await chrome.tabGroups.get(groupId);
        const tabs = await chrome.tabs.query({ groupId });
        
        return {
            group: {
                id: group.id,
                title: group.title,
                color: group.color,
                collapsed: group.collapsed
            },
            tabCount: tabs.length,
            tabs: tabs.map(t => ({
                id: t.id,
                title: t.title,
                active: t.active
            }))
        };
    } catch (error) {
        return { error: error.message };
    }
};