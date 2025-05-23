// Chat management functionality

// Global chat state
let currentChatId = null;
let pendingClear = false;

/**
 * Refresh the chat list in the sidebar
 */
async function refreshChatList() {
  const res = await fetch('/api/list_chats');
  const data = await res.json();
  const chatList = document.getElementById('chatList');
  
  // Sort chats by creation timestamp, newest first
  data.chats.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  chatList.innerHTML = '';
  
  data.chats.forEach((c, idx) => {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    li.onclick = () => loadChat(c.id);
    
    // Highlight active chat
    if (c.id === currentChatId) {
      li.classList.add('active');
    }

    // Determine label: use title if set, otherwise reverse-number by creation order
    const display = c.title && c.title.trim()
      ? c.title
      : `Chat #${data.chats.length - idx}`;

    const titleDiv = document.createElement('div');
    titleDiv.textContent = display;

    const dateDiv = document.createElement('div');
    dateDiv.textContent = new Date(c.created_at).toLocaleString();
    dateDiv.style.fontSize = '0.8em';
    dateDiv.style.color = 'var(--text-muted)';

    li.appendChild(titleDiv);
    li.appendChild(dateDiv);
    chatList.appendChild(li);
  });
}

/**
 * Load a specific chat
 */
async function loadChat(id) {
  if (!maybeClearChat(true)) return;
  
  const res = await fetch('/api/load_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  
  if (!res.ok) { 
    alert('Failed to load chat'); 
    return; 
  }
  
  const data = await res.json();
  const log = document.getElementById('log');
  const modelSelect = document.getElementById('modelSelect');
  const chatList = document.getElementById('chatList');
  
  currentChatId = data.id;
  document.querySelectorAll('#chatList li').forEach(li => li.classList.remove('active'));
  const activeLi = document.querySelector(`#chatList li[data-id="${id}"]`);
  if (activeLi) activeLi.classList.add('active');
  
  if (data.model && models[data.model]) {
    modelSelect.value = data.model;
    prevModel = data.model;
    updateImageVisibility(models[data.model]);
  }
  
  log.innerHTML = '';
  clearImagePreviews();
  
  data.messages.forEach(m => {
    // ---- render text ----
    const div = append(renderMarkdown(m.content),
                       m.role === 'user' ? 'user' : 'assistant');

    // ---- render any saved images ----
    if (m.images && m.images.length) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'chat-images';
      imgWrap.style.display = 'flex';
      imgWrap.style.flexWrap = 'wrap';
      imgWrap.style.gap = '1rem';
      m.images.forEach(src => {
        const im = document.createElement('img');
        im.src = src;
        im.className = 'chat-preview';
        imgWrap.appendChild(im);
      });
      div.appendChild(imgWrap);
    }

    // ---- replay minimal context to the server, now including images ----
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        restore: {
          role: m.role,
          content: m.content,
          images: m.images || []
        }
      }));
    }
  });
  
  // Show last user-sent images in the image-container preview
  const lastUserMsg = data.messages.slice().reverse().find(m => m.role === 'user' && m.images && m.images.length);
  if (lastUserMsg) {
    clearImagePreviews();
    lastUserMsg.images.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      img.className = 'chat-preview';
      document.getElementById('image-container').appendChild(img);
    });
  }
}

/**
 * Clear the current chat with optional confirmation
 */
function maybeClearChat(skipConfirm = false) {
  const log = document.getElementById('log');
  
  if (log.children.length === 0) return true;
  if (skipConfirm || confirm('Clear the current draft conversation?')) {
    pendingClear = true;
    if (ws.readyState === WebSocket.OPEN) ws.send(CLEAR_CMD);
    log.innerHTML = '';
    return true;
  }
  return false;
}

/**
 * Initialize chat management event handlers
 */
function initChatHandlers() {
  const newChatBtn = document.getElementById('newChatBtn');
  const clearBtn = document.getElementById('clearBtn');
  const renameBtn = document.getElementById('renameBtn');
  const deleteBtn = document.getElementById('deleteBtn');

  newChatBtn.addEventListener('click', async () => {
    if (!prevModel) { 
      alert('Select a model first'); 
      return; 
    }
    const res = await fetch('/api/new_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: prevModel })
    });
    if (!res.ok) { 
      alert('Failed to create new chat'); 
      return; 
    }
    const { id } = await res.json();
    currentChatId = id;
    document.getElementById('log').innerHTML = '';
    clearImagePreviews();
    await refreshChatList();
  });

  clearBtn.addEventListener('click', () => {
    const log = document.getElementById('log');
    if (log.children.length === 0) return;
    if (!confirm('Clear the chat history?')) return;
    pendingClear = true;
    if (ws.readyState === WebSocket.OPEN) ws.send(CLEAR_CMD);
    log.innerHTML = '';
    clearImagePreviews();
  });

  renameBtn.addEventListener('click', async () => {
    if (!currentChatId) { 
      alert('No chat selected'); 
      return; 
    }
    const newTitle = prompt('Enter new chat name:', '');
    if (newTitle && newTitle.trim()) {
      const res = await fetch('/api/rename_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentChatId, title: newTitle.trim() })
      });
      if (res.ok) {
        await refreshChatList();
      } else {
        alert('Failed to rename chat');
      }
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentChatId) { 
      alert('No chat selected'); 
      return; 
    }
    if (!confirm('Delete this chat permanently?')) return;
    const res = await fetch('/api/delete_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentChatId })
    });
    if (!res.ok) { 
      alert('Failed to delete chat'); 
      return; 
    }
    currentChatId = null;
    document.getElementById('log').innerHTML = '';
    clearImagePreviews();
    await refreshChatList();
    
    // Move to newest chat if any, otherwise create a fresh one
    const chatList = document.getElementById('chatList');
    const firstLi = chatList.querySelector('li');
    if (firstLi) {
      loadChat(firstLi.dataset.id);
    } else if (prevModel) {
      newChatBtn.click();
    }
  });
}
