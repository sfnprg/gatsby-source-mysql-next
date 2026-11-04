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
mysql2 option works (`ssl`, `connectTimeout`, `dateStrings`, `decimalNumbers`, `timezone`,
`multipleStatements`, ...).

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

The MySQL version isn't in the name — the name points at the successor plugin, not at a
specific MySQL release. MySQL 8's `caching_sha2_password` is the reason this exists, but
the same mysql2 driver also works fine with MySQL 5.7 and MariaDB.

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
