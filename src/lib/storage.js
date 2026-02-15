export const getWorkspaces = async () => {
  const data = await chrome.storage.local.get(['workspaces', 'activeWorkspaceId', 'visibleProjectIds']);
  let workspaces = data.workspaces;
  let activeId = data.activeWorkspaceId;
  let visibleIds = data.visibleProjectIds || [];

  if (!workspaces) {
    workspaces = {};
    const newId = 'ws_default'; 
    workspaces[newId] = { id: newId, name: 'General', tabs: [], lastActive: Date.now() };
    activeId = newId;
    visibleIds = [newId];
    await chrome.storage.local.set({ workspaces, activeWorkspaceId: activeId, visibleProjectIds: visibleIds });
  }

  if (workspaces['ws_default'] && workspaces['ws_default'].name === 'Unsaved') {
      workspaces['ws_default'].name = 'General';
      await chrome.storage.local.set({ workspaces });
  }
  if (!workspaces['ws_default']) {
      workspaces['ws_default'] = { id: 'ws_default', name: 'General', tabs: [], lastActive: 0 };
      await chrome.storage.local.set({ workspaces });
  }

  if (visibleIds.length < 3) {
      const allIds = Object.keys(workspaces).sort((a, b) => workspaces[b].lastActive - workspaces[a].lastActive);
      for (const id of allIds) {
          if (!visibleIds.includes(id)) visibleIds.push(id);
          if (visibleIds.length >= 3) break;
      }
      await chrome.storage.local.set({ visibleProjectIds: visibleIds });
  }

  return { workspaces, activeId, visibleIds };
};

export const updateVisibleProjects = async (newId) => {
    const { visibleIds } = await getWorkspaces();
    if (visibleIds.includes(newId)) return;
    let newVisible = [newId, ...visibleIds];
    newVisible = [...new Set(newVisible)].slice(0, 3);
    await chrome.storage.local.set({ visibleProjectIds: newVisible });
};

export const createWorkspace = async (name) => {
  const { workspaces } = await getWorkspaces();
  const newId = 'ws_' + Date.now();
  workspaces[newId] = { id: newId, name: name, tabs: [], lastActive: Date.now() };
  await chrome.storage.local.set({ workspaces });
  await updateVisibleProjects(newId);
  return newId;
};

export const renameWorkspace = async (workspaceId, newName) => {
  const { workspaces } = await getWorkspaces();
  if (workspaces[workspaceId]) {
    workspaces[workspaceId].name = newName;
    await chrome.storage.local.set({ workspaces });
  }
};

export const deleteWorkspace = async (workspaceId) => {
  let { workspaces, activeId, visibleIds } = await getWorkspaces();
  
  if (workspaceId === 'ws_default') return activeId;

  if (workspaces[workspaceId]) {
      delete workspaces[workspaceId];
      visibleIds = visibleIds.filter(id => id !== workspaceId);
      if (activeId === workspaceId) activeId = 'ws_default';

      await chrome.storage.local.set({ 
          workspaces, 
          activeWorkspaceId: activeId,
          visibleProjectIds: visibleIds 
      });
  }
  return activeId;
};

export const saveTabsToWorkspace = async (workspaceId, tabsData) => {
  const { workspaces } = await getWorkspaces();
  if (workspaces[workspaceId]) {
    workspaces[workspaceId].tabs = tabsData;
    await chrome.storage.local.set({ workspaces });
  }
};

export const setActiveWorkspace = async (id) => {
  const { workspaces } = await getWorkspaces();
  if(workspaces[id]) workspaces[id].lastActive = Date.now();
  await chrome.storage.local.set({ activeWorkspaceId: id, workspaces });
};

export const addTabToWorkspace = async (workspaceId, tab) => {
  const { workspaces } = await getWorkspaces();
  const tabData = { title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl };
  if (workspaces[workspaceId]) {
      if (!workspaces[workspaceId].tabs) workspaces[workspaceId].tabs = [];
      workspaces[workspaceId].tabs.push(tabData);
      await chrome.storage.local.set({ workspaces });
  }
};