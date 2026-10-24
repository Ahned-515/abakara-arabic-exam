// Serial fake enforces read-before-write. Real contention uses emulator tests.
export class MemoryDB {
  constructor() {
    this.data = new Map();
    this.queue = Promise.resolve();
    this.next = 0;
  }
  doc(path) {
    const db = this;
    return { path, id: path.split("/").at(-1), get: async () => db.snap(path) };
  }
  snap(path) {
    return {
      exists: this.data.has(path),
      data: () => structuredClone(this.data.get(path)),
      id: path.split("/").at(-1),
      ref: this.doc(path),
    };
  }
  collection(path) {
    return { doc: () => this.doc(`${path}/id${++this.next}`) };
  }
  runTransaction(fn) {
    const run = this.queue.then(async () => {
      let wrote = false;
      const writes = [];
      const tx = {
        get: async (ref) => {
          if (wrote) throw new Error("Read after write");
          return this.snap(ref.path);
        },
        set: (ref, value) => {
          wrote = true;
          writes.push(() => this.data.set(ref.path, structuredClone(value)));
        },
        update: (ref, value) => {
          wrote = true;
          writes.push(() => {
            if (!this.data.has(ref.path)) throw new Error("Missing document");
            this.data.set(ref.path, {
              ...this.data.get(ref.path),
              ...structuredClone(value),
            });
          });
        },
      };
      const value = await fn(tx);
      writes.forEach((w) => w());
      return value;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
