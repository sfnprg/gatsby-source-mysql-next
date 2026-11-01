const queryDb = require(`./src/db`);
const createMysqlNodes = require(`./src/create-mysql-nodes`);

const PLUGIN_NAME = `[gatsby-source-mysql2]`;

exports.sourceNodes = async (
  { actions, store, createNodeId, cache, getCache, reporter },
  configOptions
) => {
  const { createNode } = actions;
  const { connectionDetails, queries } = configOptions;

  if (!connectionDetails || typeof connectionDetails !== `object`) {
    reporter.panic(
      `${PLUGIN_NAME} The "connectionDetails" option is required and must be an object; it is passed unmodified to the mysql2 driver, e.g. { host, user, password, database }.`
    );
    return;
  }

  if (!Array.isArray(queries) || queries.length === 0) {
    reporter.panic(
      `${PLUGIN_NAME} The "queries" option must be a non-empty array of { statement, idFieldName, name } objects.`
    );
    return;
  }

  queries.forEach((query, index) => {
    const { statement, idFieldName, name } = query || {};
    if (!statement || !idFieldName || !name) {
      reporter.panic(
        `${PLUGIN_NAME} Each entry of "queries" requires "statement", "idFieldName" and "name" (query #${index} is missing at least one).`
      );
    }
  });

  const { db, queryResults } = await queryDb(connectionDetails, queries, reporter);

  try {
    const sqlData = queries.map((query, index) =>
      Object.assign({}, query, { __sqlResult: queryResults[index] })
    );
    await Promise.all(
      sqlData.map((sqlResult, _, sqlResults) =>
        createMysqlNodes(sqlResult, sqlResults, {
          createNode,
          store,
          createNodeId,
          cache,
          getCache,
          reporter
        })
      )
    );
  } catch (e) {
    reporter.panic(`${PLUGIN_NAME} Error while sourcing data from MySQL`, e);
  } finally {
    await db.end().catch(() => {});
  }
};
