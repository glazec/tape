export type TelemetryConfig = {
  headers: Record<string, string>;
  logsEndpoint: string;
  resourceAttributes: Record<string, string>;
  serviceName: string;
  tracesEndpoint: string;
};

type TelemetryEnvironment = Record<string, string | undefined>;

export function getTelemetryConfig(
  source: TelemetryEnvironment,
  defaultServiceName = "tape-web",
): TelemetryConfig | null {
  const commonEndpoint = source.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const tracesEndpoint = normalizeOtlpEndpoint(
    source.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || commonEndpoint,
    "traces",
  );
  const logsEndpoint = normalizeOtlpEndpoint(
    source.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim() || commonEndpoint,
    "logs",
  );

  if (!tracesEndpoint || !logsEndpoint) {
    return null;
  }

  const serviceName =
    source.OTEL_SERVICE_NAME?.trim() || defaultServiceName;
  const resourceAttributes: Record<string, string> = {
    "service.namespace": "tape",
    "deployment.environment.name":
      source.VERCEL_ENV?.trim() ||
      source.RAILWAY_ENVIRONMENT_NAME?.trim() ||
      source.NODE_ENV?.trim() ||
      "development",
  };
  const serviceVersion =
    source.VERCEL_GIT_COMMIT_SHA?.trim() ||
    source.RAILWAY_GIT_COMMIT_SHA?.trim();

  if (serviceVersion) {
    resourceAttributes["service.version"] = serviceVersion;
  }

  return {
    headers: parseOtlpHeaders(source.OTEL_EXPORTER_OTLP_HEADERS),
    logsEndpoint,
    resourceAttributes,
    serviceName,
    tracesEndpoint,
  };
}

export function normalizeOtlpEndpoint(
  value: string | undefined,
  signal: "logs" | "traces",
) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    url.search = "";
    url.hash = "";
    const basePath = url.pathname
      .replace(/\/v1\/(?:logs|metrics|traces)\/?$/u, "")
      .replace(/\/+$/u, "");
    url.pathname = `${basePath}/v1/${signal}`;

    return url.toString();
  } catch {
    return null;
  }
}

export function parseOtlpHeaders(value: string | undefined) {
  if (!value?.trim()) {
    return {};
  }

  return Object.fromEntries(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => {
        const separator = part.indexOf("=");

        if (separator <= 0) {
          return [];
        }

        const key = decodeHeaderPart(part.slice(0, separator).trim());
        const headerValue = decodeHeaderPart(part.slice(separator + 1).trim());

        return key ? [[key, headerValue]] : [];
      }),
  );
}

function decodeHeaderPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
