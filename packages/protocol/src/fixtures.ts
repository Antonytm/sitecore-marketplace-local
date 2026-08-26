import type {
  ApplicationContext,
  UserInfo,
} from '@sitecore-marketplace-sdk/core';
import { APP_TYPE_BY_EXTENSION_POINT, type ExtensionPoint } from './actions.ts';
import type { LocalAppRecord } from './types.ts';

/**
 * Synthetic context objects for the local host.
 *
 * These are best-effort reconstructions from the SDK's TypeScript interfaces.
 * Most of those interfaces end in `[key: string]: any`, so the real host almost
 * certainly sends more than this. Phase 0 (apps/probe) captures the genuine
 * payloads from Cloud Portal; drop those transcripts into ../fixtures/ and
 * point `loadCapturedFixture` at them to replace these defaults.
 */

/** Stable fake identifiers, so app-side caching behaves consistently across restarts. */
export const LOCAL_IDS = {
  organizationId: 'org_local0000000000000',
  tenantId: 'local-xmcloud-tenant',
  tenantName: 'local-xmcloudcm-localhost',
  resourceId: 'local-xmcloud-resource',
  installationId: 'local-installation-0001',
  /**
   * Context IDs normally identify an Edge/Cloud environment. Locally there is no
   * such thing; the gateway ignores them, but apps may echo or log them.
   */
  previewContextId: 'local-preview-context',
  liveContextId: 'local-live-context',
} as const;

export const defaultUser: UserInfo = {
  id: 'local-user-0001',
  name: 'Local Developer',
  email: 'local.developer@localhost',
};

export function buildApplicationContext(
  app: LocalAppRecord,
  extensionPoint: ExtensionPoint,
): ApplicationContext {
  const resource = {
    resourceId: LOCAL_IDS.resourceId,
    tenantId: LOCAL_IDS.tenantId,
    tenantName: LOCAL_IDS.tenantName,
    tenantDisplayName: 'Local XM Cloud (Docker)',
    context: {
      live: LOCAL_IDS.liveContextId,
      preview: LOCAL_IDS.previewContextId,
    },
  };

  return {
    id: app.id,
    name: app.name,
    url: app.origin + (app.routes[extensionPoint] ?? '/'),
    type: APP_TYPE_BY_EXTENSION_POINT[extensionPoint],
    iconUrl: app.iconUrl,
    state: 'installed',
    installationId: LOCAL_IDS.installationId,
    organizationId: LOCAL_IDS.organizationId,
    resourceAccess: [resource],
    // Deprecated aliases, still populated: older app code reads `resources`.
    resources: [resource],
    extensionPoints: Object.entries(app.routes).map(([id, route]) => ({
      extensionPointId: id,
      route,
      meta: [{ id, route: route as string, title: app.name }],
    })),
  };
}

/**
 * `host.state` is typed by app type: `null` for `portal`, an object otherwise.
 * See `HostState` in @sitecore-marketplace-sdk/client.
 */
export function buildHostState(extensionPoint: ExtensionPoint): unknown {
  const appType = APP_TYPE_BY_EXTENSION_POINT[extensionPoint];

  if (appType === 'portal') return null;

  if (appType === 'xmc:xmapps') {
    return { environment: 'local', language: 'en' };
  }

  return {
    organizationId: LOCAL_IDS.organizationId,
    xmCloudTenantInfo: {
      url: 'https://xmcloudcm.localhost/',
      gqlEndpointUrl: 'https://xmcloudcm.localhost/sitecore/api/graph/edge',
      environmentId: 'local',
      environmentName: 'local',
      projectId: 'local',
      projectName: 'local',
      customerEnvironmentType: 'dev',
      regionCode: 'local',
    },
    userInfo: {
      sub: defaultUser.id,
      name: defaultUser.name,
      email: defaultUser.email,
      email_verified: true,
      preferred_username: defaultUser.email,
      locale: 'en',
    },
  };
}

/**
 * Minimal `pages.context`. The host shell lets you edit this live, because the
 * realistic way to exercise a context-panel app is to change the "selected
 * page" and watch the app react.
 */
export function buildPagesContext() {
  return {
    siteInfo: {
      id: 'local-site-0001',
      name: 'localsite',
      displayName: 'Local Site',
      language: 'en',
      collectionId: 'local-collection',
      startItemId: '{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}',
      supportedLanguages: ['en'],
      properties: { isSxaSite: true },
    },
    pageInfo: {
      id: '{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}',
      name: 'Home',
      displayName: 'Home',
      path: '/sitecore/content/localsite/home',
      language: 'en',
      version: 1,
      templateId: '{76036F5E-CBCE-46D1-AF0A-4143F9B557AA}',
    },
  };
}

export function buildSiteContext() {
  return {
    id: 'local-site-0001',
    name: 'localsite',
    displayName: 'Local Site',
    language: 'en',
  };
}
