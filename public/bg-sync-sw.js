// PLUTUS Android PWA & Desktop Service Worker — Background Sync to Cloud RTDB
const CLOUD_DB_URL = 'https://plutus-web-fbd5b-default-rtdb.firebaseio.com/plutus_master_data.json';
const CLEAN_ERA_CUTOFF_ISO = '2026-11-06T10:00:00.000Z';
const CLEAN_ERA_CUTOFF_MS = Date.parse(CLEAN_ERA_CUTOFF_ISO);
const IDB_NAME = 'plutus_manual_db_v9';
const IDB_STORE = 'app_state_store';
const IDB_LATEST_KEY = 'latest_plutus_state';
const IDB_PENDING_SYNC_KEY = 'pending_cloud_sync_meta';
const IDB_LAST_SYNC_RESULT_KEY = 'last_cloud_sync_result';
const BG_SYNC_TAG = 'plutus-cloud-rtdb-sync';
const PERIODIC_SYNC_TAG = 'plutus-periodic-cloud-sync';
const BROADCAST_CHANNEL_NAME = 'plutus_bg_sync_channel';

let isFlushingInSw = false;

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  try {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase('plutus_autosave_db_v5');
    }
  } catch {}
  event.waitUntil(self.clients.claim());
});

function openPlutusIDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function idbGet(key) {
  const db = await openPlutusIDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        db.close();
        resolve(req.result);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    } catch (err) {
      db.close();
      reject(err);
    }
  });
}

async function idbSet(key, val) {
  const db = await openPlutusIDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(val, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    } catch (err) {
      db.close();
      reject(err);
    }
  });
}

async function idbDelete(key) {
  const db = await openPlutusIDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    } catch (err) {
      db.close();
      reject(err);
    }
  });
}

function isValidCableOrder(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.batch === 'string' &&
    obj.batch.trim().length > 0 &&
    typeof obj.size === 'string' &&
    obj.size.trim().length > 0 &&
    (typeof obj.order_length === 'number' || typeof obj.order_length === 'string')
  );
}

function orderSignature(o) {
  return [
    (o.batch || '').trim().toUpperCase(),
    (o.brand || '').trim().toUpperCase(),
    (o.grade || '').trim().toUpperCase(),
    String(o.cores ?? ''),
    (o.size || '').trim().toUpperCase(),
    (o.conductor || '').trim().toUpperCase(),
    (o.ins_colour || '').trim().toUpperCase(),
    (o.sheath_colour || '').trim().toUpperCase(),
    String(o.order_length ?? ''),
    String(o.coils ?? ''),
  ].join('|');
}

function mergeOrdersNonDestructiveInSW(localOrders, incomingOrders, deletedOrderIds) {
  const deletedSet = new Set(
    Array.isArray(deletedOrderIds) ? deletedOrderIds.map(Number).filter(n => !isNaN(n)) : []
  );

  const validLocal = Array.isArray(localOrders)
    ? localOrders.filter(o => isValidCableOrder(o) && !deletedSet.has(Number(o.id)))
    : [];
  const validIncoming = Array.isArray(incomingOrders)
    ? incomingOrders.filter(o => isValidCableOrder(o) && !deletedSet.has(Number(o.id)))
    : [];

  if (validIncoming.length === 0) return validLocal;
  if (validLocal.length === 0) return validIncoming;

  // Local offline edits are primary so user's offline changes take precedence,
  // while any new orders added on other devices in Cloud RTDB are preserved non-destructively.
  const byId = new Map();
  const seenSignatures = new Set();
  const extraCollisionOrders = [];

  for (const ord of validLocal) {
    const numId = Number(ord.id);
    if (!isNaN(numId) && numId > 0) {
      byId.set(numId, ord);
      seenSignatures.add(orderSignature(ord));
    }
  }

  for (const ord of validIncoming) {
    const numId = Number(ord.id);
    const sig = orderSignature(ord);
    if (!isNaN(numId) && numId > 0) {
      const existing = byId.get(numId);
      if (!existing) {
        if (!seenSignatures.has(sig)) {
          byId.set(numId, ord);
          seenSignatures.add(sig);
        }
      } else {
        const sameIdentity =
          (existing.batch || '').trim().toUpperCase() === (ord.batch || '').trim().toUpperCase() &&
          (existing.size || '').trim().toUpperCase() === (ord.size || '').trim().toUpperCase() &&
          Number(existing.cores || 0) === Number(ord.cores || 0) &&
          (existing.brand || '').trim().toUpperCase() === (ord.brand || '').trim().toUpperCase();

        if (!sameIdentity && !seenSignatures.has(sig)) {
          extraCollisionOrders.push(ord);
          seenSignatures.add(sig);
        } else if (sameIdentity) {
          const countStages = x =>
            (x.pStatus?.b ? 1 : 0) +
            (x.pStatus?.c ? 1 : 0) +
            (x.pStatus?.i ? 1 : 0) +
            (x.pStatus?.t ? 1 : 0) +
            (x.pStatus?.s ? 1 : 0);
          if (countStages(ord) > countStages(existing)) {
            byId.set(numId, {
              ...existing,
              pStatus: ord.pStatus,
              pTimestamps: ord.pTimestamps || existing.pTimestamps,
            });
          }
        }
      }
    } else if (!seenSignatures.has(sig)) {
      extraCollisionOrders.push(ord);
      seenSignatures.add(sig);
    }
  }

  let maxId = 0;
  byId.forEach((_, k) => {
    if (k > maxId) maxId = k;
  });

  for (const extra of extraCollisionOrders) {
    maxId += 1;
    byId.set(maxId, {
      ...extra,
      id: maxId,
      record_row: maxId + 11,
    });
  }

  return Array.from(byId.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

function mergeArrayByIdNonDestructive(localArr, cloudArr) {
  if (!Array.isArray(localArr) && !Array.isArray(cloudArr)) return [];
  if (!Array.isArray(cloudArr) || cloudArr.length === 0) return localArr || [];
  if (!Array.isArray(localArr) || localArr.length === 0) return cloudArr || [];

  const map = new Map();
  // Local items take priority (offline edits), cloud items not in local are preserved
  for (const item of localArr) {
    if (item && item.id !== undefined) {
      map.set(String(item.id), item);
    }
  }
  for (const item of cloudArr) {
    if (item && item.id !== undefined && !map.has(String(item.id))) {
      map.set(String(item.id), item);
    }
  }
  return Array.from(map.values());
}

async function notifyAllClients(message) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.postMessage(message);
      bc.close();
    }
  } catch {}

  try {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of windowClients) {
      client.postMessage(message);
    }
  } catch {}
}

async function flushOfflineQueueToCloudRTDB(triggerSource = 'service-worker-sync') {
  if (isFlushingInSw) return true;
  isFlushingInSw = true;

  try {
    const pendingMeta = await idbGet(IDB_PENDING_SYNC_KEY);
    const latestState = await idbGet(IDB_LATEST_KEY);

    const stateToSync = pendingMeta?.state || latestState;
    const stateTs = stateToSync?.updatedAt ? Date.parse(stateToSync.updatedAt) : 0;
    if (
      !stateToSync ||
      !Array.isArray(stateToSync.orders) ||
      isNaN(stateTs) ||
      stateTs < CLEAN_ERA_CUTOFF_MS
    ) {
      if (pendingMeta) {
        await idbDelete(IDB_PENDING_SYNC_KEY);
      }
      return true;
    }

    // If there is no pendingMeta and triggerSource is strictly background sync, nothing to push
    if (!pendingMeta && triggerSource === 'service-worker-sync') {
      return true;
    }

    await notifyAllClients({
      type: 'PLUTUS_BG_SYNC_STARTED',
      triggerSource,
      queuedAt: pendingMeta?.queuedAt || stateToSync.updatedAt,
      editCount: pendingMeta?.editCount || 1,
    });

    const combinedDeletedIds = Array.from(
      new Set([
        ...(Array.isArray(stateToSync.deletedOrderIds) ? stateToSync.deletedOrderIds : []),
        ...(Array.isArray(pendingMeta?.deletedOrderIds) ? pendingMeta.deletedOrderIds : []),
      ])
    );
    const deletedSet = new Set(combinedDeletedIds.map(Number).filter(n => !isNaN(n)));

    const mergedOrders = stateToSync.orders.filter(
      o =>
        isValidCableOrder(o) &&
        !deletedSet.has(Number(o.id)) &&
        !(typeof o.dispatchedAt === 'string' && o.dispatchedAt.startsWith('2026-10-'))
    );

    const nowIso = new Date().toISOString();
    const effectiveUpdatedAt =
      stateToSync.updatedAt && Date.parse(stateToSync.updatedAt) > Date.now()
        ? stateToSync.updatedAt
        : nowIso;

    const mergedState = {
      ...stateToSync,
      orders: mergedOrders,
      deletedOrderIds: combinedDeletedIds,
      updatedAt: effectiveUpdatedAt,
    };

    const payload = {
      appOrders: mergedOrders,
      customSizePkg: mergedState.sizeRules,
      customPackaging: mergedState.packagingRules,
      customColourMap: mergedState.colourMap,
      customLadi: mergedState.ladiDimensions,
      customDensities: mergedState.densities,
      v9ManualState: mergedState,
      v5State: mergedState,
      cleanEraCutoff: CLEAN_ERA_CUTOFF_ISO,
      updatedAt: mergedState.updatedAt,
    };

    const patchRes = await fetch(CLOUD_DB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!patchRes.ok) {
      throw new Error(`Cloud RTDB PUT failed with status ${patchRes.status}`);
    }

    // Successfully pushed offline edits to Cloud RTDB!
    await idbDelete(IDB_PENDING_SYNC_KEY);
    await idbSet(IDB_LATEST_KEY, mergedState);
    const syncResult = {
      syncedAt: nowIso,
      pushedUpdatedAt: mergedState.updatedAt,
      ordersCount: mergedOrders.length,
      editCount: pendingMeta?.editCount || 1,
      via: triggerSource,
    };
    await idbSet(IDB_LAST_SYNC_RESULT_KEY, syncResult);

    await notifyAllClients({
      type: 'PLUTUS_BG_SYNC_COMPLETED',
      ...syncResult,
      mergedState,
    });

    return true;
  } finally {
    isFlushingInSw = false;
  }
}

// 1. Native Background Sync Event (Fires automatically on Android PWA when connectivity returns)
self.addEventListener('sync', event => {
  if (event.tag === BG_SYNC_TAG) {
    event.waitUntil(flushOfflineQueueToCloudRTDB('service-worker-sync'));
  }
});

// 2. Periodic Background Sync (if supported and granted on Android Chrome)
self.addEventListener('periodicsync', event => {
  if (event.tag === PERIODIC_SYNC_TAG) {
    event.waitUntil(flushOfflineQueueToCloudRTDB('periodic-background-sync'));
  }
});

// 3. Client Message Handler (Immediate sync trigger when client detects online/visibility or queues offline edit)
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'PLUTUS_TRIGGER_BG_SYNC') {
    event.waitUntil(
      flushOfflineQueueToCloudRTDB(data.source || 'client-online-trigger').catch(() => {
        // Re-register native sync tag if still offline
        if (self.registration && 'sync' in self.registration) {
          return self.registration.sync.register(BG_SYNC_TAG).catch(() => {});
        }
      })
    );
  } else if (data.type === 'PLUTUS_QUEUE_OFFLINE_SYNC') {
    event.waitUntil(
      (async () => {
        if (self.registration && 'sync' in self.registration) {
          try {
            await self.registration.sync.register(BG_SYNC_TAG);
          } catch {}
        }
        await notifyAllClients({
          type: 'PLUTUS_BG_SYNC_ARMED',
          updatedAt: data.updatedAt || new Date().toISOString(),
        });
      })()
    );
  } else if (data.type === 'PLUTUS_PING_SW') {
    if (event.source && 'postMessage' in event.source) {
      event.source.postMessage({
        type: 'PLUTUS_PONG_SW',
        active: true,
        timestamp: new Date().toISOString(),
      });
    }
  }
});

// 4. Intercept failed Firebase RTDB PATCH requests while offline and auto-register Background Sync
self.addEventListener('fetch', event => {
  const req = event.request;
  if (
    (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'POST') &&
    req.url.includes('plutus-web-fbd5b-default-rtdb.firebaseio.com')
  ) {
    const clonedReq = req.clone();
    event.respondWith(
      fetch(req).catch(async err => {
        try {
          const bodyText = await clonedReq.text();
          const parsedBody = JSON.parse(bodyText);
          const v5State = parsedBody?.v5State;
          if (v5State && Array.isArray(v5State.orders)) {
            const existingPending = await idbGet(IDB_PENDING_SYNC_KEY).catch(() => null);
            await idbSet(IDB_PENDING_SYNC_KEY, {
              id: 'offline_outbox',
              queuedAt: new Date().toISOString(),
              editCount: (existingPending?.editCount || 0) + 1,
              state: v5State,
              deletedOrderIds: v5State.deletedOrderIds || [],
              retryCount: (existingPending?.retryCount || 0) + 1,
            });
            if (self.registration && 'sync' in self.registration) {
              await self.registration.sync.register(BG_SYNC_TAG).catch(() => {});
            }
            await notifyAllClients({
              type: 'PLUTUS_BG_SYNC_QUEUED',
              editCount: (existingPending?.editCount || 0) + 1,
              queuedAt: new Date().toISOString(),
            });
          }
        } catch {}
        throw err;
      })
    );
  }
});
