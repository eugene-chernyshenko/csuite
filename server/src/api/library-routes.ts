/**
 * The company-library API (mounted under `/api`).
 *
 *   GET  /companies/:id/library                    — list/search frontmatter
 *   GET  /companies/:id/library/:docId             — one document, body included
 *   POST /companies/:id/library                    — create (governance-checked)
 *   POST /companies/:id/library/:docId/supersede   — retire a document
 *
 * Writes go through the library service, which appends the event and writes the
 * projection in one transaction — the HTTP layer never touches either directly.
 *
 * Kept in its own file rather than in api/routes.ts because the library is its
 * own subsystem with its own governance rule, and because routes.ts is the
 * decision-lifecycle kernel: the two change for different reasons.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { LibraryService } from "../library";
import { LibraryError } from "../library";
import { CompanyNotFoundError, type EventStore } from "../store/types";
import { ApiError } from "./errors";

export interface LibraryApiDeps {
  store: EventStore;
  library: LibraryService;
}

const documentTypeSchema = z.enum([
  "profile",
  "policy",
  "finance",
  "analysis",
  "agreement",
  "note",
]);

const idSchema = z.string().min(1);

export const listLibraryQuerySchema = z.object({
  type: documentTypeSchema.optional(),
  /** Owning role id. */
  owner: idSchema.optional(),
  tag: z.string().min(1).optional(),
  /** Defaults to current — the library answers with what is true today. */
  status: z.enum(["current", "superseded", "any"]).optional(),
  /** Full-text query; when present the response is search hits with snippets. */
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const createDocumentSchema = z.object({
  id: idSchema.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "id must be url-safe").optional(),
  type: documentTypeSchema,
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(1000),
  ownerRoleId: idSchema,
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  body: z.string().min(1).max(200_000),
  /**
   * Governance: `policy` and `profile` change only through the decision
   * process. Until the decision gate is wired, the caller asserts it here and
   * the service refuses the write without it.
   */
  viaDecision: z.boolean().optional(),
});

export const supersedeDocumentSchema = z.object({
  /** The document that replaces this one, if any. */
  by: idSchema.optional(),
  viaDecision: z.boolean().optional(),
});

/** The library's own errors carry an HTTP status; hand it to the API shape. */
function asApiError(err: unknown): never {
  if (err instanceof LibraryError) throw new ApiError(err.status, err.message);
  throw err;
}

export function libraryRoutes(deps: LibraryApiDeps): FastifyPluginAsync {
  const { store, library } = deps;

  async function requireCompany(companyId: string): Promise<string> {
    const company = await store.getCompany(companyId);
    if (!company) throw new CompanyNotFoundError(companyId);
    return company.id;
  }

  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
      "/companies/:id/library",
      async (req) => {
        const companyId = await requireCompany(req.params.id);
        const q = listLibraryQuerySchema.parse(req.query);
        const filter = {
          ...(q.type ? { type: q.type } : {}),
          ...(q.owner ? { ownerRoleId: q.owner } : {}),
          ...(q.tag ? { tag: q.tag } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.limit ? { limit: q.limit } : {}),
        };

        if (q.q) {
          const hits = await library.search(companyId, q.q, filter).catch(asApiError);
          return { companyId, query: q.q, documents: hits };
        }
        const documents = await library.list(companyId, filter).catch(asApiError);
        return { companyId, documents };
      },
    );

    app.get<{ Params: { id: string; docId: string } }>(
      "/companies/:id/library/:docId",
      async (req) => {
        const companyId = await requireCompany(req.params.id);
        const document = await library.read(companyId, req.params.docId).catch(asApiError);
        return { companyId, document };
      },
    );

    app.post<{ Params: { id: string } }>("/companies/:id/library", async (req, reply) => {
      const companyId = await requireCompany(req.params.id);
      const body = createDocumentSchema.parse(req.body);
      const document = await library.create(companyId, body).catch(asApiError);
      return reply.status(201).send({ companyId, document });
    });

    app.post<{ Params: { id: string; docId: string } }>(
      "/companies/:id/library/:docId/supersede",
      async (req, reply) => {
        const companyId = await requireCompany(req.params.id);
        const body = supersedeDocumentSchema.parse(req.body ?? {});
        const document = await library
          .supersede(companyId, req.params.docId, body)
          .catch(asApiError);
        return reply.status(201).send({ companyId, document });
      },
    );
  };
}
