// Companion test: (a) old `mysql` driver fails on MySQL 8 with
// caching_sha2_password, (b) plugin error hint when require_secure_transport=ON,
// (c) plugin succeeds once ssl is added to connectionDetails.
// Run from plugins/gatsby-source-mysql2:  node ../../test-vm/mysql-tls-error-test.js
const OLD_MYSQL = require(`../artifacts/mysqltest/pkg/node_modules/mysql`);
const mysql = require(`../plugins/gatsby-source-mysql2/node_modules/mysql2/promise`);
const queryDb = require(`../plugins/gatsby-source-mysql2/src/db`);

const PORT = 33070;
const BASE = {
  host: `127.0.0.1`,
  port: PORT,
  user: `appuser`,
  password: `appsecret`,
  database: `testdb`
};

const panics = [];
const recordingReporter = {
  info: () => {},
  error: () => {},
  panic: (msg, err) => panics.push({ msg, code: err && err.code })
};

async function main() {
  // (a) legacy mysql package against the same server ------------------------
  await new Promise(resolve => {
    const conn = OLD_MYSQL.createConnection(BASE);
    conn.connect(err => {
      console.log(`(a) legacy "mysql" driver connect: ${err ? `FAILS` : `connects (unexpected)`}`);
      if (err) console.log(`    -> ${err.code}: ${err.sqlMessage || err.message}`);
      conn.end();
      resolve();
    });
  });

  // (b) enforce TLS on the server, confirm the plugin surfaces a clear error
  const admin = await mysql.createConnection({ host: `127.0.0.1`, port: PORT, user: `root`, password: `` });
  await admin.query(`SET GLOBAL require_secure_transport = 'ON'`);

  await queryDb({ ...BASE }, [{ statement: `SELECT 1`, idFieldName: `1`, name: `x` }], recordingReporter);
  console.log(`(b) plugin (mysql2), no ssl, server requires TLS: FAILS as expected`);
  console.log(`    -> ${panics[0] ? panics[0].msg : `no panic (unexpected!)`}`);

  // (c) same server, plugin + ssl: { rejectUnauthorized: false } -> success
  const { db, queryResults } = await queryDb(
    { ...BASE, ssl: { rejectUnauthorized: false } },
    [{ statement: `SELECT 'tls-ok' AS marker`, idFieldName: `marker`, name: `tlscheck` }],
    { info: () => {}, error: (m, e) => console.log(`    error reported:`, m), panic: (m, e) => console.log(`    unexpected panic:`, m) }
  );
  console.log(`(c) plugin over TLS (ssl: { rejectUnauthorized: false }):`, JSON.stringify(queryResults[0]));
  await db.end();

  await admin.query(`SET GLOBAL require_secure_transport = 'OFF'`);
  await admin.end();
}

main().catch(err => {
  console.error(`FAILED:`, err && err.message);
  process.exit(1);
});
