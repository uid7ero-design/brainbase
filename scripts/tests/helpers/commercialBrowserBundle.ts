import { build } from 'vite';
import path from 'node:path';

// Bundle the actual client page. Only Next navigation is replaced; the browser
// uses real HTTP against the integration server for all payment operations.
export async function commercialBrowserBundle(component: string, id = '') {
  const result = await build({
    configFile: false, logLevel: 'error',
    resolve: { alias: { '@': process.cwd() } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' },
    // Vitest sets NODE_ENV=test; explicitly match React's production JSX runtime.
    oxc: { jsx: { runtime: 'automatic', development: false } },
    plugins: [{ name: 'commercial-integration-browser', enforce: 'pre',
      resolveId(name) {
        if (name.replaceAll('\\', '/').endsWith('/ap-browser-entry')) return '\0ap-browser-entry';
        if (['ap-browser-entry', 'next/navigation', 'next/link'].includes(name)) return `\0${name}`;
      },
      load(name) {
        if (name === '\0next/navigation') return `export const useParams = () => ({id:${JSON.stringify(id)}}); export const useRouter = () => ({push(url){location.href=url}});`;
        if (name === '\0next/link') return "import {createElement} from 'react'; export default function Link(props){return createElement('a',props)}";
        if (name === '\0ap-browser-entry') return `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(path.resolve(component).replaceAll('\\', '/'))}; createRoot(document.getElementById('root')).render(createElement(Page));`;
      },
    }],
    build: { write: false, lib: { entry: 'ap-browser-entry', name: 'APIntegration', formats: ['iife'] } },
  });
  const built = Array.isArray(result) ? result[0] : result;
  if (!('output' in built)) throw new Error('Browser bundle did not complete');
  return built.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
}
