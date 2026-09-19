// Default fetch for every Vitest worker: only loopback is real. Provider tests replace this
// with explicit response stubs; a missed URL match must never fall through to the internet.
// This does not sandbox node:http or child processes, which have their own synthetic fixtures.
const loopbackFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("External fetch blocked in tests; install an explicit response stub.");
  }
  return loopbackFetch(input, init);
};
