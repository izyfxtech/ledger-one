import * as db from "@/lib/db";
import { Outbox } from "./outbox";

/** The app's single outbox, backed by the local database. */
export const outbox = new Outbox(db);
