/**
 * Google Analytics provider — Phase 5 first REAL credentialed implementation.
 *
 * Calls GA4 Data API `runReport` with an OAuth access token from the
 * project's `MetricsConfig` row (source = `GOOGLE_ANALYTICS`). On 401, attempts
 * a one-shot refresh-token exchange against Google's OAuth endpoint and
 * retries the request once. The refreshed access token is NOT persisted —
 * each dispatch is a one-shot, and the GA proxy infra is owned by the user
 * (they re-grant via marymary's settings UI when refresh fails).
 *
 * Credential shape (decrypted from `metricsConfig.credentials`):
 *   - `access_token`        — required
 *   - `refresh_token`       — optional, enables silent refresh on 401
 *   - `client_id`           — required if `refresh_token` is present
 *   - `client_secret`       — required if `refresh_token` is present
 *
 * Meta shape (`metricsConfig.credentialsMeta`):
 *   - `propertyId` — required, the GA4 property ID (e.g. "properties/123456")
 *
 * Why this is the canary: GA is the lowest-risk credentialed integration in
 * the marymary stack. It's read-only, the OAuth flow is well-documented, and
 * the failure modes (missing token, expired token, missing property) all map
 * cleanly to the dispatcher's `{ error, isError }` resolution path.
 */

import { registerPlatformTool } from "../registry";

const GA_DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token";

interface GaCredentials {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
}

interface GaCredentialsMeta {
  propertyId?: string;
  propertyName?: string;
}

/** Map the human period strings to a GA4 dateRanges entry. */
function periodToDateRange(period: string | undefined): {
  startDate: string;
  endDate: string;
} {
  switch (period) {
    case "today":
      return { startDate: "today", endDate: "today" };
    case "28d":
      return { startDate: "28daysAgo", endDate: "today" };
    case "90d":
      return { startDate: "90daysAgo", endDate: "today" };
    case "7d":
    default:
      return { startDate: "7daysAgo", endDate: "today" };
  }
}

/** Map the agent-facing metric names to GA4 metric API names. */
const METRIC_NAME_MAP: Record<string, string> = {
  page_views: "screenPageViews",
  sessions: "sessions",
  users: "activeUsers",
  bounce_rate: "bounceRate",
  conversions: "conversions",
  organic_traffic: "sessions", // simplification; refine with a sourceMedium filter later
};

async function refreshAccessToken(
  creds: GaCredentials,
): Promise<string | null> {
  if (!creds.refresh_token || !creds.client_id || !creds.client_secret) {
    return null;
  }
  const params = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });
  try {
    const res = await fetch(GOOGLE_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

async function runReport(
  propertyId: string,
  accessToken: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const normalizedProperty = propertyId.startsWith("properties/")
    ? propertyId
    : `properties/${propertyId}`;
  const res = await fetch(`${GA_DATA_API}/${normalizedProperty}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

registerPlatformTool({
  name: "ga_get_metrics",
  description:
    "Fetch Google Analytics 4 metrics (page views, sessions, users, bounce rate, conversions, organic traffic) " +
    "for a given period. Requires an OAuth-connected GA property in the project's metrics config.",
  inputSchema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "page_views",
            "sessions",
            "users",
            "bounce_rate",
            "conversions",
            "organic_traffic",
          ],
        },
        description: "Which metrics to fetch.",
      },
      period: {
        type: "string",
        enum: ["today", "7d", "28d", "90d"],
        description: "Date range. Defaults to 7d.",
      },
      page_filter: {
        type: "string",
        description:
          "Optional pagePath filter (substring match against pagePath dimension).",
      },
    },
    required: ["metrics"],
  },
  requiredSources: ["GOOGLE_ANALYTICS"],
  hasSideEffects: false,
  provider: "google_analytics",
  execute: async (input, ctx) => {
    const creds = (ctx.credentials ?? {}) as GaCredentials;
    const meta = (ctx.credentialsMeta ?? {}) as GaCredentialsMeta;

    if (!creds.access_token) {
      return {
        error: true,
        message:
          "Google Analytics credentials are missing an access_token. Reconnect the GA integration in marymary's settings.",
      };
    }
    if (!meta.propertyId) {
      return {
        error: true,
        message:
          "Google Analytics credentialsMeta is missing propertyId. Set it on the MetricsConfig row.",
      };
    }

    const requestedMetrics = (input.metrics as string[]) ?? [];
    const ga4Metrics = requestedMetrics
      .map((m) => METRIC_NAME_MAP[m])
      .filter((m): m is string => !!m)
      .map((name) => ({ name }));

    if (ga4Metrics.length === 0) {
      return {
        error: true,
        message: `No supported metrics in ${JSON.stringify(requestedMetrics)}.`,
      };
    }

    const dateRange = periodToDateRange(input.period as string | undefined);
    const pageFilter = input.page_filter as string | undefined;

    const reportBody: Record<string, unknown> = {
      dateRanges: [dateRange],
      metrics: ga4Metrics,
    };
    if (pageFilter) {
      reportBody.dimensions = [{ name: "pagePath" }];
      reportBody.dimensionFilter = {
        filter: {
          fieldName: "pagePath",
          stringFilter: { matchType: "CONTAINS", value: pageFilter },
        },
      };
    }

    let accessToken = creds.access_token;
    let result = await runReport(meta.propertyId, accessToken, reportBody);

    // Single-shot refresh on 401 if we have a refresh token
    if (result.status === 401) {
      const refreshed = await refreshAccessToken(creds);
      if (refreshed) {
        accessToken = refreshed;
        result = await runReport(meta.propertyId, accessToken, reportBody);
      }
    }

    if (!result.ok) {
      return {
        error: true,
        status: result.status,
        message: `GA4 runReport failed (${result.status})`,
        body: result.data,
      };
    }

    // Flatten the GA4 row response into a `{ metric: total }` map. GA4
    // returns rows of `[dimension..., metric...]`; for our default no-dim
    // case there's a single row whose `metricValues` line up with the
    // requested metric order.
    const data = result.data as {
      rows?: Array<{
        dimensionValues?: Array<{ value: string }>;
        metricValues?: Array<{ value: string }>;
      }>;
      rowCount?: number;
    };
    const rows = data.rows ?? [];

    if (!pageFilter) {
      // Single-row total response
      const row = rows[0];
      const totals: Record<string, number> = {};
      requestedMetrics.forEach((metricName, i) => {
        const ga4Name = METRIC_NAME_MAP[metricName];
        if (!ga4Name) return;
        const raw = row?.metricValues?.[i]?.value;
        totals[metricName] = raw ? Number(raw) : 0;
      });
      return {
        propertyId: meta.propertyId,
        propertyName: meta.propertyName ?? null,
        period: input.period ?? "7d",
        dateRange,
        metrics: totals,
        rowCount: data.rowCount ?? 0,
      };
    }

    // Per-page breakdown response
    const perPage = rows.map((row) => {
      const path = row.dimensionValues?.[0]?.value ?? "";
      const metrics: Record<string, number> = {};
      requestedMetrics.forEach((metricName, i) => {
        const ga4Name = METRIC_NAME_MAP[metricName];
        if (!ga4Name) return;
        const raw = row.metricValues?.[i]?.value;
        metrics[metricName] = raw ? Number(raw) : 0;
      });
      return { path, metrics };
    });

    return {
      propertyId: meta.propertyId,
      propertyName: meta.propertyName ?? null,
      period: input.period ?? "7d",
      dateRange,
      pageFilter,
      pages: perPage,
      rowCount: data.rowCount ?? 0,
    };
  },
});
