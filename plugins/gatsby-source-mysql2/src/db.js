const mysql = require(`mysql2/promise`);

const PLUGIN_NAME = `[gatsby-source-mysql2]`;

/**
 * Turn low-level driver errors into an actionable explanation.
 * connectionDetails is passed straight through to mysql2, so the errors
 * surfacing at connection time are exactly the ones you would get when
 * connecting manually with mysql2.
 */
function describeConnectionError(err) {
  if (!err) return `Unknown error`;
  const code = err.code || err.errno;
  const address = err.address || err.host || ``;

  switch (code) {
    case `ENOTFOUND`:
      return `Could not resolve host${
        address ? ` "${address}"` : ``
      }. Check the "host" value in connectionDetails.`;
    case `ECONNREFUSED`:
      return `Connection refused. Check "host" and "port" in connectionDetails, and that the server accepts remote TCP connections (bind-address, firewall, cloud security groups).`;
    case `ETIMEDOUT`:
    case `EHOSTUNREACH`:
    case `ENETUNREACH`:
      return `Could not reach the MySQL server. This is almost always a network issue (VPN, firewall, cloud security group, wrong server port).`;
    case 1045: // ER_ACCESS_DENIED_ERROR
    case `ER_ACCESS_DENIED_ERROR`:
      return `Access denied for user. Check "user" and "password" in connectionDetails, and that the MySQL account is allowed to connect from this machine (e.g. CREATE USER '<user>'@'<your-ip-or-%>'; GRANT ...).`;
    case 1130: // ER_HOST_NOT_PRIVILEGED
    case `ER_HOST_NOT_PRIVILEGED`:
      return `The server does not allow this host to connect. On the server: CREATE USER '<user>'@'<client-ip-or-%>' IDENTIFIED BY '...'; GRANT ALL ON <db>.* TO '<user>'@'<client-ip-or-%>';`;
    case 1251: // ER_NOT_SUPPORTED_AUTH_MODE
    case `ER_NOT_SUPPORTED_AUTH_MODE`:
      return `The driver does not support the server "authentication plug-in". This error is typical of the old "mysql" driver against MySQL 8 (caching_sha2_password). This plugin uses "mysql2", which does support it, so make sure connectionDetails is passed on unmodified.`;
    case 3159: // ER_SECURE_TRANSPORT_REQUIRED
    case `ER_SECURE_TRANSPORT_REQUIRED`:
      return `The server requires TLS (require_secure_transport = ON). Add an "ssl" option to connectionDetails, e.g. ssl: { ca: fs.readFileSync("./ca.pem") } or, to disable certificate verification for a quick test, ssl: { rejectUnauthorized: false }.`;
    case `HANDSHAKE_NO_SSL_SUPPORT`:
      return `The server does not support SSL but an "ssl" option is set in connectionDetails. Remove "ssl" or connect to a TLS-capable endpoint.`;
    default:
      break;
  }

  if (typeof code === `string`) {
    const tlsLike =
      code.startsWith(`ERR_SSL`) ||
      code.includes(`TLS`) ||
      /CERT/.test(code) ||
      /SSL/.test(code);
    if (tlsLike) {
      return `TLS handshake problem. For self-signed or cloud-managed certificates, pass the authority certificate: ssl: { ca: fs.readFileSync("./ca.pem") }; to skip certificate verification for a quick test: ssl: { rejectUnauthorized: false }. mysql2 rejects "rejectUnauthorized: true" (the default) against servers presenting certificates that do not verify.`;
    }
  }

  return err.message ? `${err.message}${code ? ` (code: ${code})` : ``}` : String(err);
}

function query(dbConnection, statement, reporter) {
  return dbConnection.query(statement).then(([results]) => {
    if (/^call/i.test(statement)) {
      reporter.info(`stored procedure statments: '${statement}'`);
      return results[0];
    }
    return results;
  });
}

async function queryDb(connectionDetails, queries, reporter) {
  let db;
  try {
    db = await mysql.createConnection(connectionDetails);
  } catch (err) {
    reporter.panic(
      `${PLUGIN_NAME} Error establishing database connection. ${describeConnectionError(err)}`,
      err
    );
    return;
  }

  try {
    const queryResults = await Promise.all(
      queries.map(({ statement }) => query(db, statement, reporter))
    );
    return {
      db,
      queryResults
    };
  } catch (err) {
    try {
      await db.end();
    } catch (e) {
      // eslint-disable-line no-empty
    }
    reporter.panic(
      `${PLUGIN_NAME} Error making queries: ${err && err.message ? err.message : err}`,
      err
    );
  }
}

module.exports = queryDb;
