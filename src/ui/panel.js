import * as api from '../lib/chrome-api.js';
import * as storage from '../lib/storage.js';

const els = {
    wsBar: document.getElementById('workspaces-bar'),
    createWsBtn: document.getElementById('create-ws-btn'),
    allWsBtn: document.getElementById('all-ws-toggle'),
    zenModeBtn: document.getElementById('zen-mode-btn'),
    settingsBtn: document.getElementById('settings-toggle'),
    tabsList: document.getElementById('tabs-list'),
    allProjectsList: document.getElementById('all-projects-list'),
    searchInput: document.getElementById('search-input'),
    projectSearch: document.getElementById('project-search'),
    settingsMenu: document.getElementById('settings-menu'),
    projectsDropdown: document.getElementById('projects-dropdown'),
    closeProjectsBtn: document.getElementById('close-projects-menu'),
    closeSettingsBtn: document.getElementById('close-settings-menu'),
    dialog: document.getElementById('new-ws-dialog'),
    dialogTitle: document.getElementById('dialog-title'),
    dialogSubmitBtn: document.getElementById('dialog-submit-btn'),
    cancelCreateBtn: document.getElementById('cancel-create-ws'),
    newWsName: document.getElementById('new-ws-name'),
    html: document.documentElement,
    themeRadios: document.getElementsByName('themes'),
    navBack: document.getElementById('nav-back'),
    navForward: document.getElementById('nav-forward'),
    navReload: document.getElementById('nav-reload'),
    omnibox: document.getElementById('omnibox-input'),
    masterToggle: document.getElementById('master-toggle'),
    masterCheck: document.getElementById('master-check'),
    managementPanel: document.getElementById('management-panel'),
    bulkDelete: document.getElementById('bulk-delete'),
    bulkMoveBtn: document.getElementById('bulk-move-btn'),
    bulkMoveDropdown: document.getElementById('bulk-move-dropdown'),
    bulkCopyBtn: document.getElementById('bulk-copy-btn'),
    bulkCopyDropdown: document.getElementById('bulk-copy-dropdown'),
    bulkSplit: document.getElementById('bulk-split'),
    bulkIncognito: document.getElementById('bulk-incognito'),
    bulkCloseAbove: document.getElementById('bulk-close-above'),
    bulkCloseBelow: document.getElementById('bulk-close-below'),
    bulkDuplicate: document.getElementById('bulk-duplicate'),
    pinnedBar: document.getElementById('pinned-bar'),
    pinnedTabsScroll: document.getElementById('pinned-tabs-scroll'),
    restoreBtn: document.getElementById('restore-btn'),
    fixedNewTabBtn: document.getElementById('fixed-new-tab-btn')
};

let draggingTabId = null;
let draggingTabPinned = false;
let editingWorkspaceId = null;
let isSwitchingProgrammatically = false;
let isSelectionDragging = false;
let selectionTargetState = false;
let isDragging = false;
let currentTabs = [];
let timeUpdateInterval = null;
let previousActiveTabId = null;
let currentWsStartTime = Date.now(); 

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatTimeAgo(timestamp, isActive = false) {
    if (isActive) return 'Active now';
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `Viewed ${days}d ago`;
    if (hours > 0) return `Viewed ${hours}h ago`;
    if (minutes > 0) return `Viewed ${minutes}m ago`;
    if (seconds > 10) return `Viewed ${seconds}s ago`;
    return 'Just now';
}

function getFaviconUrl(tabUrl) {
    if (tabUrl) {
        try {
            const url = new URL(chrome.runtime.getURL("/_favicon/"));
            url.searchParams.set("pageUrl", tabUrl);
            url.searchParams.set("size", "32");
            return url.toString();
        } catch(e) {}
    }
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239ca3af'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3C/svg%3E";
}

function updateZenIcon(isFull) {
    if (!els.zenModeBtn) return;
    els.zenModeBtn.innerHTML = isFull
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>`;
}

async function updateOmnibox() {
    if (!els.omnibox) return;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && document.activeElement !== els.omnibox) {
            els.omnibox.value = tab.url;
        }
    } catch(e) {}
}

function handleSearchInput() {
    if(!els.searchInput || !els.tabsList) return;
    const filter = els.searchInput.value.toLowerCase().trim();
    els.tabsList.querySelectorAll('.tab-card').forEach(card => {
        const title = (card.querySelector('.tab-title')?.innerText || '').toLowerCase();
        const url = (card.dataset.url || '').toLowerCase();
        if (!filter || title.includes(filter) || url.includes(filter)) {
            card.classList.remove('hidden');
        } else {
            card.classList.add('hidden');
        }
    });
}

const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
};

function updateTimeDisplays() {
    document.querySelectorAll('.tab-card').forEach(card => {
        const tabId = Number(card.dataset.id);
        const tab = currentTabs.find(t => t.id === tabId);
        if (!tab) return;
        const metaEl = card.querySelector('.tab-meta');
        if (metaEl) {
            metaEl.textContent = formatTimeAgo(tab.lastAccessed, tab.isActive);
        }
    });
}

function startTimeUpdates() {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    timeUpdateInterval = setInterval(updateTimeDisplays, 10000);
}

function stopTimeUpdates() {
    if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
        timeUpdateInterval = null;
    }
}

function scrollToActiveTab() {
    if (!els.tabsList) return;
    const activeCard = els.tabsList.querySelector('.tab-card.active');
    if (activeCard) {
        activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function scrollToTabById(tabId) {
    if (!els.tabsList) return;
    const card = els.tabsList.querySelector(`[data-id="${tabId}"]`);
    if (card) {
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

const insertTabAt = async (idx) => {
    isSwitchingProgrammatically = true;
    try {
        const { workspaces, activeId } = await storage.getWorkspaces();
        const newTab = await chrome.tabs.create({ active: true, index: idx });
        
        if (activeId === 'ws_default') {
            let group = await api.findGroup("General");
            if (group) await chrome.tabs.group({ tabIds: newTab.id, groupId: group.id });
        } else {
            const activeWsName = workspaces[activeId]?.name;
            if (activeWsName) {
                let group = await api.findGroup(activeWsName);
                if (group) {
                    await chrome.tabs.group({ tabIds: newTab.id, groupId: group.id });
                } else {
                    const newGroupId = await chrome.tabs.group({ tabIds: newTab.id });
                    await chrome.tabGroups.update(newGroupId, { title: activeWsName });
                }
            }
        }
        
        await chrome.tabs.move(newTab.id, { index: idx });
        
    } finally { 
        setTimeout(() => { isSwitchingProgrammatically = false; }, 500); 
    }
};

function setupDelegatedTabListeners() {
    if (!els.tabsList) return;

    els.tabsList.addEventListener('click', async (e) => {
        const card = e.target.closest('.tab-card');
        if (!card) return;
        const tabId = Number(card.dataset.id);

        if (e.target.closest('.close-btn')) {
            e.stopPropagation();
            card.style.display = 'none';
            try { await chrome.tabs.remove(tabId); } catch(err) { api.closeTab(tabId); }
            return;
        }
        if (e.target.closest('.duplicate-btn')) {
            e.stopPropagation();
            chrome.tabs.duplicate(tabId);
            return;
        }
        if (e.target.closest('.incognito-btn')) {
            e.stopPropagation();
            api.openInIncognito([tabId]);
            return;
        }
        if (e.target.closest('.pin-btn')) {
            e.stopPropagation();
            api.togglePinTab(tabId, card.dataset.isPinned === 'true');
            return;
        }
        if (e.target.closest('.audio-indicator')) {
            e.stopPropagation();
            api.toggleMuteTab(tabId, card.dataset.isMuted === 'true');
            return;
        }
        if (e.target.closest('.add-tab-btn.top')) {
            e.stopPropagation();
            insertTabAt(Number(card.dataset.chromeIndex));
            return;
        }
        if (e.target.closest('.add-tab-btn.bottom')) {
            e.stopPropagation();
            insertTabAt(Number(card.dataset.chromeIndex) + 1);
            return;
        }
        if (e.target.closest('.tab-check-wrapper')) {
            e.stopPropagation(); 
            return;
        }

        api.activateTab(tabId);
    });

    els.tabsList.addEventListener('mousedown', (e) => {
        const checkWrapper = e.target.closest('.tab-check-wrapper');
        if (checkWrapper) {
            e.preventDefault(); e.stopPropagation();
            const checkbox = checkWrapper.querySelector('.tab-check-box');
            isSelectionDragging = true;
            const newState = !checkbox.checked;
            checkbox.checked = newState;
            selectionTargetState = newState;
            updateManagementPanel();
        }
    });

    els.tabsList.addEventListener('mouseover', (e) => {
        if (isSelectionDragging) {
            const checkWrapper = e.target.closest('.tab-check-wrapper');
            if (checkWrapper) {
                const checkbox = checkWrapper.querySelector('.tab-check-box');
                checkbox.checked = selectionTargetState;
                updateManagementPanel();
            }
        }
    });

    let currentHoveredCard = null;

    function clearCardHover(card) {
        if (!card) return;
        const btnTop = card.querySelector('.add-tab-btn.top');
        const btnBottom = card.querySelector('.add-tab-btn.bottom');
        if(btnTop) btnTop.classList.remove('visible');
        if(btnBottom) btnBottom.classList.remove('visible');
        card.classList.remove('gradient-top', 'gradient-bottom');
    }

    els.tabsList.addEventListener('mousemove', (e) => {
        if (isSelectionDragging) return;
        const card = e.target.closest('.tab-card');
        
        if (card) {
            if (currentHoveredCard && currentHoveredCard !== card) clearCardHover(currentHoveredCard);
            currentHoveredCard = card;
            
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const isManageMode = !document.body.classList.contains('manage-mode-off');
            const triggerZone = isManageMode ? 75 : 60; 

            if (x < triggerZone && (!isManageMode || x > 30)) { 
                const btnTop = card.querySelector('.add-tab-btn.top');
                const btnBottom = card.querySelector('.add-tab-btn.bottom');
                if (y < rect.height / 2) {
                    btnTop.classList.add('visible');
                    btnBottom.classList.remove('visible');
                    card.classList.add('gradient-top');
                    card.classList.remove('gradient-bottom');
                } else {
                    btnTop.classList.remove('visible');
                    btnBottom.classList.add('visible');
                    card.classList.remove('gradient-top');
                    card.classList.add('gradient-bottom');
                }
            } else {
                clearCardHover(card);
            }
        } else if (currentHoveredCard) {
            clearCardHover(currentHoveredCard);
            currentHoveredCard = null;
        }
    });

    els.tabsList.addEventListener('mouseleave', () => {
        if (currentHoveredCard) clearCardHover(currentHoveredCard);
        currentHoveredCard = null;
    });

    els.tabsList.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.tab-card');
        if (!card) return;

        if (e.target.closest('.tab-check-wrapper, .add-tab-btn, .tab-action-btn, .audio-indicator')) {
            e.preventDefault(); 
            return;
        }
        
        isDragging = true;
        draggingTabId = Number(card.dataset.id);
        draggingTabPinned = false;
        
        e.dataTransfer.setData('text/plain', draggingTabId.toString());
        e.dataTransfer.effectAllowed = 'move';
        
        setTimeout(() => card.classList.add('dragging'), 0);
    });

    els.tabsList.addEventListener('dragend', (e) => {
        isDragging = false;
        draggingTabId = null;
        const card = e.target.closest('.tab-card');
        if (card) card.classList.remove('dragging');
        document.querySelectorAll('.tab-card').forEach(el => {
            el.classList.remove('sort-target-top', 'sort-target-bottom');
        });
    });
}

function setupTabsListDropHandlers() {
    if (!els.tabsList) return;
    
    els.tabsList.ondragover = (e) => {
        if (draggingTabPinned) {
            e.preventDefault();
            els.tabsList.classList.add('drag-over-pinned');
            return;
        }

        const card = e.target.closest('.tab-card');
        if (card) {
            e.preventDefault(); 
            e.dataTransfer.dropEffect = 'move';
            
            if (!draggingTabId || draggingTabId === Number(card.dataset.id)) return;
            
            const rect = card.getBoundingClientRect(); 
            document.querySelectorAll('.tab-card').forEach(el => {
                if (el !== card) el.classList.remove('sort-target-top', 'sort-target-bottom');
            });
            if (e.clientY < rect.top + rect.height/2) card.classList.add('sort-target-top');
            else card.classList.add('sort-target-bottom');
        }
    };

    els.tabsList.ondragleave = (e) => { 
        if (draggingTabPinned) els.tabsList.classList.remove('drag-over-pinned');
        const card = e.target.closest('.tab-card');
        if (card) card.classList.remove('sort-target-top', 'sort-target-bottom');
    };

    els.tabsList.ondrop = async (e) => {
        if (draggingTabPinned && draggingTabId) {
            e.preventDefault();
            els.tabsList.classList.remove('drag-over-pinned');
            const tabId = Number(draggingTabId);
            
            try {
                await chrome.tabs.update(tabId, { pinned: false });
                const { workspaces, activeId } = await storage.getWorkspaces();
                const wsName = activeId === 'ws_default' ? 'General' : workspaces[activeId]?.name;
                
                if (wsName) {
                    let group = await api.findGroup(wsName);
                    if (group) {
                        await chrome.tabs.group({ tabIds: tabId, groupId: group.id });
                    } else if (activeId !== 'ws_default') {
                        const newGroupId = await chrome.tabs.group({ tabIds: tabId });
                        await chrome.tabGroups.update(newGroupId, { title: wsName });
                    } else {
                        await chrome.tabs.ungroup(tabId);
                    }
                }
                isDragging = false;
                renderTabs(true);
            } catch(err) {
                isDragging = false;
                console.error("Drop unpin error:", err);
            }
            return;
        }

        const card = e.target.closest('.tab-card');
        if (card) {
            e.preventDefault(); 
            e.stopPropagation();
            document.querySelectorAll('.tab-card').forEach(el => el.classList.remove('sort-target-top', 'sort-target-bottom')); 

            try {
                const sourceId = Number(e.dataTransfer.getData('text/plain'));
                if (!sourceId || isNaN(sourceId) || sourceId === Number(card.dataset.id)) return;

                const rect = card.getBoundingClientRect(); 
                const targetChromeIndex = Number(card.dataset.chromeIndex);
                const newIndex = e.clientY >= rect.top + rect.height/2 ? targetChromeIndex + 1 : targetChromeIndex; 
                
                const targetGroupId = card.dataset.groupId ? Number(card.dataset.groupId) : -1;
                if (targetGroupId !== -1) {
                    await chrome.tabs.group({ tabIds: sourceId, groupId: targetGroupId });
                } else {
                    await chrome.tabs.ungroup(sourceId);
                }

                await chrome.tabs.move(sourceId, { index: newIndex });

                isDragging = false; 
                renderTabs(true);
            } catch(err) { 
                isDragging = false;
                console.error("Drop error:", err); 
            }
        }
    };

    if (els.pinnedBar) {
        els.pinnedBar.ondragover = (e) => {
            if (!draggingTabPinned && draggingTabId) {
                e.preventDefault();
                els.pinnedBar.style.backgroundColor = 'var(--c-bg-secondary)';
            }
        };
        els.pinnedBar.ondragleave = () => { els.pinnedBar.style.backgroundColor = ''; };
        els.pinnedBar.ondrop = async (e) => {
            e.preventDefault();
            els.pinnedBar.style.backgroundColor = '';
            if (draggingTabId && !draggingTabPinned) {
                await chrome.tabs.update(Number(draggingTabId), { pinned: true });
            }
        };
    }
}

function createTabElement(tab, index) {
    const div = document.createElement('div');
    div.className = `tab-card ${tab.isActive ? 'active' : ''}`;
    div.draggable = true;
    div.dataset.id = tab.id;
    div.setAttribute('data-url', escapeHtml(tab.url)); 
    div.dataset.index = index; 
    div.dataset.chromeIndex = tab.index; // Реальный индекс вкладки в браузере
    div.dataset.groupId = tab.groupId ?? -1;
    div.dataset.isPinned = tab.isPinned;
    div.dataset.isMuted = tab.mutedInfo?.muted ?? false;

    const isMuted = div.dataset.isMuted === 'true';
    const hasAudio = tab.audible || isMuted;
    let audioHtml = '';
    if (hasAudio) {
        const audioIcon = isMuted 
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>` 
            : `<div class="audio-wave"><div class="audio-bar"></div><div class="audio-bar"></div><div class="audio-bar"></div></div>`;
        audioHtml = `<div class="audio-indicator ${isMuted ? 'muted' : ''}" data-tooltip="${isMuted ? 'Unmute' : 'Mute'}" data-tooltip-pos="up">${audioIcon}</div>`;
    }

    let badgeHtml = '';
    if (index < 10) {
        badgeHtml = `<kbd class="shortcut-badge">${index === 9 ? '0' : (index + 1)}</kbd>`;
    }

    const timeAgoText = formatTimeAgo(tab.lastAccessed, tab.isActive);

    div.innerHTML = `
        ${badgeHtml}
        <div class="tab-check-wrapper">
            <input type="checkbox" class="tab-check-box" aria-label="Select tab" style="pointer-events: none;">
        </div>
        <div class="tab-divider"></div>
        <img src="${getFaviconUrl(tab.url)}" class="tab-icon" alt="">
        <div class="tab-info">
            <div class="tab-title">${escapeHtml(tab.title)}</div>
            <div class="tab-meta">${escapeHtml(timeAgoText)}</div>
        </div>
        <div class="tab-actions">
            <button class="tab-action-btn pin-btn" data-tooltip="Pin tab" data-tooltip-pos="up" aria-label="Pin tab">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z"/></svg>
            </button>
            <button class="tab-action-btn incognito-btn" data-tooltip="Open in Incognito" data-tooltip-pos="up" aria-label="Open incognito">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5c-7 0 -10 7 -10 7s3 7 10 7s10 -7 10 -7s-3 -7 -10 -7z"></path><circle cx="12" cy="12" r="3"></circle><path d="M3 3l18 18"></path></svg>
            </button>
            <button class="tab-action-btn duplicate-btn" data-tooltip="Duplicate" data-tooltip-pos="up" aria-label="Duplicate tab">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            ${audioHtml}
            <button class="tab-action-btn close-btn" data-tooltip="Close" data-tooltip-pos="up" aria-label="Close tab">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        <div class="add-tab-btn top"></div>
        <div class="add-tab-btn bottom"></div>
    `;

    return div;
}

function renderPinnedBar(pinnedTabs) {
    if (!els.pinnedTabsScroll || !els.pinnedBar) return;
    els.pinnedTabsScroll.innerHTML = '';

    if (pinnedTabs.length === 0) {
        els.pinnedBar.classList.remove('visible');
        return;
    }
    els.pinnedBar.classList.add('visible');

    pinnedTabs.forEach((tab, index) => {
        const item = document.createElement('div');
        item.className = `pinned-tab-item ${tab.isActive ? 'active' : ''}`;
        item.dataset.id = tab.id;
        item.setAttribute('data-tooltip', escapeHtml(tab.title)); 
        item.dataset.tooltipPos = 'down';
        item.draggable = true;
        
        item.innerHTML = `
            <img src="${getFaviconUrl(tab.url)}" alt="">
            <div class="pinned-tab-close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
        `;
        
        item.onclick = (e) => {
            if (e.target.closest('.pinned-tab-close')) {
                e.stopPropagation();
                item.style.display = 'none';
                chrome.tabs.remove(tab.id);
                return;
            }
            api.activateTab(tab.id);
        };
        
        item.ondragstart = (e) => {
            isDragging = true;
            draggingTabId = tab.id;
            draggingTabPinned = true;
            e.dataTransfer.setData('text/plain', tab.id.toString());
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => item.classList.add('dragging'), 0);
        };
        
        item.ondragend = () => {
            isDragging = false;
            draggingTabId = null;
            draggingTabPinned = false;
            item.classList.remove('dragging');
            document.querySelectorAll('.pinned-tab-item').forEach(el => el.classList.remove('drag-over'));
        };
        
        item.ondragover = (e) => { 
            e.preventDefault(); 
            if (draggingTabPinned && draggingTabId !== tab.id) {
                item.classList.add('drag-over');
            }
        };
        
        item.ondragleave = () => item.classList.remove('drag-over');
        
        item.ondrop = async (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            if (draggingTabPinned && draggingTabId) {
                isDragging = false;
                await chrome.tabs.move(Number(draggingTabId), { index: index });
                renderTabs(true);
            }
        };
        
        els.pinnedTabsScroll.appendChild(item);
    });
}

async function renderTabs(forceFullRender = false) {
    if (isDragging && !forceFullRender) return;

    const tabs = await api.getTabs();
    const { activeId, workspaces } = await storage.getWorkspaces();

    if (!workspaces || !workspaces[activeId]) return;
    const currentWs = workspaces[activeId];

    const pinnedTabs = tabs.filter(t => t.isPinned);
    const unpinnedTabsAll = tabs.filter(t => !t.isPinned);

    let visibleTabs = [];
    if (activeId === 'ws_default') {
        const group = await api.findGroup("General");
        if (group) visibleTabs = unpinnedTabsAll.filter(t => t.groupId === group.id);
        else visibleTabs = unpinnedTabsAll.filter(t => t.groupId === -1);
    } else {
        const group = await api.findGroup(currentWs.name);
        if (group) visibleTabs = unpinnedTabsAll.filter(t => t.groupId === group.id);
    }

    currentTabs = visibleTabs;
    
    const activeTab = currentTabs.find(t => t.isActive);
    if (activeTab) previousActiveTabId = activeTab.id;

    renderPinnedBar(pinnedTabs);

    if (!forceFullRender) {
        const existingCards = Array.from(els.tabsList.querySelectorAll('.tab-card'));
        const existingIds = existingCards.map(c => Number(c.dataset.id));
        const newIds = currentTabs.map(t => t.id);
        
        if (JSON.stringify(existingIds) === JSON.stringify(newIds)) {
            currentTabs.forEach(tab => {
                const card = els.tabsList.querySelector(`[data-id="${tab.id}"]`);
                if (card) {
                    if (tab.isActive) card.classList.add('active');
                    else card.classList.remove('active');
                    const metaEl = card.querySelector('.tab-meta');
                    if (metaEl) metaEl.textContent = formatTimeAgo(tab.lastAccessed, tab.isActive);
                }
            });
            handleSearchInput();
            updateManagementPanel();
            return;
        }
    }

    els.tabsList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    currentTabs.forEach((tab, index) => {
        fragment.appendChild(createTabElement(tab, index));
    });
    els.tabsList.appendChild(fragment);

    handleSearchInput();
    updateManagementPanel();
    if (forceFullRender) setTimeout(scrollToActiveTab, 50);
}

function updateManagementPanel() {
    if (!els.managementPanel) return;
    const checked = document.querySelectorAll('.tab-check-box:checked');
    const count = checked.length;

    const allBoxes = document.querySelectorAll('.tab-check-box');
    if (els.masterCheck) {
        if (allBoxes.length > 0 && count === allBoxes.length) {
            els.masterCheck.checked = true;
            els.masterCheck.indeterminate = false;
        } else if (count > 0) {
            els.masterCheck.checked = false;
            els.masterCheck.indeterminate = true;
        } else {
            els.masterCheck.checked = false;
            els.masterCheck.indeterminate = false;
        }
    }

    els.managementPanel.classList.remove('single-selected', 'dual-selected');
    if (count === 1) els.managementPanel.classList.add('single-selected');
    else if (count === 2) els.managementPanel.classList.add('dual-selected');
}

async function handleBulkAction(action) {
    const checked = document.querySelectorAll('.tab-check-box:checked');
    const ids = Array.from(checked).map(cb => Number(cb.closest('.tab-card').dataset.id));
    if (ids.length === 0) return;

    isSwitchingProgrammatically = true;

    if (action === 'delete') {
        checked.forEach(cb => { cb.closest('.tab-card').style.display = 'none'; });
        try { await chrome.tabs.remove(ids); } catch(e) { await api.closeTab(ids); }
    } else if (action === 'split') {
        if (ids.length === 2) { 
            if (typeof api.tileTwoTabs === 'function') {
                await api.tileTwoTabs(ids[0], ids[1]);
            } else {
                try {
                    const currentWindow = await chrome.windows.getCurrent();
                    const width = Math.floor(currentWindow.width / 2);
                    await chrome.windows.update(currentWindow.id, { state: 'normal', width: width, left: 0 });
                    await chrome.windows.create({ 
                        tabId: ids[1], 
                        state: 'normal', 
                        width: width, 
                        left: width, 
                        top: currentWindow.top, 
                        height: currentWindow.height 
                    });
                    await chrome.tabs.update(ids[0], { active: true });
                } catch(err) { console.error('Error splitting tabs:', err); }
            }
        } 
    } else if (action === 'incognito') {
        await api.openInIncognito(ids);
    } else if (action === 'closeAbove') {
        await closeRelative(ids[0], 'above');
    } else if (action === 'closeBelow') {
        await closeRelative(ids[0], 'below');
    } else if (action === 'duplicate') {
        for (let id of ids) {
            await chrome.tabs.duplicate(id);
        }
    }

    document.querySelectorAll('.tab-check-box').forEach(cb => cb.checked = false);
    updateManagementPanel();
    
    setTimeout(() => { isSwitchingProgrammatically = false; }, 500);
}

async function closeRelative(currentId, direction) {
    const cards = Array.from(document.querySelectorAll('.tab-card'));
    const targetIndex = cards.findIndex(c => Number(c.dataset.id) === currentId);
    if (targetIndex === -1) return;

    let idsToClose = [];
    if (direction === 'above') {
        idsToClose = cards.slice(0, targetIndex).map(c => Number(c.dataset.id));
        cards.slice(0, targetIndex).forEach(c => c.style.display = 'none');
    } else {
        idsToClose = cards.slice(targetIndex + 1).map(c => Number(c.dataset.id));
        cards.slice(targetIndex + 1).forEach(c => c.style.display = 'none');
    }
    
    if (idsToClose.length) {
        try { await chrome.tabs.remove(idsToClose); } catch(e) { await api.closeTab(idsToClose); }
    }
}

async function setupBulkMoveDropdown() {
    const { workspaces } = await storage.getWorkspaces();
    [els.bulkMoveDropdown, els.bulkCopyDropdown].forEach((dropdown, idx) => {
        if (!dropdown) return;
        dropdown.innerHTML = '';
        Object.values(workspaces).forEach(ws => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.innerText = escapeHtml(ws.name);
            item.addEventListener('mousedown', async (e) => {
                e.preventDefault(); 
                isSwitchingProgrammatically = true; 
                
                const checked = document.querySelectorAll('.tab-check-box:checked');
                const ids = Array.from(checked).map(cb => Number(cb.closest('.tab-card').dataset.id));
                
                document.querySelectorAll('.tab-check-box').forEach(cb => cb.checked = false);
                updateManagementPanel();
                
                if (idx === 0) {
                    await api.moveTabsToGroup(ids, ws.name);
                } else {
                    await api.copyTabsToGroup(ids, ws.name);
                }
                
                renderTabs(true);
                setTimeout(() => { isSwitchingProgrammatically = false; }, 500);
            });
            dropdown.appendChild(item);
        });
    });
}

async function getOrderedIds() {
    const { workspaces, visibleIds } = await storage.getWorkspaces();
    let allIds = Object.keys(workspaces);
    let orderedIds = ['ws_default', ...visibleIds.filter(id => id !== 'ws_default' && allIds.includes(id))];
    allIds.forEach(id => { if(!orderedIds.includes(id)) orderedIds.push(id); });
    return { workspaces, orderedIds };
}

async function saveOrderedIds(orderedIds) {
    await chrome.storage.local.set({ visibleProjectIds: orderedIds });
}

async function hardSyncWithChrome() {
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    let { workspaces, orderedIds } = await getOrderedIds();
    let changed = false;

    for (const group of groups) {
        const groupName = group.title ? group.title.trim() : "";
        if (!groupName || groupName.toLowerCase() === 'general') continue;

        const existingWs = Object.values(workspaces).find(ws => ws.name.toLowerCase() === groupName.toLowerCase());
        
        if (!existingWs) {
            const newId = 'ws_' + Date.now() + Math.random().toString(36).substr(2, 5);
            workspaces[newId] = { id: newId, name: groupName, tabs: [], lastActive: Date.now() };
            orderedIds.splice(1, 0, newId);
            changed = true;
        }
    }

    if (changed) {
        orderedIds = [...new Set(orderedIds)];
        await chrome.storage.local.set({ workspaces, visibleProjectIds: orderedIds });
    }
}

async function syncGeneralOnLoad() {
    await api.enforceGeneralGroup();
}

async function renderAllProjectsList() {
    const { workspaces, orderedIds } = await getOrderedIds();
    const { activeId } = await storage.getWorkspaces();
    els.allProjectsList.innerHTML = '';

    const filterText = els.projectSearch ? els.projectSearch.value.toLowerCase() : '';
    let draggedWsId = null;

    const createRow = (id, slotIndex = null) => {
        const ws = workspaces[id];
        if (!ws) return null;
        
        const displayName = id === 'ws_default' ? 'General' : ws.name;
        if (filterText && !displayName.toLowerCase().includes(filterText)) return null;

        const row = document.createElement('div');
        row.className = `project-row ${id === activeId ? 'active' : ''}`;
        
        let contentHTML = ``;
        if (slotIndex !== null) {
            contentHTML += `<kbd class="shortcut-badge" style="position:relative; top:0; left:0; transform:none !important; margin:0 8px 0 0; pointer-events:none; flex-shrink:0;">${slotIndex}</kbd>`;
        } else {
            contentHTML += `<div style="width:22px; margin-right:8px; pointer-events:none; flex-shrink:0;"></div>`; 
        }
        contentHTML += `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; line-height:1.5; display:flex; align-items:center;">${escapeHtml(displayName)}</span>`;
        
        row.innerHTML = contentHTML;

        if (id !== 'ws_default') {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'project-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'project-action-btn edit-btn';
            editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
            editBtn.onclick = (e) => {
                e.stopPropagation();
                openDialog('edit', ws);
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'project-action-btn delete-btn';
            delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete workspace "${ws.name}"?`)) {
                    await storage.deleteWorkspace(id);
                    await api.closeGroup(ws.name);
                    await renderWorkspacesBar();
                    await renderAllProjectsList();
                }
            };
            
            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(delBtn);
            row.appendChild(actionsDiv);

            row.draggable = true;
            row.ondragstart = (e) => {
                if (e.target.closest('.project-actions')) {
                    e.preventDefault();
                    return;
                }
                draggedWsId = id;
                e.dataTransfer.setData('text/plain', id);
                e.dataTransfer.effectAllowed = 'move';
                row.classList.add('dragging');
            };

            row.ondragend = () => {
                draggedWsId = null;
                row.classList.remove('dragging');
                document.querySelectorAll('.project-row').forEach(r => {
                    r.classList.remove('sort-target-top', 'sort-target-bottom');
                });
            };

            row.ondragover = (e) => {
                e.preventDefault(); 
                if (!draggedWsId || draggedWsId === id) return;
                
                const rect = row.getBoundingClientRect();
                row.classList.remove('sort-target-top', 'sort-target-bottom');
                if (e.clientY < rect.top + rect.height / 2) row.classList.add('sort-target-top');
                else row.classList.add('sort-target-bottom');
            };

            row.ondragleave = () => {
                row.classList.remove('sort-target-top', 'sort-target-bottom');
            };

            row.ondrop = async (e) => {
                e.preventDefault();
                row.classList.remove('sort-target-top', 'sort-target-bottom');
                
                const sourceId = e.dataTransfer.getData('text/plain');
                if (!sourceId || sourceId === id || sourceId === 'ws_default') return;

                const rect = row.getBoundingClientRect();
                const insertAfter = e.clientY >= rect.top + rect.height / 2;

                let { orderedIds } = await getOrderedIds();
                const fromIdx = orderedIds.indexOf(sourceId);
                let toIdx = orderedIds.indexOf(id);

                if (fromIdx !== -1 && toIdx !== -1) {
                    orderedIds.splice(fromIdx, 1);
                    toIdx = orderedIds.indexOf(id); 
                    if (insertAfter) toIdx++;
                    
                    const finalToIdx = Math.max(1, toIdx); 
                    orderedIds.splice(finalToIdx, 0, sourceId);
                    
                    await saveOrderedIds(orderedIds);
                    await renderAllProjectsList();
                    await renderWorkspacesBar();
                }
            };
        } else {
            row.ondragover = (e) => {
                e.preventDefault();
                if (draggedWsId) row.classList.add('sort-target-bottom');
            };
            row.ondragleave = () => row.classList.remove('sort-target-bottom');
            row.ondrop = async (e) => {
                e.preventDefault();
                row.classList.remove('sort-target-bottom');
                
                const sourceId = e.dataTransfer.getData('text/plain');
                if (!sourceId || sourceId === 'ws_default') return;

                let { orderedIds } = await getOrderedIds();
                const fromIdx = orderedIds.indexOf(sourceId);
                if (fromIdx !== -1) {
                    orderedIds.splice(fromIdx, 1);
                    orderedIds.splice(1, 0, sourceId); 
                    
                    await saveOrderedIds(orderedIds);
                    await renderAllProjectsList();
                    await renderWorkspacesBar();
                }
            };
        }
        
        return row;
    };

    const generalRow = createRow('ws_default');
    if (generalRow) els.allProjectsList.appendChild(generalRow);

    const div1 = document.createElement('div');
    div1.className = 'ws-menu-divider';
    els.allProjectsList.appendChild(div1);

    for(let i = 1; i <= 3; i++) {
        if (orderedIds[i]) {
            const row = createRow(orderedIds[i], i);
            if(row) els.allProjectsList.appendChild(row);
        }
    }

    if (orderedIds.length > 4) {
        const div2 = document.createElement('div');
        div2.className = 'ws-menu-divider';
        els.allProjectsList.appendChild(div2);
        
        for(let i = 4; i < orderedIds.length; i++) {
            const row = createRow(orderedIds[i]);
            if(row) els.allProjectsList.appendChild(row);
        }
    }
}

function openDialog(mode, workspace = null) {
    editingWorkspaceId = (mode === 'edit') ? workspace.id : null;
    els.dialogTitle.innerText = (mode === 'edit') ? 'Rename Workspace' : 'New Workspace';
    els.dialogSubmitBtn.innerText = (mode === 'edit') ? 'Save' : 'Create';
    els.newWsName.value = (mode === 'edit') ? workspace.name : '';
    els.dialog.showModal();
    setTimeout(() => els.newWsName.focus(), 50);
}

async function submitDialog() {
    const name = els.newWsName.value.trim();
    if (!name) return;
    
    isSwitchingProgrammatically = true; 
    
    try {
        if (editingWorkspaceId) {
            if (editingWorkspaceId === 'ws_default') return; // Защита General
            
            const { workspaces } = await storage.getWorkspaces();
            const oldName = workspaces[editingWorkspaceId]?.name;
            
            await storage.renameWorkspace(editingWorkspaceId, name);
            if (oldName) {
                await api.renameGroup(oldName, name); 
            }
        } else {
            await api.enforceGeneralGroup();
            
            const newId = await storage.createWorkspace(name);
            
            let { orderedIds } = await getOrderedIds();
            orderedIds = orderedIds.filter(id => id !== newId);
            orderedIds.splice(1, 0, newId);
            await saveOrderedIds(orderedIds);

            await storage.setActiveWorkspace(newId);
            await api.activateWorkspace(name);
        }
        
        els.dialog.close();
        await renderWorkspacesBar();
        await renderTabs(true);
        if (els.projectsDropdown && els.projectsDropdown.classList.contains('open')) {
            await renderAllProjectsList();
        }
    } finally {
        setTimeout(() => { isSwitchingProgrammatically = false; }, 500);
    }
}

async function switchWorkspace(targetId) {
    isSwitchingProgrammatically = true;
    try {
        const { workspaces, activeId } = await storage.getWorkspaces();
        const targetName = targetId === 'ws_default' ? 'General' : workspaces[targetId].name;

        if (targetId === activeId) {
            await api.activateWorkspace(targetName);
            isSwitchingProgrammatically = false;
            return;
        }

        await storage.setActiveWorkspace(targetId);
        
        let { orderedIds } = await getOrderedIds();
        const targetIndex = orderedIds.indexOf(targetId);
        if (targetIndex >= 4) {
            orderedIds.splice(targetIndex, 1);
            orderedIds.splice(1, 0, targetId);
            await saveOrderedIds(orderedIds);
        }

        await api.activateWorkspace(targetName);
        
        currentWsStartTime = Date.now(); 

        await renderWorkspacesBar();
        await renderTabs(true);
    } catch (e) { console.error(e); } 
    finally { setTimeout(() => { isSwitchingProgrammatically = false; }, 500); }
}

async function renderWorkspacesBar() {
    const { workspaces, activeId } = await storage.getWorkspaces();
    let { orderedIds } = await getOrderedIds();
    
    els.wsBar.innerHTML = '';
    let list = orderedIds.slice(0, 4);

    list.forEach(id => {
        const ws = workspaces[id]; if (!ws) return;
        const btn = document.createElement('button');
        btn.className = `ws-btn ${id === activeId ? 'active' : ''}`;
        const span = document.createElement('span'); 
        span.innerText = id === 'ws_default' ? 'General' : ws.name;
        btn.appendChild(span);
        
        btn.onclick = () => switchWorkspace(id);
        
        if (id !== activeId) {
            btn.ondragover = (e) => { e.preventDefault(); btn.classList.add('drag-over'); };
            btn.ondragleave = () => btn.classList.remove('drag-over');
            btn.ondrop = async (e) => { 
                e.preventDefault(); 
                btn.classList.remove('drag-over'); 
                if(draggingTabId) {
                    isDragging = false;
                    const dropWsName = id === 'ws_default' ? 'General' : ws.name;
                    await api.addTabToGroupByName(Number(draggingTabId), dropWsName);
                    renderTabs(true);
                }
            };
        }
        els.wsBar.appendChild(btn);
    });
}

function setupEventListeners() {
    els.navBack?.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
        if(tab) chrome.tabs.goBack(tab.id);
    });
    els.navForward?.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
        if(tab) chrome.tabs.goForward(tab.id);
    });
    els.navReload?.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
        if(tab) chrome.tabs.reload(tab.id);
    });

    els.omnibox?.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            let url = els.omnibox.value.trim();
            if (url.startsWith('chrome-extension://') || url.startsWith('chrome://')) {
            } else if (!url.includes('.') || url.includes(' ')) {
                url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
            } else if (!url.startsWith('http')) {
                url = 'https://' + url;
            }
            const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
            if(tab) await chrome.tabs.update(tab.id, { url });
            else await chrome.tabs.create({ url });
        }
    });

    els.createWsBtn?.addEventListener('click', () => openDialog('create'));
    els.cancelCreateBtn?.addEventListener('click', () => els.dialog.close());
    els.dialogSubmitBtn?.addEventListener('click', submitDialog);
    els.newWsName?.addEventListener('keydown', (e) => { if(e.key === 'Enter') els.dialogSubmitBtn.click(); });

    els.settingsBtn?.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        els.projectsDropdown.classList.remove('open'); 
        els.settingsMenu.classList.toggle('open'); 
    });
    els.allWsBtn?.addEventListener('click', async (e) => { 
        e.stopPropagation(); 
        els.settingsMenu.classList.remove('open'); 
        els.projectsDropdown.classList.toggle('open'); 
        if(els.projectsDropdown.classList.contains('open')) { 
            await renderAllProjectsList(); 
            setTimeout(() => els.projectSearch?.focus(), 100); 
        }
    });
    els.closeProjectsBtn?.addEventListener('click', (e) => { e.stopPropagation(); els.projectsDropdown.classList.remove('open'); });
    els.closeSettingsBtn?.addEventListener('click', (e) => { e.stopPropagation(); els.settingsMenu.classList.remove('open'); });

    document.addEventListener('click', (e) => {
        if (els.settingsMenu && !els.settingsMenu.contains(e.target) && e.target !== els.settingsBtn) {
            els.settingsMenu.classList.remove('open');
        }
        if (els.projectsDropdown && !els.projectsDropdown.contains(e.target) && e.target !== els.allWsBtn) {
            if (els.dialog && els.dialog.contains(e.target)) return;
            els.projectsDropdown.classList.remove('open');
        }
    });

    els.zenModeBtn?.addEventListener('click', async () => { 
        const isFull = await api.toggleZenMode(); 
        updateZenIcon(isFull); 
    });

    const savedTheme = localStorage.getItem('theme') || 'light';
    els.html.className = `${savedTheme}-theme`;
    const radio = document.querySelector(`input[name="themes"][value="${savedTheme}"]`);
    if (radio) radio.checked = true;
    els.themeRadios.forEach(r => r.addEventListener('change', () => { 
        els.html.className = `${r.value}-theme`; 
        localStorage.setItem('theme', r.value); 
    }));

    els.projectSearch?.addEventListener('input', renderAllProjectsList);
    els.searchInput?.addEventListener('input', handleSearchInput);

    els.masterToggle?.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.body.classList.remove('manage-mode-off');
            els.managementPanel.classList.add('visible');
            localStorage.setItem('manageMode', 'on');
        } else {
            document.body.classList.add('manage-mode-off');
            els.managementPanel.classList.remove('visible');
            localStorage.setItem('manageMode', 'off');
            document.querySelectorAll('.tab-check-box:checked').forEach(cb => cb.checked = false);
            updateManagementPanel();
        }
    });

    els.masterCheck?.addEventListener('click', (e) => {
        const isChecked = e.target.checked;
        document.querySelectorAll('.tab-check-box').forEach(cb => cb.checked = isChecked);
        updateManagementPanel();
    });

    ['delete','split','incognito','closeAbove','closeBelow', 'duplicate'].forEach(a => 
        els[`bulk${a.charAt(0).toUpperCase()+a.slice(1)}`]?.addEventListener('click', () => handleBulkAction(a))
    );
    els.bulkMoveBtn?.addEventListener('mouseenter', setupBulkMoveDropdown);
    els.bulkCopyBtn?.addEventListener('mouseenter', setupBulkMoveDropdown);

    els.fixedNewTabBtn?.addEventListener('click', async () => {
        isSwitchingProgrammatically = true; 
        try {
            const { workspaces, activeId } = await storage.getWorkspaces();
            const newTab = await chrome.tabs.create({ active: true });
            
            if (activeId === 'ws_default') {
                let group = await api.findGroup("General");
                if (group) {
                    await chrome.tabs.group({ tabIds: newTab.id, groupId: group.id });
                }
            } else {
                const activeWsName = workspaces[activeId]?.name;
                if (activeWsName) {
                    let group = await api.findGroup(activeWsName);
                    if (group) {
                        await chrome.tabs.group({ tabIds: newTab.id, groupId: group.id });
                    } else {
                        const newGroupId = await chrome.tabs.group({ tabIds: newTab.id });
                        await chrome.tabGroups.update(newGroupId, { title: activeWsName });
                    }
                }
            }
        } finally {
            setTimeout(() => { isSwitchingProgrammatically = false; }, 500);
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    setupDelegatedTabListeners();
    setupEventListeners();
    setupTabsListDropHandlers();

    const savedManageMode = localStorage.getItem('manageMode');
    if (savedManageMode === 'on') {
        if(els.masterToggle) els.masterToggle.checked = true;
        if(els.managementPanel) els.managementPanel.classList.add('visible');
    } else {
        document.body.classList.add('manage-mode-off');
    }

    try {
        await hardSyncWithChrome(); 
        
        const [initActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const { workspaces } = await storage.getWorkspaces();
        let targetWsIdInit = 'ws_default'; 
        
        if (initActiveTab && initActiveTab.groupId !== -1) {
            const groupInit = await chrome.tabGroups.get(initActiveTab.groupId);
            const groupNameInit = (groupInit.title || '').trim().toLowerCase();
            const matchedWsInit = Object.values(workspaces).find(ws => ws.name.trim().toLowerCase() === groupNameInit);
            if (matchedWsInit) targetWsIdInit = matchedWsInit.id;
        }
        await storage.setActiveWorkspace(targetWsIdInit);
        currentWsStartTime = Date.now(); 
        
        await renderWorkspacesBar();
        await renderTabs(true);
        updateOmnibox();

        syncGeneralOnLoad().then(() => {
            renderTabs(true);
        });
        
        startTimeUpdates();

        if(els.searchInput) els.searchInput.focus();
        
        const debouncedRender = debounce(() => {
            if (!isDragging) {
                renderTabs(true);
                updateOmnibox();
            }
        }, 300);
        
        api.subscribeToUpdates(debouncedRender);

        if (chrome.tabGroups) {
            chrome.tabGroups.onUpdated.addListener(async (group) => {
                if (!group.title) return;
                const newName = group.title.trim();
                if (newName.toLowerCase() === 'general') return;

                const { workspaces, activeId } = await storage.getWorkspaces();
                if (activeId && workspaces[activeId] && activeId !== 'ws_default') {
                    const tabsInGroup = await chrome.tabs.query({ groupId: group.id, active: true, currentWindow: true });
                    if (tabsInGroup.length > 0) {
                        if (workspaces[activeId].name !== newName) {
                            await storage.renameWorkspace(activeId, newName);
                            await renderWorkspacesBar();
                        }
                    }
                }
            });
        }
        
        api.subscribeToActivation(async (activeInfo) => {
            updateOmnibox();
            if (isSwitchingProgrammatically) return;
            
            try {
                const tab = await chrome.tabs.get(activeInfo.tabId);
                const { workspaces, activeId } = await storage.getWorkspaces();
                let targetWsId = 'ws_default'; 
                
                if (tab.groupId !== -1) {
                    const group = await chrome.tabGroups.get(tab.groupId);
                    const groupName = (group.title || '').trim().toLowerCase();
                    const matchedWs = Object.values(workspaces).find(ws => ws.name.trim().toLowerCase() === groupName);
                    if (matchedWs) targetWsId = matchedWs.id;
                } else if (!tab.pinned) {
                    isSwitchingProgrammatically = true;
                    targetWsId = activeId;
                    
                    if (activeId === 'ws_default') {
                        let group = await api.findGroup("General");
                        if (group) {
                            await chrome.tabs.group({ tabIds: tab.id, groupId: group.id });
                        }
                    } else {
                        const activeWsName = workspaces[activeId]?.name;
                        if (activeWsName) {
                            let group = await api.findGroup(activeWsName);
                            if (group) {
                                await chrome.tabs.group({ tabIds: tab.id, groupId: group.id });
                            } else {
                                const newGroupId = await chrome.tabs.group({ tabIds: tab.id });
                                await chrome.tabGroups.update(newGroupId, { title: activeWsName });
                            }
                        }
                    }
                    setTimeout(() => { isSwitchingProgrammatically = false; }, 300);
                }
                
                if (targetWsId !== activeId) {
                    await storage.setActiveWorkspace(targetWsId);
                    renderWorkspacesBar();
                    renderTabs(true);
                    if (tab.groupId !== -1) await api.focusOnGroup(tab.groupId);
                } else {
                    if (!isDragging) {
                        if (previousActiveTabId !== null && previousActiveTabId !== activeInfo.tabId) {
                            const prevTabData = currentTabs.find(t => t.id === previousActiveTabId);
                            if (prevTabData) {
                                prevTabData.lastAccessed = Date.now();
                                prevTabData.isActive = false;
                            }
                            const prevCard = document.querySelector(`[data-id="${previousActiveTabId}"]`);
                            if (prevCard) {
                                prevCard.classList.remove('active');
                                const metaEl = prevCard.querySelector('.tab-meta');
                                if (metaEl) metaEl.textContent = 'Just now';
                            }
                        }
                        
                        const newTabData = currentTabs.find(t => t.id === activeInfo.tabId);
                        if (newTabData) {
                            newTabData.isActive = true;
                        }
                        const newCard = document.querySelector(`[data-id="${activeInfo.tabId}"]`);
                        if (newCard) {
                            newCard.classList.add('active');
                            const metaEl = newCard.querySelector('.tab-meta');
                            if (metaEl) metaEl.textContent = 'Active now';
                            newCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                        
                        previousActiveTabId = activeInfo.tabId;
                    }
                }
            } catch(e) {}
        });

        chrome.tabs.onCreated.addListener((newTab) => {
            if (chrome.runtime.lastError) return;
            if (!isDragging) {
                requestAnimationFrame(() => {
                    renderTabs(true).then(() => {
                        setTimeout(() => scrollToTabById(newTab.id), 100);
                    });
                });
            }
        });

        if(els.restoreBtn) {
            els.restoreBtn.addEventListener('click', async () => {
                try { 
                    if (chrome.sessions?.getRecentlyClosed) {
                        const sessions = await chrome.sessions.getRecentlyClosed();
                        const validSession = sessions.find(s => s.tab && s.lastModified >= Math.floor(currentWsStartTime / 1000));
                        if (validSession) {
                            await chrome.sessions.restore(validSession.tab.sessionId);
                        }
                    } else if (chrome.sessions?.restore) {
                        chrome.sessions.restore(); 
                    }
                } catch(e) { console.error(e); }
            });
        }

        document.addEventListener('keydown', async (e) => {
            if (document.activeElement?.tagName === 'INPUT') return;
            
            if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault(); 
                const num = parseInt(e.key);
                const index = num === 0 ? 9 : num - 1; 
                const cards = Array.from(document.querySelectorAll('.tab-card'));
                
                if (cards[index]) {
                    const tabId = Number(cards[index].dataset.id);
                    await api.activateTab(tabId);
                    cards[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        });

        window.addEventListener('mouseup', () => {
            isSelectionDragging = false;
            if (isDragging) {
                isDragging = false;
                document.querySelectorAll('.tab-card, .pinned-tab-item').forEach(el => {
                    el.classList.remove('dragging', 'sort-target-top', 'sort-target-bottom', 'drag-over');
                });
            }
        });

    } catch (e) { console.error("Init failed:", e); }
});

window.addEventListener('beforeunload', () => {
    stopTimeUpdates();
});