import {
  DIRECT_ACTIONS,
  MUTATION_ACTIONS,
  QUERY_ACTIONS,
  buildApplicationContext,
  buildHostState,
  defaultUser,
  type ExtensionPoint,
  type GenericRequestData,
  type LocalAppRecord,
} from '@sml/protocol';
import { forwardToGateway } from './gateway-client';
import type { RequestHandler } from './host-bridge';

/**
 * Mutable state the host serves to the app. The UI edits this live, which is
 * the point: a context-panel app is only interesting when you can change the
 * "selected page" and watch it react.
 */
export interface HostContextState {
  app: LocalAppRecord;
  extensionPoint: ExtensionPoint;
  route: string;
  pagesContext: unknown;
  siteContext: unknown;
}

export interface HandlerDeps {
  getState: () => HostContextState;
  setPagesContext: (next: unknown) => void;
  onNote: (message: string) => void;
}

export function buildHandlers(deps: HandlerDeps): Record<string, RequestHandler> {
  const { getState, setPagesContext, onNote } = deps;

  return {
    [QUERY_ACTIONS.applicationContext]: () => {
      const { app, extensionPoint } = getState();
      return buildApplicationContext(app, extensionPoint);
    },

    [QUERY_ACTIONS.hostUser]: () => defaultUser,

    [QUERY_ACTIONS.hostState]: () => buildHostState(getState().extensionPoint),

    [QUERY_ACTIONS.hostRoute]: () => getState().route,

    [QUERY_ACTIONS.pagesContext]: () => getState().pagesContext,

    [QUERY_ACTIONS.siteContext]: () => getState().siteContext,

    [MUTATION_ACTIONS.pagesReloadCanvas]: () => {
      // There is no canvas locally - Pages is the cloud editor. Surfacing this
      // as a visible note beats silently succeeding, because an app that relies
      // on the reload to refresh its own view will look broken otherwise.
      onNote('pages.reloadCanvas: no local canvas to reload (no-op).');
    },

    [MUTATION_ACTIONS.pagesContext]: (params: unknown) => {
      setPagesContext(params);
      onNote('pages.context updated by the app.');
    },

    [DIRECT_ACTIONS.request]: async (payload: GenericRequestData) => {
      const { response, route } = await forwardToGateway(payload);
      if (route?.note) onNote(`${payload.path} -> ${route.note}`);
      return response;
    },

    [DIRECT_ACTIONS.logout]: () => {
      onNote('host.logout called. No local identity session to end (no-op).');
    },

    [DIRECT_ACTIONS.openProfile]: () => {
      onNote('host.openProfile called. No local profile UI (no-op).');
    },

    [DIRECT_ACTIONS.navigateToExternalUrl]: (payload: { url?: string; newTab?: boolean }) => {
      if (!payload?.url) throw new Error('navigateTo.externalUrl requires a url');
      window.open(payload.url, payload.newTab === false ? '_self' : '_blank', 'noopener');
    },

    [DIRECT_ACTIONS.setNavbarItems]: (payload: unknown) => {
      // The real host renders these into Cloud Portal chrome. We only record
      // them, so an app author can confirm the call shape is right.
      onNote(`host.setNavbarItems received: ${JSON.stringify(payload)?.slice(0, 200)}`);
    },
  };
}
