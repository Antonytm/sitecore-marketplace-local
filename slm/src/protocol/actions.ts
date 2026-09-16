/**
 * The wire-level action names the host must answer.
 *
 * These are NOT the same as the keys an app passes to `client.query()` /
 * `client.mutate()`. `ClientSDK.resolveOperation` (client/src/client.ts) appends
 * `:query` or `:mutation` to any key that does not resolve to a registered SDK
 * module, and sends *that* as the request action. Module-namespaced keys
 * (`xmc.*`, `ai.*`) never reach the host under their own name at all - they are
 * executed in the client and surface here as `host.request`.
 *
 * Verified against @sitecore-marketplace-sdk/client 0.3.6.
 */

/** Queries: `client.query('host.user')` -> action `host.user:query`. */
export const QUERY_ACTIONS = {
  applicationContext: 'application.context:query',
  hostUser: 'host.user:query',
  hostState: 'host.state:query',
  hostRoute: 'host.route:query',
  pagesContext: 'pages.context:query',
  siteContext: 'site.context:query',
} as const;

/** Mutations: `client.mutate('pages.reloadCanvas')` -> action `pages.reloadCanvas:mutation`. */
export const MUTATION_ACTIONS = {
  pagesReloadCanvas: 'pages.reloadCanvas:mutation',
  pagesContext: 'pages.context:mutation',
} as const;

/**
 * Direct requests issued by ClientSDK methods rather than query()/mutate().
 * These carry no `:query`/`:mutation` suffix.
 */
export const DIRECT_ACTIONS = {
  /** The generic HTTP proxy. Every `xmc.*` call arrives here. */
  request: 'host.request',
  logout: 'host.logout',
  openProfile: 'host.openProfile',
  navigateToExternalUrl: 'host.navigateTo.externalUrl',
  setNavbarItems: 'host.setNavbarItems',
  /** Custom-field dialog: `client.getValue()`, `setValue()` and `closeApp()`. */
  pagesGetValue: 'pages.getValue',
  pagesSetValue: 'pages.setValue',
  pagesCloseApp: 'pages.closeApp',
} as const;

/**
 * Events the host emits to the client.
 *
 * Subscription queries (`{ subscribe: true }`) listen on the *unhashed* query
 * key - see `handleSubscription` in client/src/client.ts - so the event name is
 * the plain key, with no `:query` suffix.
 */
export const HOST_EVENTS = {
  hostState: 'host.state',
  pagesContext: 'pages.context',
  hostRoute: 'host.route',
  pagesContentLayoutUpdated: 'pages.content.layoutUpdated',
  pagesContentFieldsUpdated: 'pages.content.fieldsUpdated',
} as const;

export const ALL_REQUEST_ACTIONS = [
  ...Object.values(QUERY_ACTIONS),
  ...Object.values(MUTATION_ACTIONS),
  ...Object.values(DIRECT_ACTIONS),
] as const;

export type RequestAction = (typeof ALL_REQUEST_ACTIONS)[number];
export type HostEvent = (typeof HOST_EVENTS)[keyof typeof HOST_EVENTS];

/**
 * Extension points, mirroring `AllowedExtensionPoints` in
 * @sitecore-marketplace-sdk/core. Duplicated here so the host UI can enumerate
 * them without importing the enum at runtime.
 */
export const EXTENSION_POINTS = [
  'standalone',
  'xmc:fullscreen',
  'xmc:pages:contextpanel',
  'xmc:pages:customfield',
  'xmc:dashboardblocks',
] as const;

export type ExtensionPoint = (typeof EXTENSION_POINTS)[number];

/** The `appType` reported through `application.context`, per extension point. */
export const APP_TYPE_BY_EXTENSION_POINT: Record<ExtensionPoint, 'portal' | 'xmc:xmapps' | 'xmc:pages-contextview'> = {
  standalone: 'portal',
  'xmc:fullscreen': 'xmc:xmapps',
  'xmc:pages:contextpanel': 'xmc:pages-contextview',
  'xmc:pages:customfield': 'xmc:pages-contextview',
  'xmc:dashboardblocks': 'xmc:xmapps',
};
