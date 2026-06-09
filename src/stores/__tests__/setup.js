// Provide a reliable in-memory localStorage for all store tests.
// Vitest 4.x passes --localstorage-file to happy-dom workers but leaves the
// path empty, which causes localStorage methods to be non-functional.
// This beforeEach installs a fresh Map-backed implementation before every test
// so that stores using localStorage (profile, auth) work correctly.

beforeEach(() => {
  const store = new Map()
  const mockStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, value) => { store.set(String(key), String(value)) },
    removeItem: (key) => { store.delete(String(key)) },
    clear: () => store.clear(),
    key: (i) => ([...store.keys()][i] ?? null),
    get length() { return store.size },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  })
})
