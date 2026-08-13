// ===== db.js =====
const DB_NAME = "FieldScanOfflineDB";
const STORE_NAME = "syncQueue";
const SNAG_PHOTO_STORE = "snagPhotos";
const SNAG_PHOTO_V2_STORE = "snagPhotosV2";

let dbPromise = null;

function openQueueDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 5);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      if (!db.objectStoreNames.contains(SNAG_PHOTO_STORE))
        db.createObjectStore(SNAG_PHOTO_STORE, { keyPath: "snagId" });
      // v2: one record per photo (not one blob-string per snag), so each
      // photo can carry its own full image, thumbnail, and sync state —
      // needed to support "full photo moves to desktop, thumbnail stays
      // on phone" once transferred.
      if (!db.objectStoreNames.contains(SNAG_PHOTO_V2_STORE))
        db.createObjectStore(SNAG_PHOTO_V2_STORE, { keyPath: "id" });
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = (e) => {
      dbPromise = null;
      reject(e.target.error);
    };
  });
  return dbPromise;
}

async function queueOfflineRequest(action, data) {
  const db = await openQueueDB();
  // The new backend supports idempotent replay: if this exact write is
  // sent, the response is lost (tab closed, connection dropped after the
  // server applied it but before the client heard back), and syncQueuedRequests
  // retries it, the server recognizes the SAME mutationId and returns the
  // original result instead of applying the write a second time. Generated
  // once here, at the moment the action is queued -- not on each retry --
  // so every retry of this same queued item carries the same id.
  const mutationId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataWithMutationId = { ...data, mutationId };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add({
      action,
      data: dataWithMutationId,
      timestamp: Date.now(),
      retryCount: 0,
      lastError: "",
      lastAttempt: "",
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getQueuedRequests() {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteQueuedRequest(id) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateQueuedRequest(id, updates) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) {
        resolve();
        return;
      }
      store.put({ ...req.result, ...updates });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function saveSnagPhotosLocally(snagId, photoDataString) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAG_PHOTO_STORE, "readwrite");
    tx.objectStore(SNAG_PHOTO_STORE).put({
      snagId,
      photoData: photoDataString,
      savedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSnagPhotosLocally(snagId) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(SNAG_PHOTO_STORE, "readonly")
      .objectStore(SNAG_PHOTO_STORE)
      .get(snagId);
    req.onsuccess = () => resolve(req.result ? req.result.photoData : "");
    req.onerror = () => reject(req.error);
  });
}

async function deleteSnagPhotosLocally(snagId) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAG_PHOTO_STORE, "readwrite");
    tx.objectStore(SNAG_PHOTO_STORE).delete(snagId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== Snag photos v2 (per-photo, full + thumbnail) =====

async function saveSnagPhotoV2(record) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAG_PHOTO_V2_STORE, "readwrite");
    tx.objectStore(SNAG_PHOTO_V2_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSnagPhotosV2(snagId) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(SNAG_PHOTO_V2_STORE, "readonly")
      .objectStore(SNAG_PHOTO_V2_STORE)
      .getAll();
    req.onsuccess = () =>
      resolve(
        req.result
          .filter((r) => r.snagId === snagId)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
    req.onerror = () => reject(req.error);
  });
}

async function getAllSnagPhotosV2() {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(SNAG_PHOTO_V2_STORE, "readonly")
      .objectStore(SNAG_PHOTO_V2_STORE)
      .getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteSnagPhotoV2(id) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAG_PHOTO_V2_STORE, "readwrite");
    tx.objectStore(SNAG_PHOTO_V2_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
