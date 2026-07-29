import { createServer } from "./server";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.SYNC_DB_PATH ?? "./sync.db";

const { server } = createServer(dbPath);
server.listen(port, () => {
  console.log(`LedgerOne sync server listening on :${port} (db: ${dbPath})`);
});
