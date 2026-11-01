// Integration test for the ported plugin connection layer.
// Run from plugins/gatsby-source-mysql2 (so mysql2 resolves):
//   node ../../test-vm/mysql-conn-test.js
// resolve mysql2 from the plugin's node_modules, like Gatsby does for a local plugin
const mysql = require(`../plugins/gatsby-source-mysql2/node_modules/mysql2/promise`);
const queryDb = require(`../plugins/gatsby-source-mysql2/src/db`);

const HOST = `127.0.0.1`;
const PORT = 33070;

const reporter = {
  info: msg => console.log(`[reporter.info ] ${msg}`),
  error: (...args) => console.log(`[reporter.error]`, ...args),
  panic: (msg, err) => {
    console.log(`[reporter.panic] ${msg}`);
    if (err) console.log(`  -> ${err.message} (code: ${err.code})`);
    process.exit(1);
  }
};

async function main() {
  // -- setup phase: server admin as root (passwordless init) ---------------
  const admin = await mysql.createConnection({
    host: HOST,
    port: PORT,
    user: `root`,
    password: ``
  });
  await admin.query(`DROP DATABASE IF EXISTS testdb`);
  await admin.query(`CREATE DATABASE testdb`);
  await admin.query(`DROP USER IF EXISTS 'appuser'@'%'`);
  // Default plugin on MySQL 8/8.4 is caching_sha2_password. Force it explicitly
  // to be certain (this is exactly what a managed MySQL 8 remote user looks like).
  await admin.query(
    `CREATE USER 'appuser'@'%' IDENTIFIED WITH caching_sha2_password BY 'appsecret'`
  );
  await admin.query(
    `GRANT ALL PRIVILEGES ON testdb.* TO 'appuser'@'%'`
  );
  const [users] = await admin.query(
    `SELECT user, host, plugin FROM mysql.user WHERE user IN ('root','appuser')`
  );
  console.log(`-- accounts on server:`, JSON.stringify(users));

  await admin.query(
    `CREATE TABLE testdb.country (Code varchar(3), Name varchar(45), Population bigint, PRIMARY KEY (Code)) DEFAULT CHARSET=utf8`
  );
  await admin.query(
    `CREATE TABLE testdb.city (ID int auto_increment PRIMARY KEY, CountryCode varchar(3), Name varchar(45)) DEFAULT CHARSET=utf8`
  );
  await admin.query(
    `INSERT INTO testdb.country (Code, Name, Population) VALUES ('USA','United States',278357000), ('FIN','Finland',5173026)`
  );
  await admin.query(
    `INSERT INTO testdb.city (CountryCode, Name) VALUES ('USA','New York'), ('USA','Boston'), ('FIN','Helsinki')`
  );
  await admin.query(
    `CREATE PROCEDURE testdb.overview() SELECT 'overview-proc' AS marker, COUNT(*) AS countries FROM testdb.country`
  );

  const [serverInfo] = await admin.query(`SELECT @@version AS v`);
  console.log(`-- server version:`, serverInfo[0].v);
  await admin.end();

  // -- test phase: EXACTLY what the plugin does -----------------------------
  // Fresh connection over plain TCP (no ssl, just host/port/user/password),
  // password-authenticated as appuser with caching_sha2_password.
  // The first login triggers the caching_sha2_password FULL authentication
  // (scramble + RSA public-key exchange over the insecure channel), the
  // handshake the original `mysql` driver cannot perform.
  const connectionDetails = {
    host: HOST,
    port: PORT,
    user: `appuser`,
    password: `appsecret`,
    database: `testdb`
    // explicitly NO ssl option, like the user's remote server config
  };

  const { db, queryResults } = await queryDb(
    connectionDetails,
    [
      {
        statement: `SELECT * FROM country`,
        idFieldName: `Code`,
        name: `country`
      },
      {
        statement: `SELECT * FROM city`,
        idFieldName: `ID`,
        name: `city`
      },
      {
        statement: `CALL overview()`,
        idFieldName: `marker`,
        name: `overview`
      }
    ],
    reporter
  );

  console.log(`\n-- country rows (${queryResults[0].length}):`, JSON.stringify(queryResults[0]));
  console.log(`-- city rows    (${queryResults[1].length}):`, JSON.stringify(queryResults[1]));
  console.log(
    `-- CALL procedure result:`,
    JSON.stringify(queryResults[2]),
    `(typeof is array: ${Array.isArray(queryResults[2])})`
  );

  await db.end();
  console.log(`\nOK - connection + queries + stored procedure all succeed with caching_sha2_password over plain TCP`);
}

main().catch(err => {
  console.error(`FAILED:`, err && err.message);
  process.exit(1);
});
