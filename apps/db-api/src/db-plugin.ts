import { Elysia } from "elysia";
import type { Database } from "../../../packages/shared/src/db";

// This plugin provides type information for the db decoration
// The actual db instance is decorated in index.ts
export const dbPlugin = new Elysia({ name: "db-plugin" }).decorate(
  "db",
  {} as Database
);
