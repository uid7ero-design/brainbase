// Process-local test transport for the Scheduling browser harness (loaded into the Next server with --import).
// No application, session or Scheduling authorisation is mocked. Only the synthetic database connection is routed to the
// local SQL bridge, and every other outbound request is refused.
const nativeFetch = globalThis.fetch;
const { Agent, Dispatcher, setGlobalDispatcher } = await import('undici');
const agent = new Agent();
const bridge = process.env.SCHEDULING_LOCAL_SQL_BRIDGE;
const connection = process.env.DATABASE_URL;
if (!bridge || !connection || new URL(bridge).hostname !== '127.0.0.1'
  || !['127.0.0.1', 'localhost'].includes(new URL(connection).hostname)) throw new Error('The Scheduling browser harness requires loopback services.');
setGlobalDispatcher(new class extends Dispatcher {
  dispatch(options, handler) {
    const url = new URL(String(options.origin));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      queueMicrotask(() => handler.onError(new Error('External dispatcher request blocked by the Scheduling browser harness.')));
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
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External fetch blocked by the Scheduling browser harness.');
  return nativeFetch(input, init);
};
