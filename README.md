# gatsby-source-mysql-next

[![npm version](https://img.shields.io/npm/v/gatsby-source-mysql-next)](https://www.npmjs.com/package/gatsby-source-mysql-next)

A source plugin for pulling data into Gatsby from MySQL — a modernized successor to
[malcolm-kee/gatsby-source-mysql](https://github.com/malcolm-kee/gatsby-source-mysql)
that runs on the actively maintained [mysql2](https://www.npmjs.com/package/mysql2)
driver instead of the abandoned `mysql` package.

Drop it in as a replacement for `gatsby-source-mysql`: same `gatsby-config.js` options,
same GraphQL types (`MysqlCountry`, `MysqlCity`, `mysqlImage___NODE`, ...).

Use it especially if your database is a remote **MySQL 8.x / 8.4 LTS** server, whose
default authentication plugin is `caching_sha2_password`. The old `mysql` driver dies on
those servers with:

```
ER_NOT_SUPPORTED_AUTH_MODE: Client does not support authentication protocol
requested by server; consider upgrading MySQL client
```

mysql2 implements the whole plugin: fast cached auth, full authentication over TLS or a
Unix socket, and — over a plain TCP connection — the RSA public-key exchange MySQL uses
to complete the first password check securely. No need to `ALTER USER ... IDENTIFIED WITH
mysql_native_password` and no need for `default_authentication_plugin` workarounds.

## Installation

```bash
npm install gatsby-source-mysql-next
# or with yarn:
yarn add gatsby-source-mysql-next
```

or directly from this repository:

```bash
npm install github:sfnprg/gatsby-source-mysql-next
# or with yarn:
yarn add github:sfnprg/gatsby-source-mysql-next
```

Then register the plugin in `gatsby-config.js`:

```js
module.exports = {
  plugins: [
    {
      resolve: `gatsby-source-mysql-next`,
      options: {
        // see Configuration below
      }
    }
  ]
};
```

To use it as a local plugin instead, copy the contents of this repository into your
site's `plugins/` directory:

```bash
git clone https://github.com/sfnprg/gatsby-source-mysql-next.git
mkdir -p plugins
cp -r gatsby-source-mysql-next/. plugins/gatsby-source-mysql-next/

# install this plugin's own dependencies inside its folder
cd plugins/gatsby-source-mysql-next
npm install    # or: yarn install
cd ../..
```

Node resolves `mysql2` from the plugin folder first, so nothing has to be added to the
site's `package.json`.

## Migrate from gatsby-source-mysql

```bash
# 1. remove the old package from your site's package.json
npm uninstall gatsby-source-mysql   # or: yarn remove gatsby-source-mysql

# 2. install this one
npm install gatsby-source-mysql-next   # or: npm install github:sfnprg/gatsby-source-mysql-next
# or with yarn:
yarn add gatsby-source-mysql-next      # or: yarn add github:sfnprg/gatsby-source-mysql-next
```

Then change the one line in `gatsby-config.js`:

```js
// before
resolve: `gatsby-source-mysql`,
// after
resolve: `gatsby-source-mysql-next`,
```

Keep every other option unchanged.

## Configuration

Identical to gatsby-source-mysql, so if you're migrating you can skip this section.

```js
module.exports = {
  plugins: [
    {
      resolve: `gatsby-source-mysql-next`,
      options: {
        connectionDetails: {
          host: "remote.host.example",
          port: 3306,
          user: "db-username",
          password: "db-password",
          database: "world"
        },
        queries: [
          { statement: "SELECT * FROM country", idFieldName: "Code", name: "country" },
          {
            statement: "SELECT * FROM city",
            idFieldName: "ID",
            name: "city",
            parentName: "country",   // join: country.Code = city.CountryCode
            foreignKey: "CountryCode",
            cardinality: "OneToMany"
          }
        ]
      }
    }
  ]
};
```

GraphQL output is unchanged: types `MysqlCountry`, `MysqlCity`, `mysqlImage___NODE`
image handling via `remoteImageFieldNames`, stored procedures via `CALL ...`.

`connectionDetails` is passed straight through to `mysql2.createConnection`, so any
mysql2 option works (`ssl`, `connectTimeout`, `dateStrings`, `timezone`,
`multipleStatements`, ...). Two type-casting defaults are set for drop-in parity with
gatsby-source-mysql (see "Row values" below) and can be overridden the same way:
`jsonStrings` and `decimalNumbers`.

## Supported MySQL versions

The plugin works against **MySQL 5.6, 5.7, 8.0, 8.4 LTS and MariaDB 10.x** — mysql2
speaks the classic MySQL protocol and implements both `mysql_native_password` (the
default on 5.6/5.7) and `caching_sha2_password` (the default on 8.x), so the same
config works on old and new servers. No MySQL-8-only feature is required anywhere in
the plugin. One caveat: mysql2 connects with the `utf8mb4` charset by default, which
exists since MySQL 5.5.3 / MariaDB 5.5.3; on anything older pass
`charset: "UTF8_GENERAL_CI"` in `connectionDetails`.

Note on `GROUP BY`: strict grouping (`ONLY_FULL_GROUP_BY`) is a **server-side
`sql_mode` setting** (on by default since MySQL 5.7), not something the plugin
controls — the old gatsby-source-mysql behaves identically against the same server.
If your queries rely on loose grouping, relax it on the server/session
(`SET SESSION sql_mode = ...`) or rewrite the query; the plugin cannot do it for you.

## Row values (drop-in parity with gatsby-source-mysql)

The old plugin used the `mysql` driver, whose default type casting returns **JSON
columns as raw strings** and **DECIMAL/NEWDECIMAL as numbers**. mysql2 defaults to
the opposite (parsed JSON objects, DECIMAL as strings), which silently changes the
GraphQL field types of your nodes and can break site code written against the old
plugin — e.g. a lunr search index built from these fields crashing at query time with
`can't access property "_index", posting is undefined` in `lunr.Index.prototype.query`,
because object values tokenize differently than the strings the old plugin produced.

To keep the old behaviour, this plugin sets `jsonStrings: true` and
`decimalNumbers: true` by default (user-supplied `connectionDetails` win). If you
*want* mysql2's modern behaviour, opt out explicitly:

```js
connectionDetails: {
  // ...
  jsonStrings: false,    // parse JSON columns into objects
  decimalNumbers: false  // keep DECIMAL as string (exact precision)
}
```

## Remote server / MySQL 8 notes

- **`caching_sha2_password`**: works out of the box, including over non-TLS connections
  (mysql2 requests the server RSA key automatically, like other drivers' "allowPublicKeyRetrieval").
- **TLS**: if the server runs `require_secure_transport = ON` (typical of managed MySQL),
  add an `ssl` option. Note mysql2 defaults `ssl.rejectUnauthorized` to `true`:
  ```js
  // proper (with the server's CA on disk):
  ssl: { ca: require("fs").readFileSync("./rds-ca-bundle.pem") }
  // or one of the built-in profiles:
  ssl: "Amazon RDS"
  // quick test only (no cert verification):
  ssl: { rejectUnauthorized: false }
  ```
- **Host grants**: the account must exist for the connecting client host
  (`CREATE USER 'x'@'%'` or `'x'@'<your-ip>'` + GRANT). Connection problems of this kind
  now surface with a clear build error instead of leaving you with empty data.

## What changed from gatsby-source-mysql

1. **Driver**: `mysql2@^3` (promise API) instead of `mysql`; the connection is awaited, so
   failures are detected before any query runs.
2. **Errors**: connection and query failures now *stop the build* (`reporter.panic`) with an
   actionable message (DNS, refused, access denied, host grant, 1251, TLS-required, TLS
   handshake). The original swallowed query errors with `reporter.error`, leaving you with
   empty GraphQL data. A failed query is reported once (no duplicated error text), naming
   the `queries` entry and printing its full SQL statement so the culprit is easy to find
   in `gatsby-config.js`.
3. **Node creation inlined**: the old `gatsby-node-helpers@0.3.0` chain (lodash/fp,
   p-is-promise, json-stringify-safe) is replaced by local equivalents that produce
   **identical** node IDs and type names (`mysql__Country__USA`, `MysqlCountry`) and
   identical conflict-field renaming of `id/children/parent/fields/internal` rows to
   `mysqlId`, `mysqlFields`, ... — so existing queries keep working.
4. **`parent: null`** on sourced nodes instead of the old `__SOURCE__` stub id (safe across
   Gatsby v2–v5; content digests change once → first build rebuilds its cache).
5. **Remote images**: `createRemoteFileNode` is called with the modern
   (`gatsby-source-filesystem` v3+) `getCache` signature while still passing `cache`/`store`
   for Gatsby v2; and it is lazily required, so you only need `gatsby-source-filesystem`
   installed if you actually use `remoteImageFieldNames`.
6. **Dependencies**: `mysql2` and `pluralize` only (`lodash.chunk` inlined);
   `gatsby-source-filesystem` became an optional peer.
7. **Unchanged upstream behaviour worth knowing**: if a row has a column literally named
   `id`, it is overwritten by the `idFieldName` value during the parent/child mapping (same
   as upstream), so that column's content is not exposed.
8. **Row type-casting parity**: `jsonStrings: true` and `decimalNumbers: true` are set by
   default so rows come back exactly like the old `mysql` driver returned them (JSON as
   string, DECIMAL as number). Override either in `connectionDetails` if you prefer
   mysql2's defaults.

The MySQL version isn't in the name — the name points at the successor plugin, not at a
specific MySQL release. MySQL 8's `caching_sha2_password` is the reason this exists, but
the same mysql2 driver also works fine with MySQL 5.6/5.7 and MariaDB (see "Supported
MySQL versions" above).

## Development

Clone this repository — the plugin package lives at the repository root:

```bash
git clone https://github.com/sfnprg/gatsby-source-mysql-next.git
cd gatsby-source-mysql-next
npm ci        # or: yarn install
npm test      # or: yarn test
```

`npm test` (or `yarn test`) runs the self-contained node-creation suite in `test/`. The `test/` directory
is kept out of the published npm package by the `"files"` field in `package.json`.

## License

MIT
