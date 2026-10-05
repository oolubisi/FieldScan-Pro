/**
 * Phone storage (IndexedDB), as a small promise wrapper.
 *
 * Stores:
 *   kv         settings and small bookkeeping (device id, import log, ...)
 *   projects   the project list synced down from the desktop
 *   records    everything the user creates here (and what comes back from
 *              the desktop), each with its version vector
 *   conflicts  incoming versions that clash with a local edit, waiting for
 *              the user to choose
 *
 * The important primitive is readModifyWrite(): it reads some keys, hands
 * them to a SYNCHRONOUS function, and applies the writes that function
 * returns, all inside ONE transaction. That is what makes "apply this
 * incoming change" atomic -- a record and its conflict marker can never be
 * left disagreeing, even if the app is closed mid-import. (The function
 * must be synchronous: an IndexedDB transaction closes itself the moment
 * you await anything that isn't an IndexedDB request.)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FSPDb = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DB_NAME = "fsp-mobile";
  const DB_VERSION = 1;

  const requestToPromise = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const transactionDone = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    });

  function open(factory) {
    const idb = factory || (typeof indexedDB !== "undefined" ? indexedDB : null);
    if (!idb) return Promise.reject(new Error("IndexedDB is not available in this browser"));
    return new Promise((resolve, reject) => {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "key" }).createIndex("byCompany", "companyKey");
        }
        if (!db.objectStoreNames.contains("records")) {
          db.createObjectStore("records", { keyPath: "id" }).createIndex("byType", "type");
        }
        if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(wrap(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("The database is open in another tab; close it and try again"));
    });
  }

  function wrap(db) {
    const api = {
      raw: db,

      get: (store, key) => requestToPromise(db.transaction(store).objectStore(store).get(key)),
      getAll: (store) => requestToPromise(db.transaction(store).objectStore(store).getAll()),
      getAllByIndex: (store, index, value) => requestToPromise(db.transaction(store).objectStore(store).index(index).getAll(value)),

      async put(store, value) {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        await transactionDone(tx);
        return value;
      },

      async putMany(store, values) {
        const tx = db.transaction(store, "readwrite");
        const os = tx.objectStore(store);
        values.forEach((v) => os.put(v));
        await transactionDone(tx);
        return values;
      },

      async delete(store, key) {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        await transactionDone(tx);
      },

      async clear(store) {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).clear();
        await transactionDone(tx);
      },

      async kvGet(key, fallback) {
        const row = await api.get("kv", key);
        return row ? row.value : fallback;
      },

      kvSet: (key, value) => api.put("kv", { key, value }),

      /**
       * Replace every row of `store` whose index value equals `indexValue`
       * with `newValues`, atomically (used for "replace this company's
       * project list": nothing is ever half-replaced).
       */
      async replaceByIndex(store, indexName, indexValue, newValues) {
        const tx = db.transaction(store, "readwrite");
        const os = tx.objectStore(store);
        const cursorReq = os.index(indexName).openCursor(indexValue);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            newValues.forEach((v) => os.put(v));
          }
        };
        await transactionDone(tx);
      },

      /**
       * Read `reads` ([{store, key}]), call fn(values) SYNCHRONOUSLY, apply the
       * ops it returns ([{op:'put', store, value} | {op:'delete', store, key}]),
       * all in a single transaction. Resolves with fn's `result`. If fn
       * throws, nothing is written. `extraStores` names any store fn will
       * write to that isn't also being read (a transaction can only touch
       * the stores it declared).
       */
      readModifyWrite(reads, fn, extraStores = []) {
        return new Promise((resolve, reject) => {
          const storeNames = [...new Set([...reads.map((r) => r.store), ...extraStores])];
          let tx;
          try {
            tx = db.transaction(storeNames.length ? storeNames : ["kv"], "readwrite");
          } catch (e) {
            reject(e);
            return;
          }
          let outcome;
          const finish = (values) => {
            try {
              outcome = fn(values) || {};
              (outcome.ops || []).forEach((o) => {
                const os = tx.objectStore(o.store);
                if (o.op === "put") os.put(o.value);
                else if (o.op === "delete") os.delete(o.key);
                else throw new Error("unknown op " + o.op);
              });
            } catch (e) {
              try { tx.abort(); } catch (_) { /* already finished */ }
              reject(e);
            }
          };
          const values = new Array(reads.length);
          let pending = reads.length;
          if (!pending) finish(values);
          reads.forEach((r, i) => {
            const req = tx.objectStore(r.store).get(r.key);
            req.onsuccess = () => {
              values[i] = req.result;
              if (--pending === 0) finish(values);
            };
          });
          tx.oncomplete = () => resolve(outcome ? outcome.result : undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
        });
      },

      close: () => db.close(),
    };
    return api;
  }

  return { DB_NAME, DB_VERSION, open };
});
