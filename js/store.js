/* Run storage in IndexedDB: run records plus sample chunks, so a crash or reload never loses a drive. */
(function (T) {
  const DB = 'tpr', VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('runs')) d.createObjectStore('runs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('chunks')) { const s = d.createObjectStore('chunks', { keyPath: ['runId', 'seq'] }); s.createIndex('run', 'runId'); }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const tx = async (stores, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode); let out;
      Promise.resolve(fn(t)).then(v => { out = v; });
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  T.store = {
    available: 'indexedDB' in window,
    putRun: run => tx(['runs'], 'readwrite', t => { t.objectStore('runs').put(run); }),
    putChunk: (runId, seq, rows) => tx(['chunks'], 'readwrite', t => { t.objectStore('chunks').put({ runId, seq, rows }); }),
    listRuns: () => tx(['runs'], 'readonly', async t => { const all = await req(t.objectStore('runs').getAll()); return all.sort((a, b) => b.started - a.started); }),
    getRun: id => tx(['runs'], 'readonly', t => req(t.objectStore('runs').get(id))),
    samples: id => tx(['chunks'], 'readonly', async t => {
      const all = await req(t.objectStore('chunks').index('run').getAll(id));
      all.sort((a, b) => a.seq - b.seq); return all.flatMap(c => c.rows);
    }),
    deleteRun: id => tx(['runs', 'chunks'], 'readwrite', async t => {
      t.objectStore('runs').delete(id);
      const keys = await req(t.objectStore('chunks').index('run').getAllKeys(id));
      keys.forEach(k => t.objectStore('chunks').delete(k));
    })
  };
})(window.TPR);
