// --- BASIC TABS ---
export const getTabs = async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl || '',
        isActive: tab.active,
        isPinned: tab.pinned,
        index: tab.index,
        audible: tab.audible,
        mutedInfo: tab.mutedInfo,
        lastAccessed: tab.lastAccessed,
        groupId: tab.groupId,
        windowId: tab.windowId
    }));
};

export const activateTab = async (tabId) => {
    try { await chrome.tabs.update(tabId, { active: true }); } catch(e){}
};

export const openInIncognito = async (tabIds) => {
    try {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const tabs = await Promise.all(ids.map(id => chrome.tabs.get(Number(id))));
        const urls = tabs
            .map(t => t.url)
            .filter(url => url && !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:'));
        
        if (urls.length > 0) {
            await chrome.windows.create({ url: urls, incognito: true });
        }
    } catch(e) { console.error("Incognito error:", e); }
};

export const tileTwoTabs = async (tabIdKeep, tabIdMove) => {
    try {
        const win = await chrome.windows.getCurrent();
        const w = screen.availWidth;
        const h = screen.availHeight;
        const l = screen.availLeft;
        const t = screen.availTop;
        const halfW = Math.floor(w / 2);

        const tabToMove = await chrome.tabs.get(Number(tabIdMove));
        
        await chrome.windows.create({
            url: tabToMove.url,
            left: l,
            top: t,
            width: halfW,
            height: h,
            focused: true
        });

        await chrome.windows.update(win.id, {
            left: l + halfW,
            top: t,
            width: halfW,
            height: h,
            state: 'normal',
            focused: true
        });
        
        await chrome.tabs.update(Number(tabIdKeep), { active: true });
    } catch (e) {}
};

export const createTabAtIndex = async (index, active = true, referenceTabId = null) => {
    try {
        let createProps = { index, active };
        if (referenceTabId) {
            const refTab = await chrome.tabs.get(referenceTabId);
            if (refTab && refTab.groupId !== -1) {
                const newTab = await chrome.tabs.create(createProps);
                await chrome.tabs.group({ tabIds: newTab.id, groupId: refTab.groupId });
                return;
            }
        } else {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && activeTab.groupId !== -1) {
                const newTab = await chrome.tabs.create(createProps);
                await chrome.tabs.group({ tabIds: newTab.id, groupId: activeTab.groupId });
                return;
            }
        }
        await chrome.tabs.create(createProps);
    } catch(e){}
};

export const closeTab = async (tabIds) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    if (ids.length > 0) {
        try { await chrome.tabs.remove(ids); } catch(e){}
    }
};

export const moveTab = async (tabIds, newIndex) => {
    try {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        await chrome.tabs.move(ids.map(Number), { index: newIndex });
    } catch(e){}
};

export const togglePinTab = async (tabId, currentState) => {
    try { await chrome.tabs.update(tabId, { pinned: !currentState }); } catch(e){}
};

export const setTabsPinned = async (tabIds, pinned) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    for (const id of ids) {
        try { await chrome.tabs.update(Number(id), { pinned }); } catch(e){}
    }
};

export const toggleMuteTab = async (tabId, isMuted) => {
    try { await chrome.tabs.update(tabId, { muted: !isMuted }); } catch(e){}
};

export const setTabsMuted = async (tabIds, muted) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    for (const id of ids) {
        try { await chrome.tabs.update(Number(id), { muted: muted }); } catch(e){}
    }
};

export const toggleZenMode = async () => {
    const window = await chrome.windows.getCurrent();
    const newState = (window.state === 'fullscreen') ? 'normal' : 'fullscreen';
    await chrome.windows.update(window.id, { state: newState });
    return newState === 'fullscreen';
};

// --- GROUPING & WORKSPACE LOGIC (MEMORY SAVER) ---

export const findGroup = async (title) => {
    if (!chrome.tabGroups || !title) return null;
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const cleanTitle = title.trim().toLowerCase();
    return groups.find(g => (g.title || '').trim().toLowerCase() === cleanTitle);
};

export const renameGroup = async (oldName, newName) => {
    const group = await findGroup(oldName);
    if (group) {
        await chrome.tabGroups.update(group.id, { title: newName });
    }
};

export const enforceGeneralGroup = async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
    const ungroupedIds = tabs.filter(t => t.groupId === -1).map(t => t.id);
    
    let group = await findGroup("General");
    let groupId = group ? group.id : null;

    if (ungroupedIds.length > 0) {
        if (groupId) {
            await chrome.tabs.group({ tabIds: ungroupedIds, groupId });
        } else {
            groupId = await chrome.tabs.group({ tabIds: ungroupedIds });
        }
    }
    
    // ПРИНУДИТЕЛЬНО задаем имя и цвет, чтобы Chrome 100% отрисовал их на панели при запуске
    if (groupId) {
        await chrome.tabGroups.update(groupId, { title: "General", color: "grey" });
    }
};

export const activateWorkspace = async (workspaceName) => {
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const cleanName = workspaceName.trim().toLowerCase();
    
    let targetGroupId = null;

    let targetGroup = groups.find(g => (g.title || '').trim().toLowerCase() === cleanName);
    
    if (targetGroup) {
        targetGroupId = targetGroup.id;
        await chrome.tabGroups.update(targetGroupId, { collapsed: false });
        
        const targetTabs = await chrome.tabs.query({ groupId: targetGroupId });
        if (targetTabs.length > 0) {
            targetTabs.sort((a, b) => a.index - b.index);
            await chrome.tabs.update(targetTabs[0].id, { active: true });
        }
    } else {
        const newTab = await chrome.tabs.create({ active: true });
        targetGroupId = await chrome.tabs.group({ tabIds: newTab.id });
        await chrome.tabGroups.update(targetGroupId, { title: workspaceName, color: "blue", collapsed: false });
    }

    for (const g of groups) {
        if (g.id !== targetGroupId) {
            await chrome.tabGroups.update(g.id, { collapsed: true });
            
            const tabsInGroup = await chrome.tabs.query({ groupId: g.id });
            const idsToDiscard = tabsInGroup.filter(t => !t.active).map(t => t.id);
            
            if (idsToDiscard.length > 0) {
                try {
                    for (const id of idsToDiscard) {
                        await chrome.tabs.discard(id);
                    }
                } catch(e) { console.error("Discard error:", e); }
            }
        }
    }
};

export const addTabToGroupByName = async (tabId, groupName) => {
    try {
        const group = await findGroup(groupName);
        if (group) {
            await chrome.tabs.group({ tabIds: tabId, groupId: group.id });
        } else {
            const newGroupId = await chrome.tabs.group({ tabIds: tabId });
            await chrome.tabGroups.update(newGroupId, { title: groupName });
        }
    } catch(e) {}
};

export const moveTabsToGroup = async (tabIds, groupName) => {
    try {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const group = await findGroup(groupName);
        if (group) {
            await chrome.tabs.group({ tabIds: ids.map(Number), groupId: group.id });
        } else {
            const newGroupId = await chrome.tabs.group({ tabIds: ids.map(Number) });
            await chrome.tabGroups.update(newGroupId, { title: groupName });
        }
    } catch(e) {}
};

export const copyTabsToGroup = async (tabIds, groupName) => {
    try {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const newIds = [];
        for (const id of ids) {
            const newTab = await chrome.tabs.duplicate(Number(id));
            newIds.push(newTab.id);
        }

        const group = await findGroup(groupName);
        if (group) {
            await chrome.tabs.group({ tabIds: newIds, groupId: group.id });
        } else {
            const newGroupId = await chrome.tabs.group({ tabIds: newIds });
            await chrome.tabGroups.update(newGroupId, { title: groupName });
        }
    } catch(e) {}
};

export const subscribeToUpdates = (callback) => {
    const events = [
        chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved,
        chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached
    ];
    let timer;
    const debouncedCallback = () => { clearTimeout(timer); timer = setTimeout(callback, 200); };
    events.forEach(event => event.addListener(debouncedCallback));
};

export const subscribeToActivation = (callback) => {
    chrome.tabs.onActivated.addListener(callback);
};

export const closeGroup = async (title) => {
    const group = await findGroup(title);
    if (group) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        if(tabs.length) await chrome.tabs.remove(tabs.map(t=>t.id));
    }
};

export const duplicateTab = async (tabId) => {
    try { await chrome.tabs.duplicate(tabId); } catch(e){}
};