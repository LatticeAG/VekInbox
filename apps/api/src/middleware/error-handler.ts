import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { VekInboxError } from "@latticeag/vekinbox-shared";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof VekInboxError) {
    return c.json(err.toJSON(), err.status as ContentfulStatusCode);
  }

  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    return c.json(
      {
        error: {
          code: "validation_error",
          message,
          docs_url: "https://latticeag.com/docs/vekinbox/errors/validation_error",
        },
      },
      400,
    );
  }

  console.error("Unhandled error:", err);
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred",
        docs_url: "https://latticeag.com/docs/vekinbox/errors/internal_error",
      },
    },
    500,
  );
};
