import fs from "fs/promises"
import path from "path"
import { parse } from "csv-parse/sync"
import pino from "pino"

import type { Executor } from "../../registry"
import type { DiscoveryResult } from "../../types"
import { DiscoveryError } from "../../errors"

import {
  csvSchema,
  CsvConfig,
  CSV_MAX_ROWS,
  CSV_MAX_GLOBAL_ITEMS
} from "./schema"

import { transformCsvRow } from "./transform"

const logger = pino({ level: "info" })

/* =========================================================
   SAFE FILE RESOLUTION
========================================================= */

function resolveSafePath(inputPath: string): string {
  const resolved = path.resolve(inputPath)

  // Optional hard restriction:
  // if (!resolved.startsWith(process.cwd())) {
  //   throw new DiscoveryError("Invalid CSV path", "fatal")
  // }

  return resolved
}

/* =========================================================
   EXECUTOR
========================================================= */

export const csvExecutor: Executor<CsvConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    try {
      /* ------------------------------------------
         VALIDATE CONFIG
      ------------------------------------------ */

      const parsed = csvSchema.parse(config)

      const { column_map } = parsed

      const columnMap = {
        name: column_map.name,
        domain: column_map.domain, // <- forces required access
        email: column_map.email
      }

      /* ------------------------------------------
         READ FILE
      ------------------------------------------ */

      const safePath = resolveSafePath(parsed.file_path)

      const fileBuffer = await fs.readFile(safePath)

      const records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true
      }) as Record<string, string>[]

      if (records.length > CSV_MAX_ROWS) {
        throw new DiscoveryError(
          "CSV row limit exceeded",
          "fatal"
        )
      }

      const companies = []
      const contacts = []

      /* ------------------------------------------
         PROCESS ROWS
      ------------------------------------------ */

      for (const row of records) {

        if (companies.length >= CSV_MAX_GLOBAL_ITEMS) {
          break
        }

        const transformed = transformCsvRow(
          row,
          columnMap,
          sourceId
        )

        if (transformed.company) {
          companies.push(transformed.company)
        }

        if (transformed.contact) {
          contacts.push(transformed.contact)
        }
      }

      const duration = Date.now() - startTime

      logger.info(
        {
          sourceId,
          brandId,
          rows: records.length,
          companies: companies.length,
          contacts: contacts.length,
          duration_ms: duration
        },
        "CSV discovery completed"
      )

      const result: DiscoveryResult = {
        companies,
        contacts,
        meta: {
          executor: "csv",
          risk: "low" as any,
          total_fetched: records.length,
          total_companies: companies.length,
          total_contacts: contacts.length,
          source_health: "healthy",
          duration_ms: duration
        }
      }

      return result

    } catch (err: any) {

      if (err instanceof DiscoveryError) {
        throw err
      }

      throw new DiscoveryError(
        err?.message ?? "CSV executor failed",
        "retryable"
      )
    }
  }