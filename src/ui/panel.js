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
  bulkIndexInput: document.getElementById('tab-index-input'),
  bulkIndexSelector: document.getElementById('tab-index-selector'),
  pinnedBar: document.getElementById('pinned-bar'),
  pinnedTabsScroll: document.getElementById('pinned-tabs-scroll'),
  restoreBtn: document.getElementById('restore-btn')
};

// Global State
let draggingTabId = null;
let draggingTabPinned = false;
let editingWorkspaceId = null;
let isSwitchingProgrammatically = false; 
let isSelectionDragging = false;
let selectionTargetState = false;
let draggedProject = null;
let isDragging = false;
let dragTimeout = null;
let tabIndexSelector = null;

// --- Helper Functions ---

function formatTimeAgo(timestamp) {
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
    return 'Active now';
}

function getFaviconUrl(tabUrl) {
    if (tabUrl) {
        const url = new URL(chrome.runtime.getURL("/_favicon/"));
        url.searchParams.set("pageUrl", tabUrl);
        url.searchParams.set("size", "32");
        return url.toString();
    }
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239ca3af'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3C/svg%3E";
}

// --- Drag Logic ---

function startDrag(id, isPinned) {
    draggingTabId = id;
    draggingTabPinned = isPinned;
    isDragging = true;
    document.body.classList.add('is-dragging-tab');
    
    // Auto-reset if drag gets stuck
    clearTimeout(dragTimeout);
    dragTimeout = setTimeout(endDrag, 5000);
}

function endDrag() {
    clearTimeout(dragTimeout);
    draggingTabId = null;
    draggingTabPinned = false;
    isDragging = false;
    document.body.classList.remove('is-dragging-tab');
    
    // Clear visual styles
    document.querySelectorAll('.tab-card').forEach(el => {
        el.style.opacity = '1';
        el.classList.remove('sort-target-top', 'sort-target-bottom');
    });
    document.querySelectorAll('.pinned-tab-item').forEach(el => {
        el.style.opacity = '1';
        el.classList.remove('drag-over');
    });
    
    if(els.pinnedBar) els.pinnedBar.style.backgroundColor = '';
    if(els.tabsList) els.tabsList.classList.remove('drag-over-pinned');
    
    renderTabs();
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  const savedManageMode = localStorage.getItem('manageMode');
  if (savedManageMode === 'on') {
      els.masterToggle.checked = true;
      els.managementPanel.classList.add('visible');
  } else {
      document.body.classList.add('manage-mode-off');
  }

  try {
      await syncGeneralOnLoad();
      await renderWorkspacesBar();
      await renderTabs();
      updateOmnibox();
      
      if(els.searchInput) els.searchInput.focus();
      
      // Updates from Chrome
      api.subscribeToUpdates(() => { 
          if (!isDragging) {
              renderTabs(); 
              updateOmnibox();
          }
      });

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
              }

              if (targetWsId !== activeId) {
                  await storage.setActiveWorkspace(targetWsId);
                  renderWorkspacesBar();
                  renderTabs();
                  if (tab.groupId !== -1) await api.focusOnGroup(tab.groupId);
              } else {
                  if (!isDragging) renderTabs();
              }
              // Force focus for 1-9 shortcuts
              setTimeout(() => window.focus(), 50);
          } catch(e) {}
      });

      chrome.tabs.onCreated.addListener(() => {
          if (!isDragging) setTimeout(renderTabs, 200);
      });

      // Restore Button
      els.restoreBtn?.addEventListener('click', async () => {
          if (chrome.sessions && chrome.sessions.restore) {
              try {
                  const restored = await chrome.sessions.restore();
                  console.log('Tab restored:', restored);
              } catch (e) {
                  console.warn("Restore failed:", e);
              }
          } else {
              console.warn("Sessions API permission missing.");
          }
      });

      // Keyboard Shortcuts (1-9)
      document.addEventListener('keydown', (e) => {
          if (document.activeElement.tagName === 'INPUT') return;
          if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              const num = parseInt(e.key);
              const index = num === 0 ? 9 : num - 1; 
              const cards = document.querySelectorAll('.tab-card');
              if (cards[index]) {
                  const id = cards[index].dataset.id;
                  api.activateTab(Number(id));
              }
          }
      });

      // Focus grabbing
      document.body.setAttribute('tabindex', '-1');
      document.body.addEventListener('mouseenter', () => window.focus());
      document.body.addEventListener('click', () => window.focus());

      // Global mouseup to safety clear drag
      window.addEventListener('mouseup', () => {
          isSelectionDragging = false;
          if (isDragging) endDrag();
      });
      
      // Global mouseleave to cancel selection drag if mouse leaves window
      document.addEventListener('mouseleave', () => {
          isSelectionDragging = false;
      });

  } catch (e) {
      console.error("Init failed:", e);
  }
});

// --- Management Logic ---

function updateManagementPanel() {
    if (!els.managementPanel) return;
    const checked = document.querySelectorAll('.tab-check-box:checked');
    const count = checked.length;
    const allBoxes = document.querySelectorAll('.tab-check-box');
    
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
    
    els.managementPanel.classList.remove('single-selected', 'dual-selected');
    if (count === 1) {
        els.managementPanel.classList.add('single-selected');
        // Update index input visibility
        if (els.bulkIndexInput) {
            els.bulkIndexInput.style.opacity = '1';
            els.bulkIndexInput.style.pointerEvents = 'auto';
        }
    } else if (count === 2) {
        els.managementPanel.classList.add('dual-selected');
    }
    
    // Hide index input when not single selection
    if (count !== 1 && els.bulkIndexInput) {
        els.bulkIndexInput.style.opacity = '0.3';
        els.bulkIndexInput.style.pointerEvents = 'none';
    }
}

async function handleBulkAction(action) {
    const checked = document.querySelectorAll('.tab-check-box:checked');
    const ids = Array.from(checked).map(cb => Number(cb.closest('.tab-card').dataset.id));
    if (ids.length === 0) return;

    if (action === 'delete') {
        await api.closeTab(ids);
    } else if (action === 'closeAbove' || action === 'closeBelow') {
        const currentId = ids[0];
        const cards = Array.from(document.querySelectorAll('.tab-card'));
        const targetIndex = cards.findIndex(c => Number(c.dataset.id) === currentId);
        let idsToClose = action === 'closeAbove' 
            ? cards.slice(0, targetIndex).map(c => Number(c.dataset.id))
            : cards.slice(targetIndex + 1).map(c => Number(c.dataset.id));
        await api.closeTab(idsToClose);
    } else if (action === 'split') {
        if (ids.length === 2) await api.tileTwoTabs(ids[0], ids[1]);
    } else if (action === 'incognito') {
        await api.openInIncognito(ids);
    } else if (action === 'setIndex') {
        // Action for setting tab index with number
        if (ids.length === 1) {
            const targetIndex = action.index || 0;
            await api.moveTab(ids, targetIndex);
        }
    }
    updateManagementPanel();
}

async function setupBulkMoveDropdown() {
    const { workspaces } = await storage.getWorkspaces();
    [els.bulkMoveDropdown, els.bulkCopyDropdown].forEach((dropdown, idx) => {
        if (!dropdown) return;
        dropdown.innerHTML = '';
        Object.values(workspaces).forEach(ws => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.innerText = ws.name;
            item.onclick = async () => {
                const checked = document.querySelectorAll('.tab-check-box:checked');
                const ids = Array.from(checked).map(cb => cb.closest('.tab-card').dataset.id);
                if (idx === 0) await api.moveTabsToGroup(ids, ws.name);
                else await api.copyTabsToGroup(ids, ws.name);
                renderTabs();
            };
            dropdown.appendChild(item);
        });
    });
}

function setupTabIndexInput() {
    if (!els.bulkIndexInput || !els.bulkIndexSelector) return;
    
    // Create number items
    els.bulkIndexSelector.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
        const item = document.createElement('div');
        item.className = 'tab-index-item';
        item.textContent = i === 10 ? '0' : i.toString();
        item.dataset.value = i.toString();
        els.bulkIndexSelector.appendChild(item);
    }
    
    // Input click handler
    els.bulkIndexInput.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.tab-check-box:checked');
        if (checked.length === 1) {
            const currentIndex = parseInt(els.bulkIndexInput.value) || 1;
            const targetIndex = currentIndex - 1; // Convert to 0-based
            
            const checkedIds = Array.from(document.querySelectorAll('.tab-check-box:checked'))
                .map(cb => cb.closest('.tab-card').dataset.id);
            
            await api.moveTab(checkedIds[0], targetIndex);
            renderTabs();
        }
    });
    
    // Mouse wheel handler
    els.bulkIndexInput.addEventListener('wheel', (e) => {
        e.preventDefault();
        const checked = document.querySelectorAll('.tab-check-box:checked');
        if (checked.length !== 1) return;
        
        let currentValue = parseInt(els.bulkIndexInput.value) || 1;
        if (e.deltaY < 0) {
            currentValue = Math.max(1, currentValue - 1);
        } else {
            currentValue = Math.min(10, currentValue + 1);
        }
        
        els.bulkIndexInput.value = currentValue;
        updateIndexSelectorPosition(currentValue);
    });
    
    // Initialize position
    updateIndexSelectorPosition(parseInt(els.bulkIndexInput.value) || 1);
}

function updateIndexSelectorPosition(value) {
    if (!els.bulkIndexSelector) return;
    
    const items = els.bulkIndexSelector.querySelectorAll('.tab-index-item');
    const targetIndex = (value - 1) % 10;
    
    items.forEach((item, index) => {
        item.classList.toggle('active', index === targetIndex);
    });
    
    // Calculate scroll position to show the active item in center
    const itemHeight = 48; // Approximate height of each item
    const scrollTop = targetIndex * itemHeight - (itemHeight * 1.5); // Center the item
    els.bulkIndexSelector.scrollTop = Math.max(0, scrollTop);
}

async function syncGeneralOnLoad() {
    const { activeId } = await storage.getWorkspaces();
    if (activeId === 'ws_default') {
        const tabs = await api.getTabs();
        const generalTabs = tabs.filter(t => t.groupId === -1);
        await storage.saveTabsToWorkspace('ws_default', generalTabs);
    }
}

// --- Render Logic ---

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
        item.dataset.tooltip = tab.title;
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
                api.closeTab(tab.id);
                return;
            }
            api.activateTab(tab.id);
        };
        
        // Drag Handling
        item.ondragstart = (e) => {
            startDrag(tab.id, true);
            e.dataTransfer.setData('text/plain', JSON.stringify([tab.id]));
            e.dataTransfer.effectAllowed = 'move';
            item.style.opacity = '0.4';
        };
        
        item.ondragend = () => endDrag();
        
        // Reordering within Pinned Bar
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
                await api.moveTab([Number(draggingTabId)], index);
            }
        };
        
        els.pinnedTabsScroll.appendChild(item);
    });
    
    // DROP ZONE: PINNED BAR (Pinning new tab)
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
        if (draggingTabId) {
            // Explicitly PIN the tab
            await chrome.tabs.update(Number(draggingTabId), { pinned: true });
        }
    };
    
    // DROP ZONE: TABS LIST (Unpinning)
    els.tabsList.ondragover = (e) => {
        if (draggingTabPinned) {
            e.preventDefault();
            els.tabsList.classList.add('drag-over-pinned');
        }
    };
    els.tabsList.ondragleave = () => els.tabsList.classList.remove('drag-over-pinned');
    els.tabsList.ondrop = async (e) => {
        if (draggingTabPinned) {
            e.preventDefault();
            els.tabsList.classList.remove('drag-over-pinned');
            // Explicitly UNPIN the tab
            await chrome.tabs.update(Number(draggingTabId), { pinned: false });
        }
    };
}

async function renderTabs() {
    if (isDragging) return;

    const tabs = await api.getTabs();
    const { activeId, workspaces } = await storage.getWorkspaces();
    
    if (!workspaces || !workspaces[activeId]) return;
    const currentWs = workspaces[activeId];

    els.tabsList.innerHTML = '';
    
    let visibleTabs = [];
    if (activeId === 'ws_default') {
        const group = await api.findGroup("General");
        if (group) visibleTabs = tabs.filter(t => t.groupId === group.id);
        else visibleTabs = tabs.filter(t => t.groupId === -1);
    } else {
        const group = await api.findGroup(currentWs.name);
        if (group) visibleTabs = tabs.filter(t => t.groupId === group.id);
    }

    const pinnedTabs = visibleTabs.filter(t => t.isPinned);
    const unpinnedTabs = visibleTabs.filter(t => !t.isPinned);
    
    renderPinnedBar(pinnedTabs);
    
    const lastIndex = unpinnedTabs.length - 1;
    unpinnedTabs.forEach((tab, index) => {
        els.tabsList.appendChild(createTabElement(tab, index, lastIndex));
    });
    
    const newTabBtn = document.createElement('div');
    newTabBtn.className = 'new-tab-bottom-btn';
    newTabBtn.innerHTML = '<span>+</span> New Tab';
    newTabBtn.onclick = () => api.createTabAtIndex(visibleTabs.length, true);
    els.tabsList.appendChild(newTabBtn);
    
    handleSearchInput();
    updateManagementPanel();
}

function createTabElement(tab, index, lastIndex) {
    const div = document.createElement('div');
    div.className = `tab-card ${tab.isActive ? 'active' : ''}`;
    div.draggable = true;
    div.dataset.id = tab.id;
    
    // Drag events - prevent drag from checkbox area only
    div.ondragstart = (e) => { 
        if(e.target.closest('.tab-check-wrapper')) {
            e.preventDefault(); 
            return;
        }
        const checkbox = div.querySelector('.tab-check-box');
        if (checkbox?.checked) {
            const ids = Array.from(document.querySelectorAll('.tab-check-box:checked')).map(cb => cb.closest('.tab-card').dataset.id);
            e.dataTransfer.setData('text/plain', JSON.stringify(ids));
        } else {
            e.dataTransfer.setData('text/plain', JSON.stringify([tab.id]));
        }
        startDrag(tab.id, false);
        div.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
    };
    
    div.ondragend = () => endDrag();
    
    div.ondragover = (e) => { 
        e.preventDefault(); 
        if(draggingTabId === tab.id) return;
        const rect = div.getBoundingClientRect(); 
        div.classList.remove('sort-target-top', 'sort-target-bottom');
        if (e.clientY < rect.top + rect.height/2) div.classList.add('sort-target-top');
        else div.classList.add('sort-target-bottom');
    };
    
    div.ondragleave = () => div.classList.remove('sort-target-top', 'sort-target-bottom');
    
    div.ondrop = async (e) => { 
        e.preventDefault(); 
        div.classList.remove('sort-target-top', 'sort-target-bottom'); 
        if (draggingTabPinned) return; // Handled by container drop

        const rect = div.getBoundingClientRect(); 
        const newIndex = e.clientY >= rect.top + rect.height/2 ? tab.index + 1 : tab.index; 
        
        try {
            const ids = JSON.parse(e.dataTransfer.getData('text/plain'));
            if(ids?.length) await api.moveTab(ids.map(Number), newIndex);
        } catch(err) {}
    };

    // Checkbox
    const checkWrapper = document.createElement('div');
    checkWrapper.className = 'tab-check-wrapper';
    
    if (index < 10) {
        const badge = document.createElement('kbd');
        badge.className = 'shortcut-badge';
        badge.innerText = index === 9 ? '0' : (index + 1);
        div.appendChild(badge);
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tab-check-box';
    checkbox.addEventListener('click', (e) => { e.stopPropagation(); updateManagementPanel(); });

    checkWrapper.addEventListener('mousedown', (e) => {
        if (e.target === checkbox) return;
        e.stopPropagation(); e.preventDefault();
        // Only start selection drag if left mouse button is pressed
        if (e.button === 0) {
            isSelectionDragging = true;
            selectionTargetState = !checkbox.checked;
            checkbox.checked = selectionTargetState;
            updateManagementPanel();
        }
    });
    checkWrapper.addEventListener('mouseenter', () => {
        // Only update checkbox if mouse button is still pressed
        if (isSelectionDragging && e.buttons === 1) {
            checkbox.checked = selectionTargetState;
            updateManagementPanel();
        }
    });
    checkWrapper.appendChild(checkbox);
    
    const divider = document.createElement('div');
    divider.className = 'tab-divider';

    // Audio
    const hasAudio = tab.audible || tab.mutedInfo?.muted;
    const isMuted = tab.mutedInfo?.muted;
    let audioHtml = '';
    if (hasAudio) {
        const audioIcon = isMuted 
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>` 
            : `<div class="audio-wave"><div class="audio-bar"></div><div class="audio-bar"></div><div class="audio-bar"></div></div>`;
        audioHtml = `<div class="audio-indicator ${isMuted ? 'muted' : ''}" data-tooltip="${isMuted ? 'Unmute' : 'Mute'}" data-tooltip-pos="up">${audioIcon}</div>`;
    }

    const timeAgoText = tab.isActive ? 'Active now' : formatTimeAgo(tab.lastAccessed);

    const contentHtml = `
        <img src="${getFaviconUrl(tab.url)}" class="tab-icon">
        <div class="tab-info">
            <div class="tab-title">${tab.title}</div>
            <div class="tab-meta">${timeAgoText}</div>
        </div>
        <div class="tab-actions">
            <button class="tab-action-btn pin-btn" data-tooltip="Pin tab" data-tooltip-pos="up">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z"/>
                </svg>
            </button>
            <button class="tab-action-btn incognito-btn" data-tooltip="Open in Incognito" data-tooltip-pos="up">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5c-7 0 -10 7 -10 7s3 7 10 7s10 -7 10 -7s-3 -7 -10 -7z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M3 3l18 18"></path>
                </svg>
            </button>
            <button class="tab-action-btn duplicate-btn" data-tooltip="Duplicate" data-tooltip-pos="up">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
            ${audioHtml}
            <button class="tab-action-btn close-btn" data-tooltip="Close" data-tooltip-pos="up">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `;
    
    div.appendChild(checkWrapper);
    div.appendChild(divider);
    div.insertAdjacentHTML('beforeend', contentHtml);

    // Hover Add Buttons
    if (tab.isActive) {
        const btnTop = document.createElement('div');
        btnTop.className = 'add-tab-btn top';
        btnTop.onclick = (e) => { e.stopPropagation(); api.createTabAtIndex(tab.index, true, tab.id); };
        
        let btnBottom = null;
        if (index !== lastIndex) {
            btnBottom = document.createElement('div');
            btnBottom.className = 'add-tab-btn bottom';
            btnBottom.onclick = (e) => { e.stopPropagation(); api.createTabAtIndex(tab.index + 1, true, tab.id); };
        }

        const showTop = () => { btnTop.classList.add('visible'); btnBottom?.classList.remove('visible'); div.classList.add('gradient-top'); div.classList.remove('gradient-bottom'); };
        const showBottom = () => { if(btnBottom) { btnTop.classList.remove('visible'); btnBottom.classList.add('visible'); div.classList.remove('gradient-top'); div.classList.add('gradient-bottom'); }};
        const clearAll = () => { btnTop.classList.remove('visible'); btnBottom?.classList.remove('visible'); div.classList.remove('gradient-top', 'gradient-bottom'); };

        div.onmousemove = (e) => {
            if (isSelectionDragging) return;
            const rect = div.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            if (x < 60) { y < rect.height / 2 ? showTop() : showBottom(); } else { clearAll(); }
        };
        
        btnTop.onmouseenter = showTop;
        btnBottom?.addEventListener('mouseenter', showBottom);
        div.onmouseleave = clearAll;

        div.appendChild(btnTop);
        if(btnBottom) div.appendChild(btnBottom);
    }
    
    div.onclick = (e) => {
        if (e.target.closest('.tab-check-wrapper, .add-tab-btn, .tab-action-btn, .audio-indicator, .tab-info')) return;
        api.activateTab(tab.id);
    };

    div.querySelector('.pin-btn').onclick = (e) => { e.stopPropagation(); api.togglePinTab(tab.id, tab.isPinned); };
    div.querySelector('.incognito-btn').onclick = (e) => { e.stopPropagation(); api.openInIncognito([tab.id]); };
    div.querySelector('.duplicate-btn').onclick = (e) => { e.stopPropagation(); api.duplicateTab(tab.id); };
    div.querySelector('.audio-indicator')?.addEventListener('click', (e) => { e.stopPropagation(); api.toggleMuteTab(tab.id, isMuted); });
    div.querySelector('.close-btn').onclick = (e) => { e.stopPropagation(); div.style.opacity = '0'; setTimeout(() => div.remove(), 100); api.closeTab(tab.id); };
    
    return div;
}

// --- Rest of the UI functions (Events, Dialogs) ---

function setupEventListeners() {
    els.navBack?.addEventListener('click', async () => { const [t] = await chrome.tabs.query({active:true, currentWindow:true}); t && chrome.tabs.goBack(t.id); });
    els.navForward?.addEventListener('click', async () => { const [t] = await chrome.tabs.query({active:true, currentWindow:true}); t && chrome.tabs.goForward(t.id); });
    els.navReload?.addEventListener('click', async () => { const [t] = await chrome.tabs.query({active:true, currentWindow:true}); t && chrome.tabs.reload(t.id); });
    
    els.omnibox?.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            let u = els.omnibox.value;
            u = (!u.includes('.') || u.includes(' ')) ? `https://google.com/search?q=${encodeURIComponent(u)}` : (!u.startsWith('http') ? 'https://'+u : u);
            const [t] = await chrome.tabs.query({active:true, currentWindow:true});
            t ? await chrome.tabs.update(t.id, {url: u}) : await chrome.tabs.create({url: u});
        }
    });

    els.createWsBtn?.addEventListener('click', () => openDialog('create'));
    els.cancelCreateBtn?.addEventListener('click', () => els.dialog.close());
    els.dialogSubmitBtn?.addEventListener('click', submitDialog);
    els.newWsName?.addEventListener('keydown', e => e.key === 'Enter' && submitDialog());
    
    document.addEventListener('click', (e) => {
        if (!els.settingsMenu.contains(e.target) && e.target !== els.settingsBtn) els.settingsMenu.classList.remove('open');
        if (!els.projectsDropdown.contains(e.target) && e.target !== els.allWsBtn) els.projectsDropdown.classList.remove('open');
    });
    
    els.settingsBtn?.addEventListener('click', e => { e.stopPropagation(); els.projectsDropdown.classList.remove('open'); els.settingsMenu.classList.toggle('open'); });
    els.allWsBtn?.addEventListener('click', e => { 
        e.stopPropagation(); els.settingsMenu.classList.remove('open'); els.projectsDropdown.classList.toggle('open');
        if (els.projectsDropdown.classList.contains('open')) { renderAllProjectsList(); setTimeout(() => els.projectSearch?.focus(), 100); }
    });
    
    els.zenModeBtn?.addEventListener('click', async () => updateZenIcon(await api.toggleZenMode()));
    
    const theme = localStorage.getItem('theme') || 'light';
    els.html.className = `${theme}-theme`;
    document.querySelector(`input[name="themes"][value="${theme}"]`).checked = true;
    els.themeRadios.forEach(r => r.addEventListener('change', () => { els.html.className = `${r.value}-theme`; localStorage.setItem('theme', r.value); }));
    
    els.projectSearch?.addEventListener('input', renderAllProjectsList);
    els.searchInput?.addEventListener('input', handleSearchInput);
    
    els.masterToggle?.addEventListener('change', e => {
        document.body.classList.toggle('manage-mode-off', !e.target.checked);
        els.managementPanel.classList.toggle('visible', e.target.checked);
        localStorage.setItem('manageMode', e.target.checked ? 'on' : 'off');
        if (!e.target.checked) {
            document.querySelectorAll('.tab-check-box:checked').forEach(c => c.checked = false);
            updateManagementPanel();
        }
    });
    
    els.masterCheck?.addEventListener('click', e => {
        document.querySelectorAll('.tab-check-box').forEach(c => c.checked = e.target.checked);
        updateManagementPanel();
    });
    
    ['delete','split','incognito','closeAbove','closeBelow'].forEach(a => 
        els[`bulk${a.charAt(0).toUpperCase()+a.slice(1)}`]?.addEventListener('click', () => handleBulkAction(a))
    );
    els.bulkMoveBtn?.addEventListener('mouseenter', setupBulkMoveDropdown);
    els.bulkCopyBtn?.addEventListener('mouseenter', setupBulkMoveDropdown);
    // Tab Index Input Handler
    setupTabIndexInput();
}

function openDialog(mode, ws) {
    editingWorkspaceId = mode === 'edit' ? ws.id : null;
    els.dialogTitle.innerText = mode === 'edit' ? 'Rename Workspace' : 'New Workspace';
    els.dialogSubmitBtn.innerText = mode === 'edit' ? 'Save' : 'Create';
    els.newWsName.value = mode === 'edit' ? ws.name : '';
    els.dialog.showModal(); setTimeout(() => els.newWsName.focus(), 50);
}

async function switchWorkspace(id) {
    isSwitchingProgrammatically = true;
    try {
        const { workspaces, activeId } = await storage.getWorkspaces();
        if (id === activeId) {
            const g = await api.findGroup(workspaces[id].name);
            if (g) await api.focusOnGroup(g.id);
        } else {
            await storage.setActiveWorkspace(id);
            await storage.updateVisibleProjects(id);
            if (id === 'ws_default') {
                const g = await api.groupAllUngroupedTabs();
                if (g) { await api.focusOnGroup(g); await api.activateFirstTabInGroup(g); }
            } else {
                const g = await api.findGroup(workspaces[id].name) || await api.createNewProjectGroup(workspaces[id].name);
                await api.focusOnGroup(g.id || g);
                if (g.id) await api.activateFirstTabInGroup(g.id);
            }
        }
        renderWorkspacesBar(); renderTabs();
    } catch(e) { console.error(e); }
    finally { setTimeout(() => isSwitchingProgrammatically = false, 500); }
}

async function renderAllProjectsList() {
    const { workspaces, visibleIds } = await storage.getWorkspaces();
    els.allProjectsList.innerHTML = '';
    const filter = els.projectSearch?.value.toLowerCase();
    Object.keys(workspaces).sort((a,b) => {
        const [ia, ib] = [visibleIds.indexOf(a), visibleIds.indexOf(b)];
        return (ia > -1 && ib > -1) ? ia - ib : (ia > -1 ? -1 : (ib > -1 ? 1 : 0));
    }).forEach(id => {
        if (id === 'ws_default' || (filter && !workspaces[id].name.toLowerCase().includes(filter))) return;
        const row = document.createElement('div');
        row.className = 'project-row'; row.innerText = workspaces[id].name;
        if (visibleIds.includes(id)) row.style.fontWeight = 'bold';
        row.onclick = () => switchWorkspace(id);
        els.allProjectsList.appendChild(row);
    });
}

async function submitDialog() {
    const name = els.newWsName.value.trim();
    if (!name) return;
    if (editingWorkspaceId) await storage.renameWorkspace(editingWorkspaceId, name);
    else {
        await api.groupAllUngroupedTabs();
        const id = await storage.createWorkspace(name);
        await api.focusOnGroup(await api.createNewProjectGroup(name));
        await storage.setActiveWorkspace(id);
    }
    els.dialog.close(); renderWorkspacesBar(); renderTabs();
}

async function renderWorkspacesBar() {
    const { workspaces, activeId, visibleIds } = await storage.getWorkspaces();
    els.wsBar.innerHTML = '';
    let list = [...visibleIds];
    if (!list.includes(activeId)) list = [activeId, ...list.slice(0, 3)];
    
    list.forEach(id => {
        const ws = workspaces[id]; if (!ws) return;
        const btn = document.createElement('button');
        btn.className = `ws-btn ${id === activeId ? 'active' : ''}`;
        btn.innerHTML = `<span>${ws.name}</span>`;
        if (id === activeId && id !== 'ws_default') {
            const i = document.createElement('div'); i.className = 'edit-ws-icon';
            i.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
            i.onclick = e => { e.stopPropagation(); openDialog('edit', ws); };
            btn.appendChild(i);
        }
        btn.onclick = () => switchWorkspace(id);
        if (id !== activeId) {
            btn.ondragover = e => { e.preventDefault(); btn.classList.add('drag-over'); };
            btn.ondragleave = () => btn.classList.remove('drag-over');
            btn.ondrop = async e => { e.preventDefault(); btn.classList.remove('drag-over'); if(draggingTabId) await api.addTabToGroupByName(+draggingTabId, ws.name); };
        }
        els.wsBar.appendChild(btn);
    });
}

function handleSearchInput() {
    const f = els.searchInput?.value.toLowerCase();
    els.tabsList.querySelectorAll('.tab-card').forEach(c => c.classList.toggle('hidden', !c.querySelector('.tab-title').innerText.toLowerCase().includes(f)));
}

async function updateOmnibox() {
    try { const [t] = await chrome.tabs.query({active:true,currentWindow:true}); if(t?.url && document.activeElement !== els.omnibox) els.omnibox.value = t.url; } catch(e){}
}

function updateZenIcon(full) {
    els.zenModeBtn.innerHTML = full ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path></svg>` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>`;
}