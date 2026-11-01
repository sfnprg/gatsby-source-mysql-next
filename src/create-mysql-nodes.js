const crypto = require(`crypto`);
const pluralize = require(`pluralize`);

const TYPE_PREFIX = `mysql`;
const CONFLICT_FIELD_PREFIX = `mysql`;
const RESTRICTED_NODE_FIELDS = [`id`, `children`, `parent`, `fields`, `internal`];
const BATCH_SIZE = 3;

// ---------------------------------------------------------------------------
//
// Node helpers: these replicate, byte for byte where it matters, the output
// of gatsby-node-helpers@0.3.0 (the helper library gatsby-source-mysql used),
// without pulling in its 2018-era dependency chain (lodash/fp, p-is-promise,
// json-stringify-safe).
//
//   node id:      `mysql__<Type>__<id>`   e.g. mysql__Country__USA
//   node type:    `Mysql<Name>`           e.g. MysqlCountry
//
// so previously configured GraphQL queries keep working unchanged.
// ---------------------------------------------------------------------------

function camelCase(input) {
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, `$1 $2`)
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, `$1 $2`)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(``);
}

function upperFirst(input) {
  return String(input).charAt(0).toUpperCase() + String(input).slice(1);
}

function generateNodeId(type, id) {
  return `${TYPE_PREFIX}__${upperFirst(camelCase(type))}__${id}`;
}

function generateTypeName(type) {
  return upperFirst(camelCase(`${TYPE_PREFIX} ${type}`));
}

function prefixConflictingKeys(obj) {
  Object.keys(obj).forEach(key => {
    if (RESTRICTED_NODE_FIELDS.includes(key)) {
      obj[CONFLICT_FIELD_PREFIX + upperFirst(key)] = obj[key];
      delete obj[key];
    }
  });
  return obj;
}

function createNodeFactory(type) {
  return (obj, overrides = {}) => {
    const safeObj = prefixConflictingKeys(Object.assign({}, obj));
    const node = Object.assign(
      {},
      safeObj,
      {
        id: generateNodeId(type, obj.id),
        parent: null,
        children: [],
        internal: {
          type: generateTypeName(type)
        }
      },
      overrides
    );
    node.internal.contentDigest = crypto
      .createHash(`md5`)
      .update(JSON.stringify(node))
      .digest(`hex`);
    return node;
  };
}

// ---------------------------------------------------------------------------
// Relationship building and node creation (ported from
// malcolm-kee/gatsby-source-mysql src/create-mysql-nodes.js)
// ---------------------------------------------------------------------------

function reduceChildFields(childEntities, nodeId) {
  let childFields = {};
  childEntities.forEach(
    ({
      name: childName,
      idFieldName: childIdFieldName,
      foreignKey,
      cardinality = `OneToMany`,
      __sqlResult
    }) => {
      const childIds = __sqlResult
        .filter(child => child[foreignKey] === nodeId)
        .map(child => generateNodeId(childName, child[childIdFieldName]));
      if (cardinality === `OneToMany`) {
        childFields[`${pluralize.plural(childName)}___NODE`] = childIds;
      } else {
        childFields[`${pluralize.singular(childName)}___NODE`] = childIds[0];
      }
    }
  );
  return childFields;
}

function mapSqlResults(__sqlResult, { parentName, foreignKey, childEntities, idFieldName }) {
  return __sqlResult.map(result => {
    const nodeId = result[idFieldName];
    const parentField =
      parentName && foreignKey
        ? {
            [`${parentName}___NODE`]: generateNodeId(parentName, result[foreignKey])
          }
        : {};
    const childFields = reduceChildFields(childEntities, nodeId);
    return Object.assign(
      {},
      result,
      {
        id: nodeId
      },
      parentField,
      childFields
    );
  });
}

function loadCreateRemoteFileNode() {
  try {
    return require(`gatsby-source-filesystem`).createRemoteFileNode;
  } catch (e) {
    return null;
  }
}

async function createMysqlNode(
  node,
  { name, remoteImageFieldNames },
  { createNode, store, createNodeId, cache, getCache, reporter }
) {
  const MySqlNode = createNodeFactory(name);
  const sqlNode = MySqlNode(node);

  if (remoteImageFieldNames && remoteImageFieldNames.length > 0) {
    const createRemoteFileNode = loadCreateRemoteFileNode();
    if (!createRemoteFileNode) {
      throw new Error(
        `${name}: "remoteImageFieldNames" requires gatsby-source-filesystem. ` +
          `Install it in your project (npm install gatsby-source-filesystem) or remove remoteImageFieldNames from the query config.`
      );
    }

    const remoteNodes = await Promise.all(
      remoteImageFieldNames
        .filter(field => !!node[field])
        .map(async field => {
          try {
            return await createRemoteFileNode({
              url: node[field],
              parentNodeId: sqlNode.id,
              // gatsby-source-filesystem v2 uses store/cache, v3+ uses getCache.
              // Passing all of them is safe: each version reads the ones it needs.
              store,
              createNode,
              createNodeId,
              cache,
              getCache: getCache || (() => cache),
              reporter
            });
          } catch (e) {
            if (typeof e === `string`) {
              reporter.error(`Error when getting image ${node[field]}: ${e.toString()}`);
            } else {
              reporter.error(`Error when getting image ${node[field]}`, e);
            }
          }
        })
    );

    // filter out nodes which fail
    const imageNodes = remoteNodes.filter(Boolean);

    if (remoteImageFieldNames.length === 1) {
      if (imageNodes.length > 0) {
        sqlNode.mysqlImage___NODE = imageNodes[0].id;
      }
    }
    sqlNode.mysqlImages___NODE = imageNodes.map(imageNode => imageNode.id);
  }

  await createNode(sqlNode);
}

async function createMysqlNodes(
  { name, __sqlResult, idFieldName, parentName, foreignKey, remoteImageFieldNames = [] },
  allSqlResults,
  { createNode, store, createNodeId, cache, getCache, reporter }
) {
  const childEntities = allSqlResults.filter(
    ({ parentName }) => !!parentName && parentName === name
  );

  if (Array.isArray(__sqlResult)) {
    const mapped = mapSqlResults(__sqlResult, {
      foreignKey,
      parentName,
      childEntities,
      idFieldName
    });
    const sqlNodesChunks = chunk(mapped, BATCH_SIZE);
    for (let sqlNodes of sqlNodesChunks) {
      await Promise.all(
        sqlNodes.map(node =>
          createMysqlNode(
            node,
            { name, remoteImageFieldNames },
            { createNode, store, createNodeId, cache, getCache, reporter }
          )
        )
      );
    }
  }
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

module.exports = createMysqlNodes;
