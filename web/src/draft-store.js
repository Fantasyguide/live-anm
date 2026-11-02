// 当前浏览器只保留最近一份编辑文档；直接存原文和二进制，不经 ANM 汇编。
export function captureDraft(doc, fileName, syntaxView, unexportedChanges) {
  return { doc: structuredClone(doc), fileName, syntaxView, unexportedChanges, savedAt: Date.now() };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('当前浏览器无法使用本机草稿存储')); return; }
    const request = indexedDB.open('live-anm', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function accessDraft(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('drafts', mode);
      const request = action(tx.objectStore('drafts'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('本机草稿存储操作失败'));
      };
    } catch (error) { db.close(); reject(error); }
  });
}

export const readDraft = () => accessDraft('readonly', (store) => store.get('latest'));
export const writeDraft = (draft) => accessDraft('readwrite', (store) => store.put(draft, 'latest'));
export const deleteDraft = () => accessDraft('readwrite', (store) => store.delete('latest'));
