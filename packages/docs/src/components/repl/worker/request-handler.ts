/* eslint-disable no-console */
import type { ReplEventMessage } from '../types';
import { QWIK_REPL_RESULT_CACHE } from './constants';
import { sendMessageToReplServer } from './repl-messenger';

export const requestHandler = async (ev: FetchEvent) => {
  const reqUrl = new URL(ev.request.url);
  const pathname = reqUrl.pathname;
  const parts = pathname.split('/');
  const subDir = parts[1];
  const clientId = parts[2];

  if (subDir !== 'repl' || pathname.includes('/~repl-server-')) {
    return;
  }

  return ev.respondWith(
    caches.open(QWIK_REPL_RESULT_CACHE).then(async (cache) => {
      const rsp = await cache.match(ev.request);
      if (rsp) {
        if (rsp.headers.get('Content-Type')?.includes('text/html')) {
          // app document
          const html = injectDevHtml(clientId, await rsp.clone().text());
          const htmlRsp = new Response(html, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Qwik-REPL-App': 'ssr-result',
            },
          });
          return htmlRsp;
        }

        // app client modules
        const replEvent: ReplEventMessage = {
          type: 'event',
          clientId,
          event: {
            kind: 'client-module',
            scope: 'network',
            message: [reqUrl.pathname + reqUrl.search],
            start: performance.now(),
          },
        };

        sendMessageToReplServer(replEvent);

        return rsp;
      }

      return new Response('404 - ' + ev.request.url, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Qwik-REPL-App': 'Not-Found',
        },
        status: 404,
      });
    })
  );
};

const injectDevHtml = (clientId: string, html?: string) => {
  const s = `
  (() => {
  const sendToServerWindow = (data) => {
    try {
      parent.postMessage(JSON.stringify({
        type: 'event',
        clientId: '${clientId}',
        event: data
      }));
    } catch {}
  };

  const log = console.log;
  const warn = console.warn;
  const error = console.error;

  console.log = (...args) => {
    sendToServerWindow({
      kind: 'console-log',
      scope: 'client',
      message: args.map(a => String(a)),
      start: performance.now(),
    });
    log(...args);
  };

  console.warn = (...args) => {
    sendToServerWindow({
      kind: 'console-warn',
      scope: 'client',
      message: args.map(a => String(a)),
      start: performance.now(),
    });
    warn(...args);
  };

  console.error = (...args) => {
    sendToServerWindow({
      kind: 'console-error',
      scope: 'client',
      message: args.map(a => String(a)),
      start: performance.now(),
    });
    error(...args);
  };

  window.addEventListener('error', (ev) => {
    sendToServerWindow({
      kind: 'error',
      scope: 'client',
      message: [ev.message],
      start: performance.now(),
    });
  });

  document.addEventListener('qsymbol', (ev) => {
    const symbolName = ev.detail;
    sendToServerWindow({
      kind: 'symbol',
      scope: 'client',
      message: [symbolName],
      start: performance.now(),
    });
  });
  document.addEventListener('qresume', () => {
    sendToServerWindow({
      kind: 'resume',
      scope: 'client',
      message: '',
      start: performance.now(),
    });
  });
})();`;

  return `<script>${s}</script>${html || ''}`;
};
