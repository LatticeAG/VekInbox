import {
  verifyWebhookSignature,
  type WebhookHeaders,
} from "@latticeag/vekinbox-shared";
import { HttpClient, type ClientOptions } from "./client.js";
import { RequestsClient } from "./requests.js";

export interface VekInboxOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class VekInbox {
  readonly requests: RequestsClient;
  readonly webhooks: {
    verify: (headers: WebhookHeaders, rawBody: string | Buffer, secret: string) => boolean;
  };

  constructor(opts: VekInboxOptions) {
    const clientOpts: ClientOptions = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
    };
    const http = new HttpClient(clientOpts);
    this.requests = new RequestsClient(http);
    this.webhooks = {
      verify: verifyWebhookSignature,
    };
  }
}

export { VekInboxApiError } from "./client.js";
export { RequestsClient } from "./requests.js";

export type {
  ApiErrorResponse,
  CreateRequestInput,
  ListFilters,
  ListRequestsResponse,
  Request,
  RequestAction,
  RequestActionName,
  RequestPriority,
  RequestStatus,
  ResolveRequestInput,
  ResumeWebhookPayload,
  WebhookHeaders,
} from "@latticeag/vekinbox-shared";

export {
  DEFAULT_BASE_URL,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_MAX_TIMESTAMP_SKEW_MS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  isTerminalStatus,
  verifyWebhookSignature,
} from "@latticeag/vekinbox-shared";
