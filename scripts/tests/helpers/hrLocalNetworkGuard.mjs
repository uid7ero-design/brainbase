// Process-local test transport. No application/session/HR authorization mocks.
// Only the synthetic connection may reach the disposable SQL bridge.
const nativeFetch = globalThis.fetch;
// The Blob SDK imports undici.fetch directly, so guard its dispatcher too.
const { Agent, Dispatcher, setGlobalDispatcher } = await import('undici');
const agent = new Agent();
const bridge = process.env.HR_LOCAL_SQL_BRIDGE;
const connection = process.env.DATABASE_URL;
if (!bridge || !connection || new URL(bridge).hostname !== '127.0.0.1'
  || !['127.0.0.1', 'localhost'].includes(new URL(connection).hostname)) throw new Error('Local proof requires loopback services.');
setGlobalDispatcher(new class extends Dispatcher {
  dispatch(options, handler) {
    const url = new URL(String(options.origin));
    if (url.hostname === 'localemployee.private.blob.vercel-storage.com') {
      const local = new URL(bridge);
      return agent.dispatch({ ...options, origin: local.origin, path: `/objects${options.path}` }, handler);
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      queueMicrotask(() => handler.onError(new Error('External dispatcher request blocked by HR local proof.')));
      return false;
    }
    return agent.dispatch(options, handler);
  }
  close(...args) { return agent.close(...args); }
  destroy(...args) { return agent.destroy(...args); }
}());
globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const sqlConnection = headers.get('Neon-Connection-String');
  if (sqlConnection) {
    if (sqlConnection !== connection) throw new Error('Non-fixture SQL connection blocked.');
    return nativeFetch(bridge, init);
  }
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External fetch blocked by HR local proof.');
  return nativeFetch(input, init);
};
