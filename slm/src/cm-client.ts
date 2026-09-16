import {
  LOCAL_IDS,
  buildRouteTable,
  matchRoute,
  rewrite,
  type GenericRequestData,
  type GenericResponseData,
} from './protocol/index.ts';

const table = buildRouteTable(__SML_CM__);

export interface CmResult {
  response: GenericResponseData;
  /** Caveat worth surfacing in the inspector, e.g. a degraded route. */
  note?: string;
}

/**
 * Fulfils `host.request` the way Cloud Portal does: a plain `fetch` from the host
 * page with the bearer token attached. The app never sees the token.
 *
 * The CM has to allow this origin - see
 * `sitecore/docker/deploy/platform/App_Config/Include/zzz/LocalMarketplace.CORS.config`.
 */
export async function requestCm(req: GenericRequestData): Promise<CmResult> {
  const rule = matchRoute(req.path, table);
  if (!rule) {
    return refuse(501, `No route for "${req.path}". Add a rule in slm/src/protocol/routes.ts.`);
  }

  const target = rewrite(req.path, rule);
  if (!target) {
    return refuse(501, `${rule.namespaces.join(', ')} is not available locally. ${rule.note}`);
  }

  const headers = new Headers(req.headers);
  if (req.requiresAuth && __SML_CM_TOKEN__) {
    headers.set('authorization', `Bearer ${__SML_CM_TOKEN__}`);
  }

  let res: Response;
  try {
    res = await fetch(target, { method: req.method ?? 'GET', headers, body: req.body });
  } catch (err) {
    // A CORS rejection and a stopped container look the same from here.
    const message = err instanceof Error ? err.message : String(err);
    return refuse(
      502,
      `Could not reach ${target}: ${message}. Is the container stack running, and does the CM allow ${window.location.origin}?`,
    );
  }

  return {
    response: {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
      body: await res.arrayBuffer(),
    },
    note: buildNote(req.path, rule.status, rule.note),
  };
}

/**
 * `xmc.live` and `xmc.preview` are indistinguishable by path, so the only clue
 * that an app wanted published content is the context ID it asks for.
 */
function buildNote(path: string, status: string, ruleNote: string): string | undefined {
  if (path.includes(LOCAL_IDS.liveContextId)) {
    return 'Requested the LIVE context, but there is no local Experience Edge - served from the CM preview endpoint instead. Results will not reflect publishing state.';
  }
  return status === 'local' ? undefined : ruleNote;
}

function refuse(status: number, message: string): CmResult {
  return {
    response: {
      status,
      statusText: status === 501 ? 'Not Implemented' : 'Bad Gateway',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({ errors: [{ message }], localHost: true }))
        .buffer as ArrayBuffer,
    },
    note: message,
  };
}
