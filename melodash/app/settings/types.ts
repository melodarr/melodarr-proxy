export type RuntimeValue = string | number | boolean;

export type RuntimeEntry = {
 value: RuntimeValue;
 source: string;
};

export type SettingsStatus = {
 enabled?: boolean;
 setupRequired?: boolean;
 authenticated?: boolean;
 csrfToken?: string | null;
};

export type SettingsPayload = {
 csrfToken?: string | null;
 config?: Record<string, RuntimeEntry>;
 admin?: {
  passwordConfigured?: boolean;
  envPasswordConfigured?: boolean;
  bootstrapAvailable?: boolean;
 };
 apiAuth?: {
  requireApiKey?: boolean;
  hasApiKeys?: boolean;
  unauthenticatedAllowed?: boolean;
 };
 server?: Record<string, RuntimeEntry>;
};

export type FormValues = Record<string, string>;
export type Message = { type: "success" | "error"; text: string } | null;

export type ProviderTestResult = {
 ok?: boolean;
 provider?: string;
 query?: string;
 durationMs?: number;
 artistName?: string;
 albumCount?: number;
 sampleAlbums?: Array<{ name: string; year?: number | null }>;
 error?: string;
 details?: Record<string, unknown>;
};

export type ProxyApiKey = {
 id: string;
 name: string;
 quotaPerMinute: number;
 usage: number;
 createdAt?: string | null;
 lastUsedAt?: string | null;
};

export type ProxyApiKeysPayload = {
 keys: ProxyApiKey[];
};

export type CreatedProxyApiKey = {
 id: string;
 key: string;
 message?: string;
};

export type SettingsField = {
 key: string;
 label: string;
 type: string;
 suffix?: string;
 placeholder?: string;
 options?: Array<{ value: string; label: string }>;
};

export type CustomMapping = {
 artistName?: string;
 albums?: string;
 albumName?: string;
 year?: string;
 imageUrl?: string;
};

export type CustomProviderResult = {
 raw?: unknown;
 mapped?: { artistName?: string; albums?: Array<{ name?: string; year?: number | null; imageUrl?: string }> };
 errors?: Array<{ field: string; message: string }>;
 warnings?: Array<{ field: string; message: string }>;
 details?: Record<string, unknown>;
};

export type MappingField = keyof CustomMapping;

export type CustomProviderConfig = {
 id: string;
 name: string;
 baseUrl: string;
 searchPath: string;
 queryParam: string;
 authType: "none" | "bearer" | "header" | "query";
 headerName?: string;
 queryAuthName?: string;
 token?: string;
 mapping: CustomMapping;
 minRequestIntervalMs?: number;
 ipFamily?: "auto" | "4" | "6";
};
